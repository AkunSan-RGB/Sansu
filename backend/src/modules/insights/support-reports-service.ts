import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { SupportQueries } from './support-queries';
import { Cell, num, CAP, L, R, sum } from './support-shared';
import { IndustrySupportReports } from './support-reports-industry';

@Injectable()
export class ServiceSupportReports {
  constructor(
    private readonly queries: SupportQueries,
    private readonly x: IndustrySupportReports,
  ) {}


  // ------------------------------------------------------------------ Jasa
  async jasa(tenantId: string, from: string, to: string) {
    const projects = await this.queries.rows<{
      code: string;
      name: string;
      customer: string;
      contract: string;
      status: string;
      pct: string | null;
      earned: string | null;
      accrual: string | null;
      billed: string;
    }>(sql`
      SELECT p.code, p.name, c.name AS customer, p.contract_value::text AS contract, p.status, g.percent::text AS pct, g.earned::text AS earned, g.accrual_after::text AS accrual,
        COALESCE((SELECT SUM(i.subtotal) FROM invoices i WHERE i.project_id = p.id AND i.tenant_id = ${tenantId} AND i.date <= ${to}), 0)::text AS billed
      FROM projects p JOIN customers c ON c.id = p.customer_id
      LEFT JOIN LATERAL (SELECT percent, earned, accrual_after FROM project_progress WHERE project_id = p.id AND date <= ${to} ORDER BY date DESC, number DESC LIMIT ${CAP}) g ON TRUE
      WHERE p.tenant_id = ${tenantId} AND (p.status = 'ACTIVE' OR g.percent IS NOT NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = p.id AND i.date BETWEEN ${from} AND ${to}))
      ORDER BY p.code LIMIT ${CAP}`);
    const STATUS: Record<string, string> = { ACTIVE: 'Berjalan', DONE: 'Selesai', CANCELLED: 'Batal' };
    const projectRows: Cell[][] = projects.map((r) => [
      r.code,
      r.name,
      r.customer,
      num(r.contract),
      r.pct === null ? null : num(r.pct),
      r.earned === null ? null : num(r.earned),
      num(r.billed),
      num(r.contract) - num(r.billed),
      r.accrual === null ? null : num(r.accrual),
      STATUS[r.status] ?? r.status,
    ]);
    const invoices = await this.queries.rows<{
      number: string;
      d: string;
      customer: string;
      project: string | null;
      sub: string;
      tax: string;
      tot: string;
      status: string;
    }>(sql`
      SELECT i.number, i.date::text AS d, c.name AS customer, p.code AS project, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.tenant_id = ${tenantId} AND i.project_id IS NOT NULL AND i.date BETWEEN ${from} AND ${to} ORDER BY i.date, i.number LIMIT ${CAP}`);
    const invoiceRows: Cell[][] = invoices.map((r) => [
      r.number,
      r.d,
      r.customer,
      r.project,
      num(r.sub),
      num(r.tax),
      num(r.tot),
      r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar',
    ]);
    const deposits = await this.queries.rows<{
      number: string;
      d: string;
      customer: string;
      project: string | null;
      dpp: string;
      tax: string;
      applied: string;
    }>(sql`
      SELECT d.number, d.date::text AS d, c.name AS customer, p.code AS project, d.dpp::text AS dpp, d.tax_amount::text AS tax,
        COALESCE((SELECT SUM(a.dpp) FROM deposit_applications a WHERE a.deposit_id = d.id AND a.date <= ${to}), 0)::text AS applied
      FROM customer_deposits d JOIN customers c ON c.id = d.customer_id LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.tenant_id = ${tenantId} AND d.date <= ${to} ORDER BY d.date, d.number LIMIT ${CAP}`);
    const depositRows: Cell[][] = deposits
      .filter((r) => num(r.dpp) - num(r.applied) !== 0 || r.d >= from)
      .map((r) => [
        r.number,
        r.d,
        r.customer,
        r.project,
        num(r.dpp),
        num(r.tax),
        num(r.applied),
        num(r.dpp) - num(r.applied),
      ]);

    const work = await this.queries.rows<{
      name: string;
      unit: string;
      n: number;
      qty: string;
      pending: string;
      approved: string;
      paid: string;
    }>(sql`
      SELECT e.name, w.unit, COUNT(*)::int AS n, SUM(w.quantity)::text AS qty,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'PENDING'), 0)::text AS pending,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'APPROVED' AND w.run_id IS NULL), 0)::text AS approved,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'APPROVED' AND w.run_id IS NOT NULL), 0)::text AS paid
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${tenantId} AND w.work_date BETWEEN ${from} AND ${to} AND w.status IN ('PENDING', 'APPROVED')
      GROUP BY e.id, e.name, w.unit ORDER BY e.name, w.unit LIMIT ${CAP}`);
    const UNIT: Record<string, string> = {
      HOUR: 'Jam',
      SESSION: 'Sesi',
      JOB: 'Pekerjaan',
      PERCENT: 'Komisi (%)',
      SHIFT: 'Shift',
      PIECE: 'Per hasil',
    };
    const workRows: Cell[][] = work.map((r) => [
      r.name,
      UNIT[r.unit] ?? r.unit,
      r.n,
      num(r.qty),
      num(r.pending),
      num(r.approved),
      num(r.paid),
      num(r.pending) + num(r.approved) + num(r.paid),
    ]);

    const [c] = await this.queries.rows<{ contract: string; dep: string }>(sql`
      SELECT (SELECT COALESCE(SUM(g.accrual_after), 0) FROM projects p
              JOIN LATERAL (SELECT accrual_after FROM project_progress WHERE project_id = p.id AND date <= ${to} ORDER BY date DESC, number DESC LIMIT ${CAP}) g ON TRUE
              WHERE p.tenant_id = ${tenantId})::text AS contract,
             ((SELECT COALESCE(SUM(dpp), 0) FROM customer_deposits WHERE tenant_id = ${tenantId} AND date <= ${to})
              - (SELECT COALESCE(SUM(dpp), 0) FROM deposit_applications WHERE tenant_id = ${tenantId} AND date <= ${to}))::text AS dep`);
    const glContract =
      (await this.queries.glBalance(tenantId, to, sql`a.system_key = 'UNBILLED_REVENUE'`)) +
      (await this.queries.glBalance(tenantId, to, sql`a.system_key = 'CONTRACT_LIABILITY'`));
    const glDep = -(await this.queries.glBalance(tenantId, to, sql`a.system_key = 'CUSTOMER_DEPOSIT'`));
    const [rev] = await this.queries.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM invoices WHERE tenant_id = ${tenantId} AND project_id IS NOT NULL AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS doc,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
              WHERE a.type = 'REVENUE' AND l.journal_id IN (SELECT journal_id FROM invoices WHERE tenant_id = ${tenantId} AND project_id IS NOT NULL AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL))::text AS gl`);

    return {
      title: 'Laporan Pendukung Jasa & Proyek',
      summary:
        'Proyek dan termin, kemajuan pekerjaan, serta uang muka pelanggan, dicocokkan dengan pendapatan, aset/liabilitas kontrak, dan uang muka di buku besar.',
      reconciliation: [
        this.queries.recon(
          'jasa-revenue',
          'Faktur proyek vs akun pendapatan',
          { label: 'Faktur proyek pada periode (DPP)', value: Number(rev.doc) },
          { label: 'Akun pendapatan pada jurnal faktur tersebut', value: Number(rev.gl) },
          'Faktur yang melunasi uang muka dapat memuat pembalikan uang muka sehingga berbeda dari pendapatan.',
        ),
        this.queries.recon(
          'jasa-contract',
          'Kemajuan pekerjaan vs aset/liabilitas kontrak',
          { label: 'Aset (+) / liabilitas (−) kontrak dari catatan kemajuan terakhir', value: Number(c.contract) },
          { label: 'Pendapatan Belum Ditagih − Pendapatan Diterima Dimuka di buku besar', value: glContract },
        ),
        this.queries.recon(
          'jasa-deposit',
          'Uang muka pelanggan vs saldo uang muka',
          { label: 'Uang muka diterima − dipakai (DPP)', value: Number(c.dep) },
          { label: 'Saldo akun Uang Muka Pelanggan', value: glDep },
        ),
      ],
      sections: [
        {
          key: 'jasa-project',
          number: 'J1',
          title: 'Proyek: kontrak, kemajuan, dan tagihan',
          paragraphs: [
            'Pendapatan diakui = nilai kontrak × % selesai (catatan kemajuan terakhir). Aset kontrak positif = pekerjaan lebih cepat dari tagihan; negatif = tagihan lebih cepat dari pekerjaan.',
          ],
          tables: [
            {
              columns: [
                'Kode',
                'Proyek',
                'Pelanggan',
                'Kontrak',
                '% selesai',
                'Pendapatan diakui',
                'Ditagih (DPP)',
                'Sisa kontrak',
                'Aset/(liab.) kontrak',
                'Status',
              ],
              align: [L, L, L, R, R, R, R, R, R, L],
              rows: projectRows,
              total: projectRows.length
                ? [
                    'Jumlah',
                    null,
                    null,
                    sum(projectRows, 3),
                    null,
                    sum(projectRows, 5),
                    sum(projectRows, 6),
                    sum(projectRows, 7),
                    sum(projectRows, 8),
                    null,
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'jasa-invoice',
          number: 'J2',
          title: 'Faktur termin dan jasa proyek',
          paragraphs: [],
          tables: [
            {
              columns: ['Nomor', 'Tanggal', 'Pelanggan', 'Proyek', 'DPP', 'PPN', 'Total', 'Status'],
              align: [L, L, L, L, R, R, R, L],
              rows: invoiceRows,
              total: invoiceRows.length
                ? ['Jumlah', null, null, null, sum(invoiceRows, 4), sum(invoiceRows, 5), sum(invoiceRows, 6), null]
                : undefined,
            },
          ],
        },
        {
          key: 'jasa-deposit',
          number: 'J3',
          title: 'Uang muka pelanggan',
          paragraphs: ['Sisa uang muka adalah kewajiban ke pelanggan sampai dipakai melunasi faktur.'],
          tables: [
            {
              columns: ['Nomor', 'Tanggal', 'Pelanggan', 'Proyek', 'DPP', 'PPN', 'Dipakai', 'Sisa'],
              align: [L, L, L, L, R, R, R, R],
              rows: depositRows,
              total: depositRows.length
                ? [
                    'Jumlah',
                    null,
                    null,
                    null,
                    sum(depositRows, 4),
                    sum(depositRows, 5),
                    sum(depositRows, 6),
                    sum(depositRows, 7),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'jasa-work',
          number: 'J4',
          title: 'Jam kerja dan upah jasa',
          paragraphs: [
            'Catatan pekerjaan pada periode: menunggu persetujuan, disetujui belum masuk penggajian, dan sudah masuk penggajian. Upah dibayar lewat penggajian (Upah jasa); jurnalnya dilaporkan pada laporan penggajian, bukan di sini.',
          ],
          tables: [
            {
              columns: [
                'Karyawan',
                'Satuan',
                'Catatan',
                'Jumlah satuan',
                'Menunggu persetujuan',
                'Disetujui belum digaji',
                'Sudah digaji',
                'Total',
              ],
              align: [L, L, R, R, R, R, R, R],
              rows: workRows,
              total: workRows.length
                ? [
                    'Jumlah',
                    null,
                    sum(workRows, 2),
                    null,
                    sum(workRows, 4),
                    sum(workRows, 5),
                    sum(workRows, 6),
                    sum(workRows, 7),
                  ]
                : undefined,
            },
          ],
        },
      ],
    };
  }


  // ------------------------------------------------------------------ Utilitas
  async utility(tenantId: string, from: string, to: string) {
    const p1 = from.slice(0, 7);
    const p2 = to.slice(0, 7);
    const periods = await this.queries.rows<{
      period: string;
      n: number;
      verified: number;
      billed: number;
      rejected: number;
      flagged: number;
      usage: string;
    }>(sql`
      SELECT period, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'VERIFIED')::int AS verified, COUNT(*) FILTER (WHERE status = 'BILLED')::int AS billed,
        COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected, COUNT(*) FILTER (WHERE cardinality(flags) > 0)::int AS flagged,
        COALESCE(SUM(usage) FILTER (WHERE status = 'BILLED'), 0)::text AS usage
      FROM utility_readings WHERE tenant_id = ${tenantId} AND period BETWEEN ${p1} AND ${p2} GROUP BY period ORDER BY period`);
    const periodRows: Cell[][] = periods.map((r) => [
      r.period,
      r.n,
      r.verified,
      r.billed,
      r.rejected,
      r.flagged,
      num(r.usage),
    ]);
    const bills = await this.queries.rows<{
      period: string;
      n: number;
      usage: string;
      sub: string;
      late: string;
      tot: string;
      paid: string;
    }>(sql`
      SELECT b.period, COUNT(*)::int AS n, COALESCE(SUM(b.usage), 0)::text AS usage, COALESCE(SUM(i.subtotal), 0)::text AS sub, COALESCE(SUM(b.late_fee), 0)::text AS late,
        COALESCE(SUM(i.total), 0)::text AS tot, COALESCE(SUM(i.paid_amount), 0)::text AS paid
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} GROUP BY b.period ORDER BY b.period`);
    const billRows: Cell[][] = bills.map((r) => [
      r.period,
      r.n,
      num(r.usage),
      num(r.sub),
      num(r.late),
      num(r.tot),
      num(r.paid),
      num(r.tot) - num(r.paid),
    ]);
    const arrears = await this.queries.rows<{
      conn: string;
      customer: string;
      period: string;
      due: string;
      tot: string;
      open: string;
      age: number;
    }>(sql`
      SELECT c.number AS conn, cu.name AS customer, b.period, i.due_date::text AS due, i.total::text AS tot, (i.total - i.paid_amount - i.returned_amount)::text AS open, (${to}::date - i.due_date)::int AS age
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.date <= ${to} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < ${to} ORDER BY i.due_date LIMIT ${CAP}`);
    const arrearRows: Cell[][] = arrears.map((r) => [
      r.conn,
      r.customer,
      r.period,
      r.due,
      r.age,
      num(r.tot),
      num(r.open),
    ]);
    const conns = await this.queries.rows<{ tariff: string; active: number; suspended: number; off: number }>(sql`
      SELECT t.name AS tariff, COUNT(*) FILTER (WHERE c.status = 'ACTIVE')::int AS active, COUNT(*) FILTER (WHERE c.status = 'SUSPENDED')::int AS suspended,
        COUNT(*) FILTER (WHERE c.status = 'DISCONNECTED')::int AS off
      FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.installed_at <= ${to} GROUP BY t.name ORDER BY t.name`);
    const connRows: Cell[][] = conns.map((r) => [r.tariff, r.active, r.suspended, r.off]);

    const [c] = await this.queries.rows<{
      read_usage: string;
      bill_usage: string;
      sub: string;
      rev: string;
      late: string;
      late_gl: string;
    }>(sql`
      SELECT (SELECT COALESCE(SUM(usage), 0) FROM utility_readings WHERE tenant_id = ${tenantId} AND status = 'BILLED' AND period BETWEEN ${p1} AND ${p2}
                AND bill_id IN (SELECT b.id FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to}))::text AS read_usage,
             (SELECT COALESCE(SUM(b.usage), 0) FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to}
                AND EXISTS (SELECT 1 FROM utility_readings r WHERE r.bill_id = b.id))::text AS bill_usage,
             (SELECT COALESCE(SUM(i.subtotal), 0) FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND i.journal_id IS NOT NULL)::text AS sub,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                WHERE a.type = 'REVENUE' AND l.journal_id IN (SELECT i.journal_id FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND i.journal_id IS NOT NULL))::text AS rev,
             (SELECT COALESCE(SUM(b.late_fee), 0) FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND i.journal_id IS NOT NULL)::text AS late,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                WHERE a.system_key = 'UTILITY_LATE_FEE_REVENUE' AND l.journal_id IN (SELECT i.journal_id FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND i.journal_id IS NOT NULL))::text AS late_gl`);

    const arOpen = await this.queries.rows<{ util: string; other: string }>(sql`
      SELECT COALESCE(SUM(x.open) FILTER (WHERE x.util), 0)::text AS util, COALESCE(SUM(x.open) FILTER (WHERE NOT x.util), 0)::text AS other FROM (
        SELECT i.total
          - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0) AS open,
          EXISTS (SELECT 1 FROM utility_bills b WHERE b.invoice_id = i.id) AS util
        FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x`);
    const arGl = await this.queries.glBalance(tenantId, to, sql`a.system_key = 'AR'`);
    const arRows: Cell[][] = [
      ['Tagihan utilitas', num(arOpen[0].util)],
      ['Faktur penjualan lain', num(arOpen[0].other)],
    ];

    return {
      title: 'Laporan Pendukung Utilitas',
      summary:
        'Pencatatan meter, tagihan pelanggan, denda, tunggakan, dan sambungan, dicocokkan dengan pendapatan di buku besar.',
      reconciliation: [
        this.queries.recon(
          'util-revenue',
          'Tagihan pelanggan vs akun pendapatan',
          { label: 'Faktur tagihan utilitas pada periode (DPP)', value: Number(c.sub) },
          { label: 'Akun pendapatan pada jurnal faktur tersebut', value: Number(c.rev) },
          'Selisih berarti jurnal tagihan diubah di luar dokumen.',
        ),
        this.queries.recon(
          'util-usage',
          'Pemakaian meter vs pemakaian ditagih',
          { label: 'Pemakaian pada catatan meter yang ditagih', value: Number(c.read_usage) },
          { label: 'Pemakaian pada tagihan', value: Number(c.bill_usage) },
          'Pencatatan meter dan tagihan harus sama; selisih menunjukkan tagihan yang tidak berasal dari catatan meter terverifikasi.',
        ),
        this.queries.recon(
          'util-ar',
          'Piutang usaha: sisa faktur vs saldo piutang usaha',
          { label: 'Sisa tagihan semua faktur (rupiah)', value: Number(arOpen[0].util) + Number(arOpen[0].other) },
          { label: 'Saldo akun Piutang Usaha di buku besar', value: arGl },
          'Akun piutang usaha hanya berisi piutang dari faktur; piutang lain (karyawan, klaim, dan sebagainya) ada di Akuntansi › Laporan akun lainnya.',
        ),
        this.queries.recon(
          'util-late',
          'Denda ditagih vs akun pendapatan denda',
          { label: 'Denda pada tagihan', value: Number(c.late) },
          { label: 'Akun Pendapatan Denda pada jurnal tagihan', value: Number(c.late_gl) },
        ),
      ],
      sections: [
        {
          key: 'util-readings',
          number: 'U1',
          title: 'Pencatatan meter per periode',
          paragraphs: [
            '"Ditandai" = catatan dengan tanda lonjakan, meter diganti, atau janggal lain yang wajib diperiksa.',
          ],
          tables: [
            {
              columns: ['Periode', 'Dicatat', 'Terverifikasi', 'Ditagih', 'Ditolak', 'Ditandai', 'Pemakaian ditagih'],
              align: [L, R, R, R, R, R, R],
              rows: periodRows,
              total: periodRows.length
                ? [
                    'Jumlah',
                    sum(periodRows, 1),
                    sum(periodRows, 2),
                    sum(periodRows, 3),
                    sum(periodRows, 4),
                    sum(periodRows, 5),
                    sum(periodRows, 6),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'util-bills',
          number: 'U2',
          title: 'Tagihan per periode',
          paragraphs: ['Faktur yang terbit pada rentang laporan, dikelompokkan menurut periode tagihan.'],
          tables: [
            {
              columns: ['Periode', 'Tagihan', 'Pemakaian', 'Subtotal (DPP)', 'Denda', 'Total', 'Dibayar', 'Sisa'],
              align: [L, R, R, R, R, R, R, R],
              rows: billRows,
              total: billRows.length
                ? [
                    'Jumlah',
                    sum(billRows, 1),
                    sum(billRows, 2),
                    sum(billRows, 3),
                    sum(billRows, 4),
                    sum(billRows, 5),
                    sum(billRows, 6),
                    sum(billRows, 7),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'util-arrears',
          number: 'U3',
          title: 'Tunggakan per tanggal akhir',
          paragraphs: ['Tagihan yang lewat jatuh tempo dan belum lunas.'],
          tables: [
            {
              columns: ['Sambungan', 'Pelanggan', 'Periode', 'Jatuh tempo', 'Terlambat (hari)', 'Total', 'Sisa'],
              align: [L, L, L, L, R, R, R],
              rows: arrearRows,
              total: arrearRows.length
                ? ['Jumlah', null, null, null, null, sum(arrearRows, 5), sum(arrearRows, 6)]
                : undefined,
            },
          ],
        },
        {
          key: 'util-ar',
          number: 'U4',
          title: 'Piutang usaha per tanggal akhir',
          paragraphs: [
            'Sisa tagihan faktur dipisahkan antara tagihan utilitas dan faktur penjualan lain. Piutang non-faktur tidak termasuk di sini.',
          ],
          tables: [
            { columns: ['Sumber', 'Sisa tagihan'], align: [L, R], rows: arRows, total: ['Jumlah', sum(arRows, 1)] },
          ],
        },
        {
          key: 'util-connections',
          number: 'U5',
          title: 'Sambungan per tarif',
          paragraphs: [],
          tables: [
            {
              columns: ['Tarif', 'Aktif', 'Ditangguhkan', 'Diputus'],
              align: [L, R, R, R],
              rows: connRows,
              total: connRows.length ? ['Jumlah', sum(connRows, 1), sum(connRows, 2), sum(connRows, 3)] : undefined,
            },
          ],
        },
      ],
    };
  }
}
