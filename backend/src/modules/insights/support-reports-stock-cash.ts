import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { todayJakarta } from '../../common/utils/dates';
import { SupportQueries } from './support-queries';
import { L, R, num, sum, type Cell, type SupportSection } from './support-shared';

@Injectable()
export class StockCashSupportReports {
  constructor(private readonly queries: SupportQueries) {}


  // ------------------------------------------------------------------ Persediaan
  async inventory(tenantId: string, from: string, to: string) {
    const r = await this.queries.rows<{
      sku: string;
      name: string;
      uom: string;
      q0: string;
      v0: string;
      qin: string;
      vin: string;
      qout: string;
      vout: string;
      q1: string;
      v1: string;
    }>(sql`
      SELECT p.sku, p.name, p.base_uom AS uom,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date < ${from}), 0)::text AS q0,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date < ${from}), 0)::text AS v0,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty > 0), 0)::text AS qin,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty > 0), 0)::text AS vin,
        COALESCE(-SUM(m.qty) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty < 0), 0)::text AS qout,
        COALESCE(-SUM(m.qty * m.unit_cost) FILTER (WHERE m.date BETWEEN ${from} AND ${to} AND m.qty < 0), 0)::text AS vout,
        COALESCE(SUM(m.qty) FILTER (WHERE m.date <= ${to}), 0)::text AS q1,
        COALESCE(SUM(m.qty * m.unit_cost) FILTER (WHERE m.date <= ${to}), 0)::text AS v1
      FROM products p JOIN stock_moves m ON m.product_id = p.id AND m.tenant_id = ${tenantId}
      WHERE p.tenant_id = ${tenantId} GROUP BY p.id, p.sku, p.name, p.base_uom
      HAVING COALESCE(SUM(m.qty) FILTER (WHERE m.date <= ${to}), 0) <> 0 OR COALESCE(SUM(ABS(m.qty)) FILTER (WHERE m.date BETWEEN ${from} AND ${to}), 0) <> 0
      ORDER BY p.sku`);
    const rows: Cell[][] = r.map((x) => [
      x.sku,
      x.name,
      x.uom,
      num(x.q0),
      num(x.qin),
      num(x.qout),
      num(x.q1),
      num(x.v0),
      num(x.vin),
      num(x.vout),
      num(x.v1),
    ]);
    const byWh = await this.queries.rows<{ code: string; name: string; qty: string; val: string }>(sql`
      SELECT w.code, w.name, COALESCE(SUM(m.qty), 0)::text AS qty, COALESCE(SUM(m.qty * m.unit_cost), 0)::text AS val
      FROM warehouses w JOIN stock_moves m ON m.warehouse_id = w.id AND m.tenant_id = ${tenantId} AND m.date <= ${to}
      WHERE w.tenant_id = ${tenantId} GROUP BY w.id, w.code, w.name ORDER BY w.code`);
    const whRows: Cell[][] = byWh.map((x) => [x.code, x.name, num(x.qty), num(x.val)]);
    const totalValue = sum(rows, 10);
    const glValue = await this.queries.glBalance(tenantId, to, sql`a.system_key IN ('INVENTORY', 'INVENTORY_SEMI')`);
    const [cur] = await this.queries.rows<{ v: string }>(
      sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE tenant_id = ${tenantId}`,
    );
    const reconciliation = [
      this.queries.recon(
        'inventory-gl',
        'Nilai persediaan vs buku besar',
        { label: 'Nilai stok menurut kartu stok (qty × biaya)', value: totalValue },
        { label: 'Saldo akun Persediaan di buku besar', value: glValue },
        'Selisih biasanya dari persediaan awal yang diisi lewat jurnal, jurnal manual ke akun persediaan, atau pembulatan biaya.',
      ),
    ];
    if (to >= todayJakarta())
      reconciliation.push(
        this.queries.recon(
          'inventory-balance',
          'Kartu stok vs saldo stok saat ini',
          { label: 'Nilai dari mutasi stok', value: totalValue },
          { label: 'Saldo stok (qty × biaya rata-rata)', value: Number(cur.v) },
          'Hanya dihitung bila tanggal akhir sampai hari ini.',
        ),
      );
    return {
      title: 'Laporan Pendukung Persediaan',
      summary:
        'Kartu stok ringkas per produk (saldo awal, masuk, keluar, saldo akhir) dalam jumlah dan nilai, dicocokkan dengan akun persediaan.',
      reconciliation,
      sections: [
        {
          key: 'inventory-card',
          number: 'P1',
          title: 'Mutasi persediaan per produk',
          paragraphs: ['Jumlah dalam satuan dasar. Nilai = jumlah × biaya per satuan pada setiap mutasi.'],
          tables: [
            {
              title: 'Jumlah',
              columns: ['SKU', 'Produk', 'Satuan', 'Awal', 'Masuk', 'Keluar', 'Akhir'],
              align: [L, L, L, R, R, R, R],
              rows: rows.map((x) => x.slice(0, 7)),
              total: rows.length
                ? ['Jumlah', null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6)]
                : undefined,
            },
            {
              title: 'Nilai (Rp)',
              columns: ['SKU', 'Produk', 'Nilai awal', 'Nilai masuk', 'Nilai keluar', 'Nilai akhir'],
              align: [L, L, R, R, R, R],
              rows: rows.map((x) => [x[0], x[1], x[7], x[8], x[9], x[10]]),
              total: rows.length
                ? ['Jumlah', null, sum(rows, 7), sum(rows, 8), sum(rows, 9), sum(rows, 10)]
                : undefined,
            },
          ],
        },
        {
          key: 'inventory-warehouse',
          number: 'P2',
          title: 'Persediaan per gudang pada tanggal akhir',
          paragraphs: [],
          tables: [
            {
              columns: ['Kode', 'Gudang', 'Jumlah', 'Nilai'],
              align: [L, L, R, R],
              rows: whRows,
              total: whRows.length ? ['Jumlah', null, null, sum(whRows, 3)] : undefined,
            },
          ],
        },
      ],
    };
  }


  // ------------------------------------------------------------------ Kas & bank
  async cash(tenantId: string, from: string, to: string) {
    const acc = await this.queries.rows<{
      id: string;
      code: string;
      name: string;
      o: string;
      dr: string;
      cr: string;
      c: string;
    }>(sql`
      SELECT a.id::text AS id, a.code, a.name,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date < ${from}), 0)::text AS o,
        COALESCE(SUM(l.debit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS dr,
        COALESCE(SUM(l.credit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS cr,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date <= ${to}), 0)::text AS c
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries j ON j.id = l.journal_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account GROUP BY a.id, a.code, a.name ORDER BY a.code`);
    const accRows: Cell[][] = acc.map((x) => [x.code, x.name, num(x.o), num(x.dr), num(x.cr), num(x.c)]);
    const bySrc = await this.queries.rows<{ src: string; dr: string; cr: string }>(sql`
      SELECT j.source_type AS src, COALESCE(SUM(l.debit), 0)::text AS dr, COALESCE(SUM(l.credit), 0)::text AS cr
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND j.date BETWEEN ${from} AND ${to} GROUP BY j.source_type ORDER BY 2 DESC`);
    const SRC: Record<string, string> = {
      PAYMENT: 'Pembayaran pelanggan',
      POS: 'Penjualan kasir',
      SUPPLIER_PAYMENT: 'Pembayaran pemasok',
      CASH_IN: 'Kas masuk',
      CASH_OUT: 'Kas keluar',
      CASH_TX: 'Transaksi kas',
      BANK: 'Mutasi bank',
      TRANSFER: 'Transfer antar kas/bank',
      PAYROLL: 'Penggajian',
      PETTY_CASH: 'Kas kecil',
      TAX_PAYMENT: 'Setoran pajak',
      MANUAL: 'Jurnal manual',
      OPENING: 'Saldo awal',
    };
    const srcRows: Cell[][] = bySrc.map((x) => [SRC[x.src] ?? x.src, num(x.dr), num(x.cr), num(x.dr) - num(x.cr)]);
    const banks = await this.queries.rows<{
      code: string;
      name: string;
      to_d: string;
      closing: string;
      unmatched: number;
      unmatched_amt: string;
      gl: string;
    }>(sql`
      SELECT a.code, a.name, s.period_to::text AS to_d, s.closing_balance::text AS closing,
        (SELECT COUNT(*)::int FROM bank_statement_lines b WHERE b.statement_id = s.id AND b.status = 'UNMATCHED') AS unmatched,
        (SELECT COALESCE(SUM(b.amount), 0)::text FROM bank_statement_lines b WHERE b.statement_id = s.id AND b.status = 'UNMATCHED') AS unmatched_amt,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0)::text FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE l.account_id = a.id AND j.tenant_id = ${tenantId} AND j.date <= s.period_to) AS gl
      FROM bank_statements s JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND s.closing_balance IS NOT NULL AND s.period_to <= ${to}
        AND s.period_to = (SELECT MAX(s2.period_to) FROM bank_statements s2 WHERE s2.cash_account_id = s.cash_account_id AND s2.closing_balance IS NOT NULL AND s2.period_to <= ${to})
      ORDER BY a.code`);
    const bankRows: Cell[][] = banks.map((x) => [
      x.code,
      x.name,
      x.to_d,
      num(x.closing),
      num(x.gl),
      num(x.closing) - num(x.gl),
      x.unmatched,
      num(x.unmatched_amt),
    ]);
    const totalClose = sum(accRows, 5);
    const glCash = await this.queries.glBalance(tenantId, to, sql`a.is_cash_account`);
    return {
      title: 'Laporan Pendukung Kas & Bank',
      summary:
        'Mutasi kas dan bank per akun, sumber penerimaan/pengeluaran, dan kecocokan dengan rekening koran yang sudah diimpor.',
      reconciliation: [
        this.queries.recon(
          'cash-gl',
          'Saldo akun kas/bank vs buku besar',
          { label: 'Jumlah saldo akhir semua akun kas/bank', value: totalClose },
          { label: 'Saldo kelompok kas/bank di buku besar', value: glCash },
        ),
        ...banks.map((x) =>
          this.queries.recon(
            `bank-${x.code}`,
            `Rekening koran ${x.code} ${x.name} per ${x.to_d}`,
            { label: 'Saldo akhir rekening koran', value: Number(x.closing) },
            { label: 'Saldo buku pada tanggal yang sama', value: Number(x.gl) },
            x.unmatched
              ? `${x.unmatched} mutasi bank belum dicocokkan (Rp${Math.round(Number(x.unmatched_amt)).toLocaleString('id-ID')}).`
              : undefined,
          ),
        ),
      ],
      sections: [
        {
          key: 'cash-accounts',
          number: 'P1',
          title: 'Mutasi per akun kas/bank',
          paragraphs: [],
          tables: [
            {
              columns: ['Kode', 'Akun', 'Saldo awal', 'Penerimaan', 'Pengeluaran', 'Saldo akhir'],
              align: [L, L, R, R, R, R],
              rows: accRows,
              total: accRows.length
                ? ['Jumlah', null, sum(accRows, 2), sum(accRows, 3), sum(accRows, 4), sum(accRows, 5)]
                : undefined,
            },
          ],
        },
        {
          key: 'cash-sources',
          number: 'P2',
          title: 'Penerimaan dan pengeluaran per sumber transaksi',
          paragraphs: ['Transfer antar akun kas muncul di kedua sisi dan saling meniadakan pada jumlah.'],
          tables: [
            {
              columns: ['Sumber', 'Penerimaan', 'Pengeluaran', 'Neto'],
              align: [L, R, R, R],
              rows: srcRows,
              total: srcRows.length ? ['Jumlah', sum(srcRows, 1), sum(srcRows, 2), sum(srcRows, 3)] : undefined,
            },
          ],
        },
        {
          key: 'cash-bank',
          number: 'P3',
          title: 'Kecocokan rekening koran (terbaru per rekening)',
          paragraphs: ['Hanya rekening yang mutasinya sudah diimpor di Kas & Bank › Cocokkan dengan bank.'],
          tables: [
            {
              columns: [
                'Kode',
                'Rekening',
                'Per tanggal',
                'Saldo bank',
                'Saldo buku',
                'Selisih',
                'Belum cocok',
                'Nilai belum cocok',
              ],
              align: [L, L, L, R, R, R, R, R],
              rows: bankRows,
            },
          ],
        },
      ],
    };
  }


  // ------------------------------------------------------------------ Akun lainnya
  async other(tenantId: string, from: string, to: string) {
    const acc = await this.queries.rows<{
      code: string;
      name: string;
      type: string;
      sk: string | null;
      cash: boolean;
      grp: string | null;
      o: string;
      dr: string;
      cr: string;
      c: string;
    }>(sql`
      SELECT a.code, a.name, a.type::text AS type, a.system_key AS sk, a.is_cash_account AS cash, a.report_group AS grp,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date < ${from}), 0)::text AS o,
        COALESCE(SUM(l.debit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS dr,
        COALESCE(SUM(l.credit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS cr,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date <= ${to}), 0)::text AS c
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries j ON j.id = l.journal_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} GROUP BY a.id, a.code, a.name, a.type, a.system_key, a.is_cash_account, a.report_group ORDER BY a.code`);
    const covered = (x: (typeof acc)[number]) =>
      x.cash || ['AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI', 'SALES', 'SALES_RETURN', 'COGS'].includes(x.sk ?? '');
    const active = (x: (typeof acc)[number]) =>
      Number(x.o) !== 0 || Number(x.dr) !== 0 || Number(x.cr) !== 0 || Number(x.c) !== 0;
    const groups: { key: string; title: string; types: string[]; credit: boolean; group?: string }[] = [
      {
        key: 'other-receivables',
        title: 'Piutang lain-lain (di luar piutang usaha)',
        types: ['ASSET'],
        credit: false,
        group: 'OTHER_RECEIVABLE',
      },
      { key: 'other-assets', title: 'Aset lain', types: ['ASSET'], credit: false },
      { key: 'other-liabilities', title: 'Liabilitas', types: ['LIABILITY'], credit: true },
      { key: 'other-equity', title: 'Ekuitas', types: ['EQUITY'], credit: true },
      { key: 'other-revenue', title: 'Pendapatan lain', types: ['REVENUE'], credit: true },
      { key: 'other-expense', title: 'Beban', types: ['EXPENSE'], credit: false },
    ];
    const sections: SupportSection[] = groups.map((g, i) => {
      const list = acc.filter(
        (x) =>
          g.types.includes(x.type) &&
          !covered(x) &&
          active(x) &&
          (g.group ? x.grp === g.group : !(g.types[0] === 'ASSET' && x.grp === 'OTHER_RECEIVABLE')),
      );
      const sign = g.credit ? -1 : 1;
      const rows: Cell[][] = list.map((x) => [
        x.code,
        x.name,
        num(sign * Number(x.o)),
        num(g.credit ? x.cr : x.dr),
        num(g.credit ? x.dr : x.cr),
        num(sign * Number(x.c)),
      ]);
      return {
        key: g.key,
        number: `P${i + 1}`,
        title: g.title,
        paragraphs:
          i === 0
            ? [
                'Piutang usaha (faktur penjualan) dilaporkan di laporan penjualan; piutang lain seperti karyawan, platform, klaim, retensi, dan antar cabang dipisahkan di bagian ini. Seluruh akun di luar kas/bank, piutang, utang usaha, persediaan, dan penjualan/HPP (yang punya laporan pendukung sendiri). Daftar aset tetap dan umur piutang/utang ada di Lampiran Laporan Keuangan.',
              ]
            : [],
        tables: [
          {
            columns: [
              'Kode',
              'Akun',
              'Saldo awal',
              g.credit ? 'Kredit' : 'Debit',
              g.credit ? 'Debit' : 'Kredit',
              'Saldo akhir',
            ],
            align: [L, L, R, R, R, R],
            rows,
            total: rows.length ? ['Jumlah', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] : undefined,
          },
        ],
      };
    });
    const tax = acc.filter((x) =>
      [
        'VAT_IN',
        'VAT_OUT',
        'PPH21_PAYABLE',
        'PPH23_PAYABLE',
        'PPH4_2_PAYABLE',
        'FINAL_TAX_WITHHELD',
        'CORPORATE_TAX_PAYABLE',
      ].includes(x.sk ?? ''),
    );
    const taxRows: Cell[][] = tax.map((x) => [
      x.code,
      x.name,
      num(Number(x.o)),
      num(x.dr),
      num(x.cr),
      num(Number(x.c)),
    ]);
    sections.push({
      key: 'other-tax',
      number: `P${sections.length + 1}`,
      title: 'Pajak: saldo akun PPN dan PPh',
      paragraphs: [
        'Saldo debit (positif) = lebih bayar/dapat dikreditkan; saldo kredit (negatif) = masih harus disetor. Cocokkan dengan Setoran Pajak.',
      ],
      tables: [
        {
          columns: ['Kode', 'Akun', 'Saldo awal (D−K)', 'Debit', 'Kredit', 'Saldo akhir (D−K)'],
          align: [L, L, R, R, R, R],
          rows: taxRows,
        },
      ],
    });
    return {
      title: 'Laporan Pendukung Akun Lainnya',
      summary:
        'Mutasi seluruh akun yang tidak tercakup laporan pendukung lain: aset lain, liabilitas, ekuitas, pendapatan dan beban lain, serta saldo pajak.',
      reconciliation: [
        this.queries.recon(
          'other-balance',
          'Neraca saldo seimbang',
          { label: 'Jumlah saldo debit seluruh akun', value: acc.reduce((a, x) => a + Math.max(Number(x.c), 0), 0) },
          { label: 'Jumlah saldo kredit seluruh akun', value: acc.reduce((a, x) => a + Math.max(-Number(x.c), 0), 0) },
        ),
      ],
      sections,
    };
  }
}
