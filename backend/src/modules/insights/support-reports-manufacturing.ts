import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { todayJakarta } from '../../common/utils/dates';
import { SupportQueries } from './support-queries';
import { Cell, num, CAP, L, R, sum } from './support-shared';

@Injectable()
export class ManufacturingSupportReports {
  constructor(private readonly queries: SupportQueries) {}


  // ------------------------------------------------------------------ FMCG
  async fmcg(tenantId: string, from: string, to: string) {
    const today = todayJakarta();
    const p1 = from.slice(0, 7);
    const p2 = to.slice(0, 7);
    const bySales = await this.queries.rows<{ name: string | null; n: number; sub: string; rsub: string }>(sql`
      SELECT u.name, COUNT(i.id)::int AS n, COALESCE(SUM(i.subtotal), 0)::text AS sub,
        COALESCE(SUM((SELECT SUM(r.subtotal) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date BETWEEN ${from} AND ${to})), 0)::text AS rsub
      FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id LEFT JOIN users u ON u.id = so.salesperson_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening GROUP BY u.id, u.name ORDER BY SUM(i.subtotal) DESC`);
    const salesRows: Cell[][] = bySales.map((r) => [
      r.name ?? 'Tanpa sales',
      r.n,
      num(r.sub),
      num(r.rsub),
      num(r.sub) - num(r.rsub),
    ]);
    const comm = await this.queries.rows<{
      number: string;
      name: string;
      period: string;
      net: string;
      target: string;
      pct: string;
      amount: string;
      status: string;
    }>(sql`
      SELECT c.number, u.name, c.period, c.net_sales::text AS net, c.target_amount::text AS target, c.commission_pct::text AS pct, c.amount::text AS amount, c.status
      FROM sales_commissions c JOIN users u ON u.id = c.user_id
      WHERE c.tenant_id = ${tenantId} AND c.period BETWEEN ${p1} AND ${p2} ORDER BY c.period, u.name LIMIT ${CAP}`);
    const STATUS: Record<string, string> = { ACCRUED: 'Utang komisi', PAID: 'Dibayar', VOID: 'Dibatalkan' };
    const commRows: Cell[][] = comm.map((r) => [
      r.number,
      r.name,
      r.period,
      num(r.net),
      num(r.target),
      num(r.target) ? num((num(r.net) / num(r.target)) * 100) : null,
      num(r.pct),
      num(r.amount),
      STATUS[r.status] ?? r.status,
    ]);
    const promos = await this.queries.rows<{
      name: string;
      kind: string;
      n: number;
      bonus: string;
      funded: string;
      claimed: string;
    }>(sql`
      SELECT p.name, p.kind, COUNT(l.id)::int AS n,
        COALESCE(SUM(l.qty * l.uom_factor) FILTER (WHERE l.is_bonus), 0)::text AS bonus, p.funded_pct::text AS funded,
        COALESCE((SELECT SUM(cl.amount) FROM principal_claim_lines cl WHERE cl.promo_id = p.id AND cl.tenant_id = ${tenantId}), 0)::text AS claimed
      FROM promos p JOIN sales_order_lines l ON l.promo_id = p.id JOIN sales_orders so ON so.id = l.order_id
      WHERE p.tenant_id = ${tenantId} AND so.date BETWEEN ${from} AND ${to} AND so.status <> 'CANCELLED'
      GROUP BY p.id, p.name, p.kind, p.funded_pct ORDER BY p.name LIMIT ${CAP}`);
    const promoRows: Cell[][] = promos.map((r) => [
      r.name,
      r.kind === 'BONUS' ? 'Bonus barang' : 'Diskon',
      r.n,
      num(r.bonus),
      num(r.funded),
      num(r.claimed),
    ]);
    const claims = await this.queries.rows<{
      number: string;
      supplier: string;
      period: string;
      claimed: string;
      approved: string;
      status: string;
    }>(sql`
      SELECT c.number, s.name AS supplier, c.period, c.claimed_amount::text AS claimed, c.approved_amount::text AS approved, c.status
      FROM principal_claims c JOIN suppliers s ON s.id = c.supplier_id
      WHERE c.tenant_id = ${tenantId} AND c.period BETWEEN ${p1} AND ${p2} ORDER BY c.period, c.number LIMIT ${CAP}`);
    const CS: Record<string, string> = {
      DRAFT: 'Draf',
      SUBMITTED: 'Diajukan',
      APPROVED: 'Disetujui (belum cair)',
      PAID: 'Cair',
      REJECTED: 'Ditolak',
    };
    const claimRows: Cell[][] = claims.map((r) => [
      r.number,
      r.supplier,
      r.period,
      num(r.claimed),
      num(r.approved),
      CS[r.status] ?? r.status,
    ]);
    const accruals = await this.queries.rows<{
      number: string;
      customer: string;
      term: string;
      period: string;
      base: string;
      amount: string;
      settled: string;
      voided: boolean;
    }>(sql`
      SELECT a.number, c.name AS customer, t.name AS term, a.period, a.base_amount::text AS base, a.amount::text AS amount,
        COALESCE((SELECT SUM(x.amount) FROM trade_accrual_settlements x WHERE x.accrual_id = a.id AND x.date <= ${to}), 0)::text AS settled,
        EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = a.accrual_journal_id AND r.date <= ${to}) AS voided
      FROM trade_accruals a JOIN customers c ON c.id = a.customer_id JOIN trade_terms t ON t.id = a.term_id
      WHERE a.tenant_id = ${tenantId} AND a.period BETWEEN ${p1} AND ${p2} ORDER BY a.period, c.name LIMIT ${CAP}`);
    const accRows: Cell[][] = accruals.map((r) => [
      r.number,
      r.customer,
      r.term,
      r.period,
      num(r.base),
      num(r.amount),
      num(r.settled),
      num(r.amount) - num(r.settled),
      r.voided ? 'Dibatalkan' : num(r.amount) - num(r.settled) > 0.5 ? 'Utang' : 'Lunas',
    ]);
    const swaps = await this.queries.rows<{ reason: string; n: number; cost: string }>(sql`
      SELECT reason, COUNT(*)::int AS n, COALESCE(SUM(cost_amount), 0)::text AS cost FROM goods_swaps
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND date BETWEEN ${from} AND ${to} GROUP BY reason ORDER BY reason`);
    const RS: Record<string, string> = { EXPIRED: 'Kedaluwarsa', DAMAGED: 'Rusak', RECALL: 'Penarikan (recall)' };
    const swapRows: Cell[][] = swaps.map((r) => [RS[r.reason] ?? r.reason, r.n, num(r.cost)]);
    const consign = await this.queries.rows<{
      customer: string;
      sku: string;
      name: string;
      qty: string;
      val: string;
    }>(sql`
      SELECT c.name AS customer, p.sku, p.name, b.qty::text AS qty, (b.qty * b.avg_cost)::text AS val
      FROM (SELECT DISTINCT customer_id, warehouse_id FROM consignment_docs WHERE tenant_id = ${tenantId}) d
      JOIN customers c ON c.id = d.customer_id JOIN stock_balances b ON b.warehouse_id = d.warehouse_id AND b.tenant_id = ${tenantId}
      JOIN products p ON p.id = b.product_id WHERE b.qty <> 0 ORDER BY c.name, p.name LIMIT ${CAP}`);
    const consignRows: Cell[][] = consign.map((r) => [r.customer, r.sku, r.name, num(r.qty), num(r.val)]);
    const [pend] = await this.queries.rows<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM consignment_docs WHERE tenant_id = ${tenantId} AND kind = 'REPORT' AND status = 'REPORTED'`,
    );
    const canvass = await this.queries.rows<{
      name: string;
      n: number;
      amount: string;
      received: string;
      shortage: string;
      pending: string;
      rejected: string;
    }>(sql`
      SELECT u.name, COUNT(*)::int AS n, SUM(c.amount)::text AS amount,
        COALESCE(SUM(c.received_amount) FILTER (WHERE c.status = 'VERIFIED'), 0)::text AS received,
        COALESCE(SUM(c.shortage) FILTER (WHERE c.status = 'VERIFIED'), 0)::text AS shortage,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PENDING'), 0)::text AS pending,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'REJECTED'), 0)::text AS rejected
      FROM canvass_collections c JOIN users u ON u.id = c.user_id
      WHERE c.tenant_id = ${tenantId} AND c.date BETWEEN ${from} AND ${to} GROUP BY u.id, u.name ORDER BY u.name`);
    const canvassRows: Cell[][] = canvass.map((r) => [
      r.name,
      r.n,
      num(r.amount),
      num(r.received),
      num(r.shortage),
      num(r.pending),
      num(r.rejected),
    ]);

    // Pencocokan: status dokumen dibandingkan dengan saldo akun per hari ini (status dokumen tidak menyimpan riwayat)
    const [d] = await this.queries.rows<{
      comm_acc: string;
      comm_gl: string;
      comm_open: string;
      trade_open: string;
      claim_open: string;
      swap_doc: string;
      swap_gl: string;
      short_doc: string;
      short_gl: string;
    }>(sql`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM sales_commissions WHERE tenant_id = ${tenantId} AND status <> 'VOID' AND accrual_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to}))::text AS comm_acc,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key = 'SALES_COMMISSION' AND l.journal_id IN (SELECT accrual_journal_id FROM sales_commissions WHERE tenant_id = ${tenantId} AND status <> 'VOID' AND accrual_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to})))::text AS comm_gl,
        (SELECT COALESCE(SUM(c.amount), 0) FROM sales_commissions c JOIN journal_entries ja ON ja.id = c.accrual_journal_id
          WHERE c.tenant_id = ${tenantId} AND ja.date <= ${to}
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = ja.id AND r.date <= ${to})
            AND NOT EXISTS (SELECT 1 FROM journal_entries jp WHERE jp.id = c.payment_journal_id AND jp.date <= ${to}))::text AS comm_open,
        (SELECT COALESCE(SUM(a.amount - COALESCE((SELECT SUM(x.amount) FROM trade_accrual_settlements x WHERE x.accrual_id = a.id AND x.date <= ${to}), 0)), 0) FROM trade_accruals a
          JOIN journal_entries ja ON ja.id = a.accrual_journal_id
          WHERE a.tenant_id = ${tenantId} AND ja.date <= ${to} AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = ja.id AND r.date <= ${to}))::text AS trade_open,
        (SELECT COALESCE(SUM(c.approved_amount), 0) FROM principal_claims c JOIN journal_entries ja ON ja.id = c.approval_journal_id
          WHERE c.tenant_id = ${tenantId} AND ja.date <= ${to}
            AND NOT EXISTS (SELECT 1 FROM journal_entries jp WHERE jp.id = c.payment_journal_id AND jp.date <= ${to}))::text AS claim_open,
        (SELECT COALESCE(SUM(cost_amount), 0) FROM goods_swaps WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND date BETWEEN ${from} AND ${to})::text AS swap_doc,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key IN ('EXPIRED_LOSS', 'DAMAGE_LOSS', 'RECALL_LOSS') AND l.journal_id IN (SELECT journal_id FROM goods_swaps WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL))::text AS swap_gl,
        (SELECT COALESCE(SUM(shortage), 0) FROM canvass_collections WHERE tenant_id = ${tenantId} AND status = 'VERIFIED' AND date BETWEEN ${from} AND ${to})::text AS short_doc,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key = 'EMPLOYEE_RECEIVABLE' AND l.journal_id IN (SELECT p.journal_id FROM payments p JOIN canvass_collections c ON c.payment_id = p.id
            WHERE c.tenant_id = ${tenantId} AND c.status = 'VERIFIED' AND c.date BETWEEN ${from} AND ${to} AND p.journal_id IS NOT NULL))::text AS short_gl`);
    const commPay = -(await this.queries.glBalance(tenantId, to, sql`a.system_key = 'COMMISSION_PAYABLE'`));
    const tradePay = -(await this.queries.glBalance(tenantId, to, sql`a.system_key = 'TRADE_ACCRUAL_PAYABLE'`));
    const claimGl = await this.queries.glBalance(tenantId, to, sql`a.system_key = 'PRINCIPAL_CLAIM'`);

    return {
      title: 'Laporan Pendukung FMCG',
      summary:
        'Penjualan per sales, komisi, promo dan klaim prinsipal, rebate outlet, tukar-guling, konsinyasi, dan setoran kanvas, dicocokkan dengan buku besar.',
      reconciliation: [
        this.queries.recon(
          'fmcg-commission',
          'Komisi sales (periode) vs beban komisi',
          { label: 'Komisi ditutup pada periode (tidak dibatalkan)', value: Number(d.comm_acc) },
          { label: 'Akun Beban Komisi pada jurnal komisi tersebut', value: Number(d.comm_gl) },
        ),
        this.queries.recon(
          'fmcg-commission-payable',
          'Komisi belum dibayar vs utang komisi',
          { label: 'Komisi ditutup, belum dibayar, tidak dibatalkan (per tanggal akhir)', value: Number(d.comm_open) },
          { label: 'Saldo akun Utang Komisi Sales per tanggal akhir', value: commPay },
        ),
        this.queries.recon(
          'fmcg-trade',
          'Rebate outlet belum dilunasi vs utang rebate',
          { label: 'Sisa utang rebate/trade promo (per tanggal akhir)', value: Number(d.trade_open) },
          { label: 'Saldo akun Utang Rebate & Trade Promo Outlet per tanggal akhir', value: tradePay },
          'Dihitung dari riwayat pelunasan per tanggal.',
        ),
        this.queries.recon(
          'fmcg-claim',
          'Klaim disetujui belum cair vs piutang prinsipal',
          { label: 'Klaim disetujui belum cair (per tanggal akhir)', value: Number(d.claim_open) },
          { label: 'Saldo akun Piutang Klaim Promo ke Prinsipal per tanggal akhir', value: claimGl },
        ),
        this.queries.recon(
          'fmcg-swap',
          'Tukar-guling disetujui vs akun kerugian',
          { label: 'Biaya tukar-guling disetujui pada periode', value: Number(d.swap_doc) },
          { label: 'Akun kerugian kedaluwarsa/rusak/recall pada jurnal tukar-guling', value: Number(d.swap_gl) },
        ),
        this.queries.recon(
          'fmcg-canvass',
          'Kurang setor kanvas vs piutang karyawan',
          { label: 'Kurang setor pada setoran diverifikasi', value: Number(d.short_doc) },
          { label: 'Debit Piutang Karyawan pada jurnal pelunasan kanvas', value: Number(d.short_gl) },
          'Kurang setor menjadi piutang karyawan sampai dipotong atau dilunasi.',
        ),
      ],
      sections: [
        {
          key: 'fmcg-sales',
          number: 'M1',
          title: 'Penjualan per sales',
          paragraphs: ['Faktur dari pesanan yang dipegang sales (DPP), dikurangi retur pada periode.'],
          tables: [
            {
              columns: ['Sales', 'Faktur', 'Penjualan (DPP)', 'Retur (DPP)', 'Neto'],
              align: [L, R, R, R, R],
              rows: salesRows,
              total: salesRows.length
                ? ['Jumlah', sum(salesRows, 1), sum(salesRows, 2), sum(salesRows, 3), sum(salesRows, 4)]
                : undefined,
            },
          ],
        },
        {
          key: 'fmcg-commission',
          number: 'M2',
          title: 'Target dan komisi sales',
          paragraphs: ['Angka dibekukan saat komisi ditutup. Capaian = penjualan neto ÷ target.'],
          tables: [
            {
              columns: [
                'Nomor',
                'Sales',
                'Periode',
                'Penjualan neto',
                'Target',
                'Capaian %',
                'Komisi %',
                'Komisi',
                'Status',
              ],
              align: [L, L, L, R, R, R, R, R, L],
              rows: commRows,
              total: commRows.length
                ? ['Jumlah', null, null, sum(commRows, 3), null, null, null, sum(commRows, 7), null]
                : undefined,
            },
          ],
        },
        {
          key: 'fmcg-promo',
          number: 'M3',
          title: 'Pemakaian promo dan klaim ke prinsipal',
          paragraphs: ['"Diklaim" = nilai pada klaim prinsipal untuk promo itu (semua periode).'],
          tables: [
            {
              title: 'Promo yang dipakai pada periode',
              columns: ['Promo', 'Jenis', 'Baris pesanan', 'Barang bonus', 'Ditanggung prinsipal %', 'Diklaim'],
              align: [L, L, R, R, R, R],
              rows: promoRows,
            },
            {
              title: 'Klaim prinsipal',
              columns: ['Nomor', 'Prinsipal', 'Periode', 'Diklaim', 'Disetujui', 'Status'],
              align: [L, L, L, R, R, L],
              rows: claimRows,
              total: claimRows.length ? ['Jumlah', null, null, sum(claimRows, 3), sum(claimRows, 4), null] : undefined,
            },
          ],
        },
        {
          key: 'fmcg-trade',
          number: 'M4',
          title: 'Rebate dan trade promo outlet',
          paragraphs: [],
          tables: [
            {
              columns: ['Nomor', 'Outlet', 'Syarat', 'Periode', 'Dasar', 'Rebate', 'Dilunasi', 'Sisa', 'Status'],
              align: [L, L, L, L, R, R, R, R, L],
              rows: accRows,
              total: accRows.length
                ? ['Jumlah', null, null, null, sum(accRows, 4), sum(accRows, 5), sum(accRows, 6), sum(accRows, 7), null]
                : undefined,
            },
          ],
        },
        {
          key: 'fmcg-swap',
          number: 'M5',
          title: 'Tukar-guling',
          paragraphs: ['Hanya yang sudah disetujui; nilai = harga pokok barang yang ditarik.'],
          tables: [
            {
              columns: ['Alasan', 'Dokumen', 'Biaya'],
              align: [L, R, R],
              rows: swapRows,
              total: swapRows.length ? ['Jumlah', sum(swapRows, 1), sum(swapRows, 2)] : undefined,
            },
          ],
        },
        {
          key: 'fmcg-consign',
          number: 'M6',
          title: 'Konsinyasi: sisa titipan di outlet',
          paragraphs: [
            `Saldo stok di gudang konsinyasi per hari ini (satuan dasar) beserta nilainya pada harga pokok rata-rata; nilai ini termasuk dalam akun persediaan. Laporan penjualan outlet yang belum ditagih: ${pend.n}.`,
          ],
          tables: [
            {
              columns: ['Outlet', 'SKU', 'Produk', 'Sisa titipan', 'Nilai (harga pokok)'],
              align: [L, L, L, R, R],
              rows: consignRows,
              total: consignRows.length ? ['Jumlah', null, null, null, sum(consignRows, 4)] : undefined,
            },
          ],
        },
        {
          key: 'fmcg-canvass',
          number: 'M7',
          title: 'Setoran tagihan kanvas per sales',
          paragraphs: [
            'Uang tagihan di tangan sales baru menjadi pelunasan setelah Keuangan menerima. "Belum diverifikasi" adalah uang yang masih ditahan sales.',
          ],
          tables: [
            {
              columns: [
                'Sales',
                'Setoran',
                'Dicatat sales',
                'Diterima',
                'Kurang setor',
                'Belum diverifikasi',
                'Ditolak',
              ],
              align: [L, R, R, R, R, R, R],
              rows: canvassRows,
              total: canvassRows.length
                ? [
                    'Jumlah',
                    sum(canvassRows, 1),
                    sum(canvassRows, 2),
                    sum(canvassRows, 3),
                    sum(canvassRows, 4),
                    sum(canvassRows, 5),
                    sum(canvassRows, 6),
                  ]
                : undefined,
            },
          ],
        },
      ],
    };
  }


  // ------------------------------------------------------------------ Manufaktur
  async mfg(tenantId: string, from: string, to: string) {
    const done = await this.queries.rows<{
      number: string;
      parent: string | null;
      sku: string;
      name: string;
      d: string;
      batches: string;
      planned: string;
      out: string;
      mat: string;
      labor: string;
      oh: string;
      tot: string;
    }>(sql`
      SELECT o.number, po.number AS parent, p.sku, p.name, o.completed_date::text AS d, o.batches::text AS batches, o.planned_qty::text AS planned, o.output_qty::text AS out,
        o.material_cost::text AS mat, o.labor_cost::text AS labor, o.overhead_cost::text AS oh, o.total_cost::text AS tot
      FROM production_orders o JOIN products p ON p.id = o.product_id LEFT JOIN production_orders po ON po.id = o.parent_order_id
      WHERE o.tenant_id = ${tenantId} AND o.status = 'COMPLETED' AND o.completed_date BETWEEN ${from} AND ${to} ORDER BY o.completed_date, o.number LIMIT ${CAP}`);
    const doneRows: Cell[][] = done.map((r) => [
      r.number,
      r.parent ?? '-',
      r.sku,
      r.name,
      r.d,
      num(r.planned),
      num(r.out),
      num(r.planned) ? num((num(r.out) / num(r.planned)) * 100) : null,
      num(r.mat),
      num(r.labor),
      num(r.oh),
      num(r.tot),
      num(r.out) ? num(num(r.tot) / num(r.out)) : 0,
    ]);
    const usage = await this.queries.rows<{
      sku: string;
      name: string;
      planned: string;
      issued: string;
      planned_v: string;
      issued_v: string;
    }>(sql`
      SELECT p.sku, p.name, SUM(l.planned_qty)::text AS planned, SUM(l.issued_qty)::text AS issued,
        SUM(l.planned_qty * l.unit_cost)::text AS planned_v, SUM(l.value)::text AS issued_v
      FROM production_order_lines l JOIN production_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
      WHERE o.tenant_id = ${tenantId} AND o.status IN ('IN_PROGRESS', 'COMPLETED') AND o.started_date BETWEEN ${from} AND ${to}
      GROUP BY p.id, p.sku, p.name ORDER BY SUM(l.value - l.planned_qty * l.unit_cost) DESC LIMIT ${CAP}`);
    const usageRows: Cell[][] = usage.map((r) => [
      r.sku,
      r.name,
      num(r.planned),
      num(r.issued),
      num(r.issued) - num(r.planned),
      num(r.issued_v) - num(r.planned_v),
    ]);
    const wip = await this.queries.rows<{
      number: string;
      name: string;
      started: string;
      age: number;
      mat: string;
    }>(sql`
      SELECT o.number, p.name, o.started_date::text AS started, (${to}::date - o.started_date)::int AS age, o.material_cost::text AS mat
      FROM production_orders o JOIN products p ON p.id = o.product_id
      WHERE o.tenant_id = ${tenantId} AND o.started_date IS NOT NULL AND o.started_date <= ${to}
        AND (o.completed_date IS NULL OR o.completed_date > ${to}) AND (o.cancelled_date IS NULL OR o.cancelled_date > ${to}) ORDER BY o.started_date LIMIT ${CAP}`);
    const wipRows: Cell[][] = wip.map((r) => [r.number, r.name, r.started, r.age, num(r.mat)]);

    const [c] = await this.queries.rows<{
      start_doc: string;
      start_gl: string;
      done_doc: string;
      done_gl: string;
      wip_doc: string;
      applied: string;
      actual: string;
    }>(sql`
      SELECT
        (SELECT COALESCE(SUM(material_cost), 0) FROM production_orders WHERE tenant_id = ${tenantId} AND start_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to}))::text AS start_doc,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key = 'WIP' AND l.journal_id IN (SELECT start_journal_id FROM production_orders WHERE tenant_id = ${tenantId} AND start_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to})))::text AS start_gl,
        (SELECT COALESCE(SUM(total_cost), 0) FROM production_orders WHERE tenant_id = ${tenantId} AND status = 'COMPLETED' AND completed_date BETWEEN ${from} AND ${to})::text AS done_doc,
        (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key IN ('WIP', 'APPLIED_PRODUCTION_COST') AND l.journal_id IN (SELECT complete_journal_id FROM production_orders WHERE tenant_id = ${tenantId} AND status = 'COMPLETED' AND completed_date BETWEEN ${from} AND ${to}))::text AS done_gl,
        (SELECT COALESCE(SUM(material_cost), 0) FROM production_orders o WHERE o.tenant_id = ${tenantId} AND o.started_date IS NOT NULL AND o.started_date <= ${to}
          AND (o.completed_date IS NULL OR o.completed_date > ${to}) AND (o.cancelled_date IS NULL OR o.cancelled_date > ${to}))::text AS wip_doc,
        (SELECT COALESCE(SUM(labor_cost + overhead_cost), 0) FROM production_orders WHERE tenant_id = ${tenantId} AND status = 'COMPLETED' AND completed_date BETWEEN ${from} AND ${to})::text AS applied,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
          WHERE j.tenant_id = ${tenantId} AND a.system_key IN ('DIRECT_LABOR', 'FACTORY_OVERHEAD') AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING')::text AS actual`);
    const wipGl = await this.queries.glBalance(tenantId, to, sql`a.system_key = 'WIP'`);

    return {
      title: 'Laporan Pendukung Produksi',
      summary:
        'Hasil produksi dan biaya per perintah, pemakaian bahan dibanding resep, barang dalam proses, dan biaya konversi, dicocokkan dengan buku besar.',
      reconciliation: [
        this.queries.recon(
          'mfg-start',
          'Bahan masuk produksi vs barang dalam proses',
          { label: 'Nilai bahan dikeluarkan pada periode', value: Number(c.start_doc) },
          { label: 'Debit Barang Dalam Proses pada jurnal mulai produksi', value: Number(c.start_gl) },
        ),
        this.queries.recon(
          'mfg-done',
          'Hasil produksi vs jurnal selesai',
          { label: 'Biaya produksi perintah selesai pada periode', value: Number(c.done_doc) },
          { label: 'Kredit BDP dan biaya konversi dibebankan pada jurnal selesai', value: Number(c.done_gl) },
          'Selisih kecil dapat berasal dari pembulatan nilai stok hasil produksi.',
        ),
        this.queries.recon(
          'mfg-wip',
          'Perintah berjalan vs saldo barang dalam proses',
          { label: 'Bahan pada perintah yang belum selesai/batal per tanggal akhir', value: Number(c.wip_doc) },
          { label: 'Saldo akun Barang Dalam Proses', value: wipGl },
          'Selisih berarti ada jurnal manual ke akun BDP atau perintah dihapus.',
        ),
        this.queries.recon(
          'mfg-conversion',
          'Biaya konversi dibebankan vs aktual',
          { label: 'Upah + overhead dibebankan ke hasil produksi', value: Number(c.applied) },
          { label: 'Upah langsung + overhead pabrik aktual (buku besar)', value: Number(c.actual) },
          'Selisih adalah selisih biaya produksi (kurang/lebih dibebankan), bukan kesalahan pembukuan; analisis di menu Analisis selisih.',
        ),
      ],
      sections: [
        {
          key: 'mfg-done',
          number: 'M1',
          title: 'Perintah produksi selesai',
          paragraphs: [
            'Rendemen = hasil ÷ rencana. Biaya/unit = total biaya ÷ hasil. Kolom Induk terisi bila perintah ini membuat barang setengah jadi bagi perintah tingkat atas; nilainya sudah termasuk dalam biaya perintah induk.',
          ],
          tables: [
            {
              columns: [
                'Nomor',
                'Induk',
                'SKU',
                'Produk',
                'Selesai',
                'Rencana',
                'Hasil',
                'Rendemen %',
                'Bahan',
                'Upah',
                'Overhead',
                'Total',
                'Biaya/unit',
              ],
              align: [L, L, L, L, L, R, R, R, R, R, R, R, R],
              rows: doneRows,
              total: doneRows.length
                ? [
                    'Jumlah',
                    null,
                    null,
                    null,
                    null,
                    sum(doneRows, 5),
                    sum(doneRows, 6),
                    null,
                    sum(doneRows, 8),
                    sum(doneRows, 9),
                    sum(doneRows, 10),
                    sum(doneRows, 11),
                    null,
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'mfg-usage',
          number: 'M2',
          title: 'Pemakaian bahan vs resep',
          paragraphs: [
            'Perintah yang dimulai pada periode. Selisih positif = bahan terpakai lebih banyak dari resep. Nilai selisih = nilai keluar − kebutuhan resep pada harga yang sama.',
          ],
          tables: [
            {
              columns: ['SKU', 'Bahan', 'Menurut resep', 'Dikeluarkan', 'Selisih jumlah', 'Selisih nilai'],
              align: [L, L, R, R, R, R],
              rows: usageRows,
              total: usageRows.length ? ['Jumlah', null, null, null, null, sum(usageRows, 5)] : undefined,
            },
          ],
        },
        {
          key: 'mfg-wip',
          number: 'M3',
          title: 'Barang dalam proses per tanggal akhir',
          paragraphs: [
            'Perintah yang sudah mengeluarkan bahan tetapi belum selesai atau dibatalkan. Umur panjang menandakan produksi macet atau lupa diselesaikan.',
          ],
          tables: [
            {
              columns: ['Nomor', 'Produk', 'Mulai', 'Umur (hari)', 'Nilai bahan'],
              align: [L, L, L, R, R],
              rows: wipRows,
              total: wipRows.length ? ['Jumlah', null, null, null, sum(wipRows, 4)] : undefined,
            },
          ],
        },
      ],
    };
  }
}
