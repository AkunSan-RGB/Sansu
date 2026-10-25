/**
 * Laporan pendukung: rincian per bidang (penjualan, pembelian, persediaan, kas & bank, akun lainnya) yang dapat
 * dipertanggungjawabkan di luar laporan keuangan. Setiap laporan memuat rincian dari dokumen/kartu pembantu dan
 * "pencocokan dengan buku besar": angka rincian dibandingkan dengan saldo/mutasi akun di buku besar, selisihnya ditampilkan apa adanya.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SettingsService } from '../../common/settings.service';
import { conclude, DEFAULT_THRESHOLDS, type InsightThresholds } from './support-insights';
import { SupportQueries } from './support-queries';
import { IndustrySupportReports } from './support-reports-industry';

export * from './support-shared';
import {
  CAP,
  L,
  R,
  num,
  sum,
  withRest,
  SUPPORT_KINDS,
  type Cell,
  type SupportKind,
  type SupportSection,
  type Reconciliation,
} from './support-shared';

const INDUSTRY_KINDS = new Set<SupportKind>(['pos', 'fnb', 'fmcg', 'mfg', 'jasa', 'utility']);

@Injectable()
export class SupportReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly queries: SupportQueries,
    private readonly industry: IndustrySupportReports,
  ) {}

  thresholds(tenantId: string): Promise<InsightThresholds> {
    return this.settings.section(this.db, tenantId, 'supportInsights', DEFAULT_THRESHOLDS);
  }

  saveThresholds(tenantId: string, value: InsightThresholds): Promise<InsightThresholds> {
    return this.settings.saveSection(this.db, tenantId, 'supportInsights', DEFAULT_THRESHOLDS, value);
  }

  async build(tenantId: string, kind: SupportKind, fromIn?: string, toIn?: string) {
    if (!SUPPORT_KINDS.includes(kind)) throw new BadRequestException('Jenis laporan pendukung tidak dikenal');
    const to = toDocDate(toIn);
    const from = fromIn ? toDocDate(fromIn) : `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh setelah tanggal akhir');
    // laporan umum ada di service ini, laporan per jenis usaha di IndustrySupportReports
    const owner = (INDUSTRY_KINDS.has(kind) ? this.industry : this) as unknown as Record<string, unknown>;
    const out = await (
      owner[kind] as (
        t: string,
        f: string,
        e: string,
      ) => Promise<{ title: string; summary: string; sections: SupportSection[]; reconciliation: Reconciliation[] }>
    ).call(owner, tenantId, from, to);
    for (const sec of out.sections)
      if (sec.tables.some((t) => t.rows.length >= CAP))
        sec.paragraphs = [
          ...sec.paragraphs,
          `Tabel dipotong pada ${CAP} baris pertama; persempit periode untuk melihat sisanya.`,
        ];
    const period = { from, to };
    return {
      kind,
      ...out,
      period,
      conclusion: conclude(kind, { ...out, period }, await this.thresholds(tenantId)),
      generatedAt: new Date().toISOString(),
      today: todayJakarta(),
    };
  }

  // ------------------------------------------------------------------ Penjualan
  private async sales(tenantId: string, from: string, to: string) {
    const monthly = await this.queries.rows<{
      m: string;
      n: number;
      sub: string;
      tax: string;
      tot: string;
      cogs: string;
      rsub: string;
      rtax: string;
    }>(sql`
      WITH inv AS (
        SELECT to_char(date, 'YYYY-MM') AS m, COUNT(*)::int AS n, SUM(subtotal) AS sub, SUM(tax_amount) AS tax, SUM(total) AS tot, SUM(cogs_amount) AS cogs
        FROM invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND NOT is_opening GROUP BY 1),
      ret AS (
        SELECT to_char(date, 'YYYY-MM') AS m, SUM(subtotal) AS sub, SUM(tax_amount) AS tax FROM sales_returns
        WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1)
      SELECT COALESCE(inv.m, ret.m) AS m, COALESCE(inv.n, 0)::int AS n, COALESCE(inv.sub, 0)::text AS sub, COALESCE(inv.tax, 0)::text AS tax,
             COALESCE(inv.tot, 0)::text AS tot, COALESCE(inv.cogs, 0)::text AS cogs, COALESCE(ret.sub, 0)::text AS rsub, COALESCE(ret.tax, 0)::text AS rtax
      FROM inv FULL JOIN ret ON ret.m = inv.m ORDER BY 1`);
    const monthRows: Cell[][] = monthly.map((r) => [
      r.m,
      r.n,
      num(r.sub),
      num(r.tax),
      num(r.rsub),
      num(r.sub) - num(r.rsub),
      num(r.cogs),
      num(r.sub) - num(r.rsub) - num(r.cogs),
    ]);
    const byCustomer = await this.queries.rows<{ name: string; n: number; sub: string; rsub: string }>(sql`
      SELECT c.name, COUNT(i.id)::int AS n, COALESCE(SUM(i.subtotal), 0)::text AS sub,
        COALESCE((SELECT SUM(r.subtotal) FROM sales_returns r JOIN invoices ii ON ii.id = r.invoice_id WHERE ii.customer_id = c.id AND r.tenant_id = ${tenantId} AND r.date BETWEEN ${from} AND ${to}), 0)::text AS rsub
      FROM customers c JOIN invoices i ON i.customer_id = c.id AND i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening
      WHERE c.tenant_id = ${tenantId} GROUP BY c.id, c.name ORDER BY SUM(i.subtotal) DESC LIMIT ${CAP}`);
    const customerRowsAll: Cell[][] = byCustomer.map((r) => [
      r.name,
      r.n,
      num(r.sub),
      num(r.rsub),
      num(r.sub) - num(r.rsub),
    ]);
    const customerRows = withRest(customerRowsAll, 100, [1, 2, 3, 4]);
    const byProduct = await this.queries.rows<{ sku: string; name: string; qty: string; sales: string }>(sql`
      SELECT p.sku, p.name, SUM(il.qty * il.uom_factor)::text AS qty, SUM(il.line_total)::text AS sales
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening
      GROUP BY p.id, p.sku, p.name ORDER BY SUM(il.line_total) DESC LIMIT ${CAP}`);
    const productRowsAll: Cell[][] = byProduct.map((r) => [
      r.sku,
      r.name,
      num(r.qty),
      num(r.sales),
      num(r.qty) ? num(num(r.sales) / num(r.qty)) : 0,
    ]);
    const productRows = withRest(productRowsAll, 100, [2, 3]);
    const list = await this.queries.rows<{
      number: string;
      d: string;
      customer: string;
      sub: string;
      tax: string;
      tot: string;
      status: string;
    }>(sql`
      SELECT i.number, i.date::text AS d, c.name AS customer, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening ORDER BY i.date, i.number LIMIT ${CAP}`);
    const listRows: Cell[][] = list.map((r) => [
      r.number,
      r.d,
      r.customer,
      num(r.sub),
      num(r.tax),
      num(r.tot),
      r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar',
    ]);

    // Pencocokan 1: penjualan neto menurut faktur & retur vs akun pendapatan pada jurnal faktur/retur
    const [docs] = await this.queries.rows<{ sub: string; rsub: string }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND NOT is_opening AND journal_id IS NOT NULL)::text AS sub,
             (SELECT COALESCE(SUM(subtotal), 0) FROM sales_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS rsub`);
    const [gl] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to}
        AND (j.id IN (SELECT journal_id FROM invoices WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL AND NOT is_opening)
          OR j.id IN (SELECT journal_id FROM sales_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL))`);
    // Pencocokan 2: sisa tagihan faktur pada tanggal akhir vs saldo piutang usaha di buku besar
    const [ar] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(i.total
          - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0)), 0)::text AS v
      FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}`);
    const arGl = await this.queries.glBalance(tenantId, to, sql`a.system_key = 'AR'`);

    const arAging = await this.queries.rows<{
      name: string;
      b0: string;
      b1: string;
      b2: string;
      b3: string;
      b4: string;
    }>(sql`
      SELECT x.name, COALESCE(SUM(x.open) FILTER (WHERE x.late <= 0), 0)::text AS b0, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 1 AND 30), 0)::text AS b1,
        COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 31 AND 60), 0)::text AS b2, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 61 AND 90), 0)::text AS b3, COALESCE(SUM(x.open) FILTER (WHERE x.late > 90), 0)::text AS b4
      FROM (SELECT c.name, (${to}::date - i.due_date) AS late,
          i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
                  - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0) AS open
        FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x
      WHERE x.open > 0.5 GROUP BY x.name ORDER BY SUM(x.open) DESC LIMIT ${CAP}`);
    const agingRows: Cell[][] = arAging.map((r) => [
      r.name,
      num(r.b0),
      num(r.b1),
      num(r.b2),
      num(r.b3),
      num(r.b4),
      num(r.b0) + num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4),
    ]);
    const unbilled = await this.queries.rows<{
      number: string;
      d: string;
      customer: string;
      so: string;
      cogs: string;
      age: number;
    }>(sql`
      SELECT d.number, d.date::text AS d, c.name AS customer, o.number AS so, d.cogs_amount::text AS cogs, (${to}::date - d.date)::int AS age
      FROM delivery_orders d JOIN customers c ON c.id = d.customer_id JOIN sales_orders o ON o.id = d.sales_order_id LEFT JOIN invoices i ON i.id = d.invoice_id
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.date <= ${to} AND (d.invoice_id IS NULL OR i.date > ${to}) ORDER BY d.date LIMIT ${CAP}`);
    const unbilledRows: Cell[][] = unbilled.map((r) => [r.number, r.d, r.customer, r.so, r.age, num(r.cogs)]);

    const SOURCE: Record<string, string> = {
      INVOICE: 'Faktur penjualan',
      SERVICE_INVOICE: 'Faktur jasa',
      SALES_RETURN: 'Retur penjualan',
      POS: 'Kasir (POS)',
      POS_RETURN: 'Retur kasir',
      MANUAL: 'Jurnal manual',
      CUSTOMER_DEPOSIT: 'Uang muka pelanggan',
      DEPOSIT_APPLICATION: 'Pemakaian uang muka',
      PROJECT_PROGRESS: 'Kemajuan proyek',
      PLATFORM_SETTLEMENT: 'Pencairan platform',
      CASH_IN: 'Penerimaan kas lain',
      FX_REVAL: 'Penilaian ulang kurs',
    };
    const bySource = await this.queries.rows<{ src: string; n: number; v: string }>(sql`
      SELECT j.source_type AS src, COUNT(DISTINCT j.id)::int AS n, SUM(l.credit - l.debit)::text AS v
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'
      GROUP BY j.source_type HAVING ABS(SUM(l.credit - l.debit)) > 0 ORDER BY SUM(l.credit - l.debit) DESC`);
    const sourceRows: Cell[][] = bySource.map((r) => [SOURCE[r.src] ?? r.src, r.n, num(r.v)]);
    const [allRev] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'`);
    const [dlv] = await this.queries.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(cogs_amount), 0) FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND journal_id IS NOT NULL AND date BETWEEN ${from} AND ${to})::text AS doc,
             (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'COGS' AND j.source_type = 'DELIVERY' AND j.date BETWEEN ${from} AND ${to}
                AND j.id IN (SELECT journal_id FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND journal_id IS NOT NULL))::text AS gl`);

    const totRow = (rows: Cell[][], idx: number[]) => [
      'Jumlah',
      ...(rows[0]?.slice(1).map((_, k) => (idx.includes(k + 1) ? sum(rows, k + 1) : null)) ?? []),
    ];
    return {
      title: 'Laporan Pendukung Penjualan',
      summary:
        'Rincian penjualan dari faktur dan retur, dicocokkan dengan akun pendapatan dan piutang usaha di buku besar.',
      reconciliation: [
        this.queries.recon(
          'sales-revenue',
          'Penjualan neto vs akun pendapatan',
          { label: 'Faktur − retur (dokumen)', value: Number(docs.sub) - Number(docs.rsub) },
          { label: 'Akun pendapatan pada jurnal faktur & retur', value: Number(gl.v) },
          'Selisih berarti jurnal faktur/retur diubah di luar dokumen atau ada pendapatan non-faktur pada jurnal yang sama.',
        ),
        this.queries.recon(
          'sales-revenue-all',
          'Pendapatan menurut sumber vs seluruh akun pendapatan',
          {
            label: 'Jumlah tabel pendapatan menurut sumber jurnal',
            value: sourceRows.reduce((a, r) => a + Number(r[2]), 0),
          },
          { label: 'Seluruh akun pendapatan pada periode (tanpa jurnal penutup)', value: Number(allRev.v) },
          'Mencakup kasir, jasa, proyek, dan jurnal lain di luar faktur. Selisih berarti ada jurnal pendapatan yang tidak terbaca per sumber.',
        ),
        this.queries.recon(
          'sales-delivery-cogs',
          'HPP surat jalan vs akun HPP',
          { label: 'HPP pada surat jalan terkirim dalam periode (yang dijurnal sendiri)', value: Number(dlv.doc) },
          { label: 'Akun HPP pada jurnal pengiriman', value: Number(dlv.gl) },
          'Surat jalan menjurnal HPP saat barang keluar, sebelum faktur terbit.',
        ),
        this.queries.recon(
          'sales-ar',
          'Sisa tagihan faktur vs saldo piutang usaha',
          { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ar.v) },
          { label: 'Saldo akun Piutang Usaha di buku besar', value: arGl },
          'Selisih biasanya dari jurnal manual ke akun piutang, faktur valas, atau piutang tanpa faktur.',
        ),
      ],
      sections: [
        {
          key: 'sales-monthly',
          number: 'P1',
          title: 'Rekap penjualan per bulan',
          paragraphs: [
            'Penjualan (DPP) menurut faktur, dikurangi retur; HPP dari faktur barang. Tidak termasuk saldo awal.',
          ],
          tables: [
            {
              columns: [
                'Bulan',
                'Faktur',
                'Penjualan (DPP)',
                'PPN keluaran',
                'Retur (DPP)',
                'Penjualan neto',
                'HPP',
                'Laba kotor',
              ],
              align: [L, R, R, R, R, R, R, R],
              rows: monthRows,
              total: monthRows.length
                ? [
                    'Jumlah',
                    sum(monthRows, 1),
                    sum(monthRows, 2),
                    sum(monthRows, 3),
                    sum(monthRows, 4),
                    sum(monthRows, 5),
                    sum(monthRows, 6),
                    sum(monthRows, 7),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'sales-customer',
          number: 'P2',
          title: 'Penjualan per pelanggan (100 teratas, sisanya digabung)',
          paragraphs: [],
          tables: [
            {
              columns: ['Pelanggan', 'Faktur', 'Penjualan (DPP)', 'Retur (DPP)', 'Neto'],
              align: [L, R, R, R, R],
              rows: customerRows,
              total: customerRows.length ? totRow(customerRows, [1, 2, 3, 4]) : undefined,
            },
          ],
        },
        {
          key: 'sales-product',
          number: 'P3',
          title: 'Penjualan per produk (100 teratas, sisanya digabung)',
          paragraphs: ['Jumlah dalam satuan dasar.'],
          tables: [
            {
              columns: ['SKU', 'Produk', 'Jumlah', 'Penjualan', 'Harga rata-rata'],
              align: [L, L, R, R, R],
              rows: productRows,
              total: productRows.length ? ['Jumlah', null, sum(productRows, 2), sum(productRows, 3), null] : undefined,
            },
          ],
        },
        {
          key: 'sales-list',
          number: 'P4',
          title: 'Daftar faktur penjualan',
          paragraphs: [],
          tables: [
            {
              columns: ['Nomor', 'Tanggal', 'Pelanggan', 'DPP', 'PPN', 'Total', 'Status'],
              align: [L, L, L, R, R, R, L],
              rows: listRows,
              total: listRows.length
                ? ['Jumlah', null, null, sum(listRows, 3), sum(listRows, 4), sum(listRows, 5), null]
                : undefined,
            },
          ],
        },
        {
          key: 'sales-aging',
          number: 'P5',
          title: 'Umur piutang usaha per pelanggan',
          paragraphs: [
            'Sisa tagihan faktur rupiah per tanggal akhir menurut jatuh tempo. Totalnya sama dengan sisi dokumen pada pencocokan piutang usaha.',
          ],
          tables: [
            {
              columns: [
                'Pelanggan',
                'Belum jatuh tempo',
                '1–30 hari',
                '31–60 hari',
                '61–90 hari',
                '> 90 hari',
                'Total',
              ],
              align: [L, R, R, R, R, R, R],
              rows: agingRows,
              total: agingRows.length
                ? [
                    'Jumlah',
                    sum(agingRows, 1),
                    sum(agingRows, 2),
                    sum(agingRows, 3),
                    sum(agingRows, 4),
                    sum(agingRows, 5),
                    sum(agingRows, 6),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'sales-unbilled',
          number: 'P6',
          title: 'Surat jalan belum difaktur',
          paragraphs: [
            'Barang sudah keluar dan HPP sudah dijurnal, tetapi pendapatan baru muncul saat faktur terbit. Status belum difaktur dihitung sampai tanggal akhir.',
          ],
          tables: [
            {
              columns: ['Surat jalan', 'Tanggal', 'Pelanggan', 'Pesanan', 'Umur (hari)', 'Nilai HPP'],
              align: [L, L, L, L, R, R],
              rows: unbilledRows,
              total: unbilledRows.length ? ['Jumlah', null, null, null, null, sum(unbilledRows, 5)] : undefined,
            },
          ],
        },
        {
          key: 'sales-source',
          number: 'P7',
          title: 'Pendapatan menurut sumber (seluruh jurnal)',
          paragraphs: [
            'Faktur dirinci pada P1–P4. Bagian ini juga menampilkan pendapatan dari kasir, jasa, proyek, dan jurnal lain yang tidak berasal dari faktur penjualan, sehingga seluruh pendapatan di buku besar terlihat.',
          ],
          tables: [
            {
              columns: ['Sumber', 'Jurnal', 'Pendapatan'],
              align: [L, R, R],
              rows: sourceRows,
              total: sourceRows.length ? ['Jumlah', sum(sourceRows, 1), sum(sourceRows, 2)] : undefined,
            },
          ],
        },
      ],
    };
  }

  // ------------------------------------------------------------------ Pembelian
  private async purchases(tenantId: string, from: string, to: string) {
    const monthly = await this.queries.rows<{
      m: string;
      n: number;
      sub: string;
      tax: string;
      wh: string;
      tot: string;
      rsub: string;
    }>(sql`
      WITH inv AS (
        SELECT to_char(date, 'YYYY-MM') AS m, COUNT(*)::int AS n, SUM(subtotal) AS sub, SUM(tax_amount) AS tax, SUM(withholding_amount) AS wh, SUM(total) AS tot
        FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1),
      ret AS (
        SELECT to_char(date, 'YYYY-MM') AS m, SUM(subtotal) AS sub FROM purchase_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1)
      SELECT COALESCE(inv.m, ret.m) AS m, COALESCE(inv.n, 0)::int AS n, COALESCE(inv.sub, 0)::text AS sub, COALESCE(inv.tax, 0)::text AS tax,
             COALESCE(inv.wh, 0)::text AS wh, COALESCE(inv.tot, 0)::text AS tot, COALESCE(ret.sub, 0)::text AS rsub
      FROM inv FULL JOIN ret ON ret.m = inv.m ORDER BY 1`);
    const monthRows: Cell[][] = monthly.map((r) => [
      r.m,
      r.n,
      num(r.sub),
      num(r.tax),
      num(r.wh),
      num(r.tot),
      num(r.rsub),
      num(r.sub) - num(r.rsub),
    ]);
    const bySupplier = await this.queries.rows<{ name: string; n: number; sub: string; tax: string; tot: string }>(sql`
      SELECT s.name, COUNT(*)::int AS n, SUM(i.subtotal)::text AS sub, SUM(i.tax_amount)::text AS tax, SUM(i.total)::text AS tot
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} GROUP BY s.id, s.name ORDER BY SUM(i.subtotal) DESC LIMIT ${CAP}`);
    const supplierRowsAll: Cell[][] = bySupplier.map((r) => [r.name, r.n, num(r.sub), num(r.tax), num(r.tot)]);
    const supplierRows = withRest(supplierRowsAll, 100, [1, 2, 3, 4]);
    const list = await this.queries.rows<{
      number: string;
      no: string;
      d: string;
      supplier: string;
      kind: string;
      sub: string;
      tax: string;
      tot: string;
      status: string;
    }>(sql`
      SELECT i.number, i.supplier_invoice_no AS no, i.date::text AS d, s.name AS supplier, i.kind, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} ORDER BY i.date, i.number LIMIT ${CAP}`);
    const listRows: Cell[][] = list.map((r) => [
      r.number,
      r.no,
      r.d,
      r.supplier,
      r.kind === 'GOODS' ? 'Barang' : 'Biaya/aset',
      num(r.sub),
      num(r.tax),
      num(r.tot),
      r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar',
    ]);

    const [docs] = await this.queries.rows<{ tot: string }>(
      sql`SELECT COALESCE(SUM(total), 0)::text AS tot FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL`,
    );
    const [gl] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.system_key = 'AP' AND j.date BETWEEN ${from} AND ${to}
        AND j.id IN (SELECT journal_id FROM purchase_invoices WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)`);
    const [ap] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(i.total
          - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.purchase_invoice_id = i.id AND p.status = 'POSTED' AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.purchase_invoice_id = i.id AND r.date <= ${to}), 0)), 0)::text AS v
      FROM purchase_invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}`);
    const apGl = -(await this.queries.glBalance(tenantId, to, sql`a.system_key = 'AP'`));

    const apAging = await this.queries.rows<{
      name: string;
      b0: string;
      b1: string;
      b2: string;
      b3: string;
      b4: string;
    }>(sql`
      SELECT x.name, COALESCE(SUM(x.open) FILTER (WHERE x.late <= 0), 0)::text AS b0, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 1 AND 30), 0)::text AS b1,
        COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 31 AND 60), 0)::text AS b2, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 61 AND 90), 0)::text AS b3, COALESCE(SUM(x.open) FILTER (WHERE x.late > 90), 0)::text AS b4
      FROM (SELECT s.name, (${to}::date - i.due_date) AS late,
          i.total - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.purchase_invoice_id = i.id AND p.status = 'POSTED' AND p.date <= ${to}), 0)
                  - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.purchase_invoice_id = i.id AND r.date <= ${to}), 0) AS open
        FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x
      WHERE x.open > 0.5 GROUP BY x.name ORDER BY SUM(x.open) DESC LIMIT ${CAP}`);
    const agingRows: Cell[][] = apAging.map((r) => [
      r.name,
      num(r.b0),
      num(r.b1),
      num(r.b2),
      num(r.b3),
      num(r.b4),
      num(r.b0) + num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4),
    ]);
    // Per tanggal akhir: penerimaan sampai tanggal itu (tanpa yang sudah dibatalkan saat itu) dikurangi penagihan sampai tanggal itu
    const notCancelled = sql`NOT EXISTS (SELECT 1 FROM journal_entries cj WHERE cj.tenant_id = g.tenant_id AND cj.source_type = 'GOODS_RECEIPT' AND cj.source_id = g.id::text AND cj.id IS DISTINCT FROM g.journal_id AND cj.date <= ${to})`;
    const billedTo = sql`COALESCE((SELECT SUM(b.value) FROM goods_receipt_billings b WHERE b.receipt_id = g.id AND b.date <= ${to}), 0)`;
    const grni = await this.queries.rows<{
      number: string;
      d: string;
      supplier: string;
      po: string;
      value: string;
      billed: string;
      age: number;
    }>(sql`
      SELECT g.number, g.date::text AS d, s.name AS supplier, o.number AS po, g.value::text AS value, ${billedTo}::text AS billed, (${to}::date - g.date)::int AS age
      FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id JOIN purchase_orders o ON o.id = g.purchase_order_id
      WHERE g.tenant_id = ${tenantId} AND g.auto_invoice_id IS NULL AND g.date <= ${to} AND ${notCancelled} AND g.value - ${billedTo} > 0.5
      ORDER BY g.date LIMIT ${CAP}`);
    const grniRows: Cell[][] = grni.map((r) => [
      r.number,
      r.d,
      r.supplier,
      r.po,
      r.age,
      num(r.value),
      num(r.billed),
      num(r.value) - num(r.billed),
    ]);
    const [grniDoc] = await this.queries.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(g.value - ${billedTo}), 0)::text AS v
      FROM goods_receipts g WHERE g.tenant_id = ${tenantId} AND g.auto_invoice_id IS NULL AND g.date <= ${to} AND ${notCancelled}`);
    const [grniEst] = await this.queries.rows<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM goods_receipt_billings WHERE tenant_id = ${tenantId} AND estimated AND date <= ${to}`,
    );
    const grniGl = -(await this.queries.glBalance(tenantId, to, sql`a.system_key = 'GRNI'`));
    return {
      title: 'Laporan Pendukung Pembelian',
      summary: 'Rincian pembelian dari faktur pemasok dan retur, dicocokkan dengan akun utang usaha di buku besar.',
      reconciliation: [
        this.queries.recon(
          'purchases-ap-credit',
          'Faktur pembelian vs kredit utang usaha',
          { label: 'Total faktur pemasok (dokumen)', value: Number(docs.tot) },
          { label: 'Kredit akun Utang Usaha pada jurnal faktur', value: Number(gl.v) },
          'Selisih berarti jurnal faktur diubah di luar dokumen.',
        ),
        this.queries.recon(
          'purchases-ap-balance',
          'Sisa tagihan pemasok vs saldo utang usaha',
          { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ap.v) },
          { label: 'Saldo akun Utang Usaha di buku besar', value: apGl },
          'Selisih biasanya dari jurnal manual ke akun utang, faktur valas, atau utang tanpa faktur.',
        ),
        this.queries.recon(
          'purchases-grni',
          'Barang diterima belum ditagih vs akun GRNI',
          { label: 'Penerimaan barang dikurangi penagihan (per tanggal akhir)', value: Number(grniDoc.v) },
          { label: 'Saldo akun Barang Diterima Belum Ditagih per tanggal akhir', value: grniGl },
          `Dihitung dari riwayat penagihan per tanggal faktur. Selisih berarti jurnal manual ke akun GRNI atau penerimaan yang diubah di luar dokumen.${grniEst.n ? ` ${grniEst.n} baris penagihan dari data lama tanggalnya diperkirakan (faktur terakhir pada pesanan itu).` : ''}`,
        ),
      ],
      sections: [
        {
          key: 'purchases-monthly',
          number: 'P1',
          title: 'Rekap pembelian per bulan',
          paragraphs: ['Menurut faktur pemasok pada periode, dikurangi retur pembelian.'],
          tables: [
            {
              columns: [
                'Bulan',
                'Faktur',
                'Pembelian (DPP)',
                'PPN masukan',
                'PPh dipotong',
                'Total dibayar',
                'Retur (DPP)',
                'Pembelian neto',
              ],
              align: [L, R, R, R, R, R, R, R],
              rows: monthRows,
              total: monthRows.length
                ? [
                    'Jumlah',
                    sum(monthRows, 1),
                    sum(monthRows, 2),
                    sum(monthRows, 3),
                    sum(monthRows, 4),
                    sum(monthRows, 5),
                    sum(monthRows, 6),
                    sum(monthRows, 7),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'purchases-supplier',
          number: 'P2',
          title: 'Pembelian per pemasok (100 teratas, sisanya digabung)',
          paragraphs: [],
          tables: [
            {
              columns: ['Pemasok', 'Faktur', 'DPP', 'PPN', 'Total'],
              align: [L, R, R, R, R],
              rows: supplierRows,
              total: supplierRows.length
                ? ['Jumlah', sum(supplierRows, 1), sum(supplierRows, 2), sum(supplierRows, 3), sum(supplierRows, 4)]
                : undefined,
            },
          ],
        },
        {
          key: 'purchases-list',
          number: 'P3',
          title: 'Daftar faktur pembelian',
          paragraphs: [],
          tables: [
            {
              columns: ['Nomor', 'No. faktur pemasok', 'Tanggal', 'Pemasok', 'Jenis', 'DPP', 'PPN', 'Total', 'Status'],
              align: [L, L, L, L, L, R, R, R, L],
              rows: listRows,
              total: listRows.length
                ? ['Jumlah', null, null, null, null, sum(listRows, 5), sum(listRows, 6), sum(listRows, 7), null]
                : undefined,
            },
          ],
        },
        {
          key: 'purchases-aging',
          number: 'P4',
          title: 'Umur utang usaha per pemasok',
          paragraphs: ['Sisa tagihan faktur pemasok rupiah per tanggal akhir menurut jatuh tempo.'],
          tables: [
            {
              columns: ['Pemasok', 'Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', '> 90 hari', 'Total'],
              align: [L, R, R, R, R, R, R],
              rows: agingRows,
              total: agingRows.length
                ? [
                    'Jumlah',
                    sum(agingRows, 1),
                    sum(agingRows, 2),
                    sum(agingRows, 3),
                    sum(agingRows, 4),
                    sum(agingRows, 5),
                    sum(agingRows, 6),
                  ]
                : undefined,
            },
          ],
        },
        {
          key: 'purchases-grni',
          number: 'P5',
          title: 'Barang diterima belum ditagih',
          paragraphs: [
            'Penerimaan barang yang belum (seluruhnya) difaktur pemasok per tanggal akhir. Umur panjang menandakan faktur pemasok belum diterima atau belum diinput.',
          ],
          tables: [
            {
              columns: [
                'Penerimaan',
                'Tanggal',
                'Pemasok',
                'PO',
                'Umur (hari)',
                'Nilai',
                'Sudah ditagih',
                'Belum ditagih',
              ],
              align: [L, L, L, L, R, R, R, R],
              rows: grniRows,
              total: grniRows.length
                ? ['Jumlah', null, null, null, null, sum(grniRows, 5), sum(grniRows, 6), sum(grniRows, 7)]
                : undefined,
            },
          ],
        },
      ],
    };
  }

  // ------------------------------------------------------------------ Persediaan
  private async inventory(tenantId: string, from: string, to: string) {
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
  private async cash(tenantId: string, from: string, to: string) {
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
  private async other(tenantId: string, from: string, to: string) {
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
