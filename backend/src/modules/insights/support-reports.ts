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
import { conclude } from './support-insights';

type Cell = string | number | null;
export interface SupportTable {
  title?: string;
  columns: string[];
  align: ('left' | 'right')[];
  rows: Cell[][];
  total?: Cell[];
}
export interface SupportSection {
  key: string;
  number: string;
  title: string;
  paragraphs: string[];
  tables: SupportTable[];
}
export interface Reconciliation {
  key: string;
  title: string;
  left: { label: string; value: number };
  right: { label: string; value: number };
  diff: number;
  ok: boolean;
  note?: string;
}
export const SUPPORT_KINDS = ['sales', 'purchases', 'inventory', 'cash', 'other', 'pos', 'fnb', 'fmcg', 'mfg', 'jasa', 'utility'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

const L = 'left' as const;
const R = 'right' as const;
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const sum = (rows: Cell[][], i: number) => rows.reduce((a, r) => a + Number(r[i] ?? 0), 0);
const TOLERANCE = 1;
/** Batas baris per tabel; tabel yang mencapai batas diberi catatan agar tidak terbaca lengkap */
const CAP = 2000;
/** Baris di luar N teratas digabung menjadi satu baris "Lainnya" sehingga jumlah tabel tetap lengkap */
export const withRest = (rows: Cell[][], n: number, sumIdx: number[]): Cell[][] => {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n);
  const row: Cell[] = Array(rows[0].length).fill(null);
  row[0] = `Lainnya (${rest.length})`;
  for (const i of sumIdx) row[i] = Math.round(sum(rest, i) * 100) / 100;
  return [...rows.slice(0, n), row];
};

@Injectable()
export class SupportReportsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private async rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>) {
    return (await this.db.execute<T>(q)).rows;
  }

  private recon(key: string, title: string, left: Reconciliation['left'], right: Reconciliation['right'], note?: string): Reconciliation {
    const diff = num(left.value - right.value);
    return { key, title, left: { ...left, value: num(left.value) }, right: { ...right, value: num(right.value) }, diff, ok: Math.abs(diff) < TOLERANCE, note };
  }

  /** Saldo akun (debit − kredit) per tanggal untuk akun bersistem tertentu atau seluruh akun kas */
  private async glBalance(tenantId: string, asOf: string, where: ReturnType<typeof sql>) {
    const [r] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${asOf} AND ${where}`);
    return Number(r.v);
  }

  async build(tenantId: string, kind: SupportKind, fromIn?: string, toIn?: string) {
    if (!SUPPORT_KINDS.includes(kind)) throw new BadRequestException('Jenis laporan pendukung tidak dikenal');
    const to = toDocDate(toIn);
    const from = fromIn ? toDocDate(fromIn) : `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh setelah tanggal akhir');
    const out = await (this[kind] as (t: string, f: string, e: string) => Promise<{ title: string; summary: string; sections: SupportSection[]; reconciliation: Reconciliation[] }>).call(this, tenantId, from, to);
    for (const sec of out.sections) if (sec.tables.some((t) => t.rows.length >= CAP)) sec.paragraphs = [...sec.paragraphs, `Tabel dipotong pada ${CAP} baris pertama; persempit periode untuk melihat sisanya.`];
    const period = { from, to };
    return { kind, ...out, period, conclusion: conclude(kind, { ...out, period }), generatedAt: new Date().toISOString(), today: todayJakarta() };
  }

  // ------------------------------------------------------------------ Penjualan
  private async sales(tenantId: string, from: string, to: string) {
    const monthly = await this.rows<{ m: string; n: number; sub: string; tax: string; tot: string; cogs: string; rsub: string; rtax: string }>(sql`
      WITH inv AS (
        SELECT to_char(date, 'YYYY-MM') AS m, COUNT(*)::int AS n, SUM(subtotal) AS sub, SUM(tax_amount) AS tax, SUM(total) AS tot, SUM(cogs_amount) AS cogs
        FROM invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND NOT is_opening GROUP BY 1),
      ret AS (
        SELECT to_char(date, 'YYYY-MM') AS m, SUM(subtotal) AS sub, SUM(tax_amount) AS tax FROM sales_returns
        WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1)
      SELECT COALESCE(inv.m, ret.m) AS m, COALESCE(inv.n, 0)::int AS n, COALESCE(inv.sub, 0)::text AS sub, COALESCE(inv.tax, 0)::text AS tax,
             COALESCE(inv.tot, 0)::text AS tot, COALESCE(inv.cogs, 0)::text AS cogs, COALESCE(ret.sub, 0)::text AS rsub, COALESCE(ret.tax, 0)::text AS rtax
      FROM inv FULL JOIN ret ON ret.m = inv.m ORDER BY 1`);
    const monthRows: Cell[][] = monthly.map((r) => [r.m, r.n, num(r.sub), num(r.tax), num(r.rsub), num(r.sub) - num(r.rsub), num(r.cogs), num(r.sub) - num(r.rsub) - num(r.cogs)]);
    const byCustomer = await this.rows<{ name: string; n: number; sub: string; rsub: string }>(sql`
      SELECT c.name, COUNT(i.id)::int AS n, COALESCE(SUM(i.subtotal), 0)::text AS sub,
        COALESCE((SELECT SUM(r.subtotal) FROM sales_returns r JOIN invoices ii ON ii.id = r.invoice_id WHERE ii.customer_id = c.id AND r.tenant_id = ${tenantId} AND r.date BETWEEN ${from} AND ${to}), 0)::text AS rsub
      FROM customers c JOIN invoices i ON i.customer_id = c.id AND i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening
      WHERE c.tenant_id = ${tenantId} GROUP BY c.id, c.name ORDER BY SUM(i.subtotal) DESC LIMIT ${CAP}`);
    const customerRowsAll: Cell[][] = byCustomer.map((r) => [r.name, r.n, num(r.sub), num(r.rsub), num(r.sub) - num(r.rsub)]);
    const customerRows = withRest(customerRowsAll, 100, [1, 2, 3, 4]);
    const byProduct = await this.rows<{ sku: string; name: string; qty: string; sales: string }>(sql`
      SELECT p.sku, p.name, SUM(il.qty * il.uom_factor)::text AS qty, SUM(il.line_total)::text AS sales
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening
      GROUP BY p.id, p.sku, p.name ORDER BY SUM(il.line_total) DESC LIMIT ${CAP}`);
    const productRowsAll: Cell[][] = byProduct.map((r) => [r.sku, r.name, num(r.qty), num(r.sales), num(r.qty) ? num(num(r.sales) / num(r.qty)) : 0]);
    const productRows = withRest(productRowsAll, 100, [2, 3]);
    const list = await this.rows<{ number: string; d: string; customer: string; sub: string; tax: string; tot: string; status: string }>(sql`
      SELECT i.number, i.date::text AS d, c.name AS customer, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening ORDER BY i.date, i.number LIMIT ${CAP}`);
    const listRows: Cell[][] = list.map((r) => [r.number, r.d, r.customer, num(r.sub), num(r.tax), num(r.tot), r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar']);

    // Pencocokan 1: penjualan neto menurut faktur & retur vs akun pendapatan pada jurnal faktur/retur
    const [docs] = await this.rows<{ sub: string; rsub: string }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND NOT is_opening AND journal_id IS NOT NULL)::text AS sub,
             (SELECT COALESCE(SUM(subtotal), 0) FROM sales_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS rsub`);
    const [gl] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to}
        AND (j.id IN (SELECT journal_id FROM invoices WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL AND NOT is_opening)
          OR j.id IN (SELECT journal_id FROM sales_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL))`);
    // Pencocokan 2: sisa tagihan faktur pada tanggal akhir vs saldo piutang usaha di buku besar
    const [ar] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(i.total
          - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0)), 0)::text AS v
      FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}`);
    const arGl = await this.glBalance(tenantId, to, sql`a.system_key = 'AR'`);


    const arAging = await this.rows<{ name: string; b0: string; b1: string; b2: string; b3: string; b4: string }>(sql`
      SELECT x.name, COALESCE(SUM(x.open) FILTER (WHERE x.late <= 0), 0)::text AS b0, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 1 AND 30), 0)::text AS b1,
        COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 31 AND 60), 0)::text AS b2, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 61 AND 90), 0)::text AS b3, COALESCE(SUM(x.open) FILTER (WHERE x.late > 90), 0)::text AS b4
      FROM (SELECT c.name, (${to}::date - i.due_date) AS late,
          i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
                  - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0) AS open
        FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x
      WHERE x.open > 0.5 GROUP BY x.name ORDER BY SUM(x.open) DESC LIMIT ${CAP}`);
    const agingRows: Cell[][] = arAging.map((r) => [r.name, num(r.b0), num(r.b1), num(r.b2), num(r.b3), num(r.b4), num(r.b0) + num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4)]);
    const unbilled = await this.rows<{ number: string; d: string; customer: string; so: string; cogs: string; age: number }>(sql`
      SELECT d.number, d.date::text AS d, c.name AS customer, o.number AS so, d.cogs_amount::text AS cogs, (${to}::date - d.date)::int AS age
      FROM delivery_orders d JOIN customers c ON c.id = d.customer_id JOIN sales_orders o ON o.id = d.sales_order_id LEFT JOIN invoices i ON i.id = d.invoice_id
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.date <= ${to} AND (d.invoice_id IS NULL OR i.date > ${to}) ORDER BY d.date LIMIT ${CAP}`);
    const unbilledRows: Cell[][] = unbilled.map((r) => [r.number, r.d, r.customer, r.so, r.age, num(r.cogs)]);

    const SOURCE: Record<string, string> = { INVOICE: 'Faktur penjualan', SERVICE_INVOICE: 'Faktur jasa', SALES_RETURN: 'Retur penjualan', POS: 'Kasir (POS)', POS_RETURN: 'Retur kasir', MANUAL: 'Jurnal manual', CUSTOMER_DEPOSIT: 'Uang muka pelanggan', DEPOSIT_APPLICATION: 'Pemakaian uang muka', PROJECT_PROGRESS: 'Kemajuan proyek', PLATFORM_SETTLEMENT: 'Pencairan platform', CASH_IN: 'Penerimaan kas lain', FX_REVAL: 'Penilaian ulang kurs' };
    const bySource = await this.rows<{ src: string; n: number; v: string }>(sql`
      SELECT j.source_type AS src, COUNT(DISTINCT j.id)::int AS n, SUM(l.credit - l.debit)::text AS v
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'
      GROUP BY j.source_type HAVING ABS(SUM(l.credit - l.debit)) > 0 ORDER BY SUM(l.credit - l.debit) DESC`);
    const sourceRows: Cell[][] = bySource.map((r) => [SOURCE[r.src] ?? r.src, r.n, num(r.v)]);
    const [allRev] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to} AND j.source_type <> 'CLOSING'`);
    const [dlv] = await this.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(cogs_amount), 0) FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND journal_id IS NOT NULL AND date BETWEEN ${from} AND ${to})::text AS doc,
             (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'COGS' AND j.source_type = 'DELIVERY' AND j.date BETWEEN ${from} AND ${to}
                AND j.id IN (SELECT journal_id FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND journal_id IS NOT NULL))::text AS gl`);

    const totRow = (rows: Cell[][], idx: number[]) => ['Jumlah', ...rows[0]?.slice(1).map((_, k) => (idx.includes(k + 1) ? sum(rows, k + 1) : null)) ?? []];
    return {
      title: 'Laporan Pendukung Penjualan',
      summary: 'Rincian penjualan dari faktur dan retur, dicocokkan dengan akun pendapatan dan piutang usaha di buku besar.',
      reconciliation: [
        this.recon('sales-revenue', 'Penjualan neto vs akun pendapatan', { label: 'Faktur − retur (dokumen)', value: Number(docs.sub) - Number(docs.rsub) }, { label: 'Akun pendapatan pada jurnal faktur & retur', value: Number(gl.v) }, 'Selisih berarti jurnal faktur/retur diubah di luar dokumen atau ada pendapatan non-faktur pada jurnal yang sama.'),
        this.recon('sales-revenue-all', 'Pendapatan menurut sumber vs seluruh akun pendapatan', { label: 'Jumlah tabel pendapatan menurut sumber jurnal', value: sourceRows.reduce((a, r) => a + Number(r[2]), 0) }, { label: 'Seluruh akun pendapatan pada periode (tanpa jurnal penutup)', value: Number(allRev.v) }, 'Mencakup kasir, jasa, proyek, dan jurnal lain di luar faktur. Selisih berarti ada jurnal pendapatan yang tidak terbaca per sumber.'),
        this.recon('sales-delivery-cogs', 'HPP surat jalan vs akun HPP', { label: 'HPP pada surat jalan terkirim dalam periode (yang dijurnal sendiri)', value: Number(dlv.doc) }, { label: 'Akun HPP pada jurnal pengiriman', value: Number(dlv.gl) }, 'Surat jalan menjurnal HPP saat barang keluar, sebelum faktur terbit.'),
        this.recon('sales-ar', 'Sisa tagihan faktur vs saldo piutang usaha', { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ar.v) }, { label: 'Saldo akun Piutang Usaha di buku besar', value: arGl }, 'Selisih biasanya dari jurnal manual ke akun piutang, faktur valas, atau piutang tanpa faktur.'),
      ],
      sections: [
        { key: 'sales-monthly', number: 'P1', title: 'Rekap penjualan per bulan', paragraphs: ['Penjualan (DPP) menurut faktur, dikurangi retur; HPP dari faktur barang. Tidak termasuk saldo awal.'], tables: [{ columns: ['Bulan', 'Faktur', 'Penjualan (DPP)', 'PPN keluaran', 'Retur (DPP)', 'Penjualan neto', 'HPP', 'Laba kotor'], align: [L, R, R, R, R, R, R, R], rows: monthRows, total: monthRows.length ? ['Jumlah', sum(monthRows, 1), sum(monthRows, 2), sum(monthRows, 3), sum(monthRows, 4), sum(monthRows, 5), sum(monthRows, 6), sum(monthRows, 7)] : undefined }] },
        { key: 'sales-customer', number: 'P2', title: 'Penjualan per pelanggan (100 teratas, sisanya digabung)', paragraphs: [], tables: [{ columns: ['Pelanggan', 'Faktur', 'Penjualan (DPP)', 'Retur (DPP)', 'Neto'], align: [L, R, R, R, R], rows: customerRows, total: customerRows.length ? totRow(customerRows, [1, 2, 3, 4]) : undefined }] },
        { key: 'sales-product', number: 'P3', title: 'Penjualan per produk (100 teratas, sisanya digabung)', paragraphs: ['Jumlah dalam satuan dasar.'], tables: [{ columns: ['SKU', 'Produk', 'Jumlah', 'Penjualan', 'Harga rata-rata'], align: [L, L, R, R, R], rows: productRows, total: productRows.length ? ['Jumlah', null, sum(productRows, 2), sum(productRows, 3), null] : undefined }] },
        { key: 'sales-list', number: 'P4', title: 'Daftar faktur penjualan', paragraphs: [], tables: [{ columns: ['Nomor', 'Tanggal', 'Pelanggan', 'DPP', 'PPN', 'Total', 'Status'], align: [L, L, L, R, R, R, L], rows: listRows, total: listRows.length ? ['Jumlah', null, null, sum(listRows, 3), sum(listRows, 4), sum(listRows, 5), null] : undefined }] },
        { key: 'sales-aging', number: 'P5', title: 'Umur piutang usaha per pelanggan', paragraphs: ['Sisa tagihan faktur rupiah per tanggal akhir menurut jatuh tempo. Totalnya sama dengan sisi dokumen pada pencocokan piutang usaha.'], tables: [{ columns: ['Pelanggan', 'Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', '> 90 hari', 'Total'], align: [L, R, R, R, R, R, R], rows: agingRows, total: agingRows.length ? ['Jumlah', sum(agingRows, 1), sum(agingRows, 2), sum(agingRows, 3), sum(agingRows, 4), sum(agingRows, 5), sum(agingRows, 6)] : undefined }] },
        { key: 'sales-unbilled', number: 'P6', title: 'Surat jalan belum difaktur', paragraphs: ['Barang sudah keluar dan HPP sudah dijurnal, tetapi pendapatan baru muncul saat faktur terbit. Status belum difaktur dihitung sampai tanggal akhir.'], tables: [{ columns: ['Surat jalan', 'Tanggal', 'Pelanggan', 'Pesanan', 'Umur (hari)', 'Nilai HPP'], align: [L, L, L, L, R, R], rows: unbilledRows, total: unbilledRows.length ? ['Jumlah', null, null, null, null, sum(unbilledRows, 5)] : undefined }] },
        { key: 'sales-source', number: 'P7', title: 'Pendapatan menurut sumber (seluruh jurnal)', paragraphs: ['Faktur dirinci pada P1–P4. Bagian ini juga menampilkan pendapatan dari kasir, jasa, proyek, dan jurnal lain yang tidak berasal dari faktur penjualan, sehingga seluruh pendapatan di buku besar terlihat.'], tables: [{ columns: ['Sumber', 'Jurnal', 'Pendapatan'], align: [L, R, R], rows: sourceRows, total: sourceRows.length ? ['Jumlah', sum(sourceRows, 1), sum(sourceRows, 2)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Pembelian
  private async purchases(tenantId: string, from: string, to: string) {
    const monthly = await this.rows<{ m: string; n: number; sub: string; tax: string; wh: string; tot: string; rsub: string }>(sql`
      WITH inv AS (
        SELECT to_char(date, 'YYYY-MM') AS m, COUNT(*)::int AS n, SUM(subtotal) AS sub, SUM(tax_amount) AS tax, SUM(withholding_amount) AS wh, SUM(total) AS tot
        FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1),
      ret AS (
        SELECT to_char(date, 'YYYY-MM') AS m, SUM(subtotal) AS sub FROM purchase_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} GROUP BY 1)
      SELECT COALESCE(inv.m, ret.m) AS m, COALESCE(inv.n, 0)::int AS n, COALESCE(inv.sub, 0)::text AS sub, COALESCE(inv.tax, 0)::text AS tax,
             COALESCE(inv.wh, 0)::text AS wh, COALESCE(inv.tot, 0)::text AS tot, COALESCE(ret.sub, 0)::text AS rsub
      FROM inv FULL JOIN ret ON ret.m = inv.m ORDER BY 1`);
    const monthRows: Cell[][] = monthly.map((r) => [r.m, r.n, num(r.sub), num(r.tax), num(r.wh), num(r.tot), num(r.rsub), num(r.sub) - num(r.rsub)]);
    const bySupplier = await this.rows<{ name: string; n: number; sub: string; tax: string; tot: string }>(sql`
      SELECT s.name, COUNT(*)::int AS n, SUM(i.subtotal)::text AS sub, SUM(i.tax_amount)::text AS tax, SUM(i.total)::text AS tot
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} GROUP BY s.id, s.name ORDER BY SUM(i.subtotal) DESC LIMIT ${CAP}`);
    const supplierRowsAll: Cell[][] = bySupplier.map((r) => [r.name, r.n, num(r.sub), num(r.tax), num(r.tot)]);
    const supplierRows = withRest(supplierRowsAll, 100, [1, 2, 3, 4]);
    const list = await this.rows<{ number: string; no: string; d: string; supplier: string; kind: string; sub: string; tax: string; tot: string; status: string }>(sql`
      SELECT i.number, i.supplier_invoice_no AS no, i.date::text AS d, s.name AS supplier, i.kind, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} ORDER BY i.date, i.number LIMIT ${CAP}`);
    const listRows: Cell[][] = list.map((r) => [r.number, r.no, r.d, r.supplier, r.kind === 'GOODS' ? 'Barang' : 'Biaya/aset', num(r.sub), num(r.tax), num(r.tot), r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar']);

    const [docs] = await this.rows<{ tot: string }>(sql`SELECT COALESCE(SUM(total), 0)::text AS tot FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL`);
    const [gl] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.system_key = 'AP' AND j.date BETWEEN ${from} AND ${to}
        AND j.id IN (SELECT journal_id FROM purchase_invoices WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)`);
    const [ap] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(i.total
          - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.purchase_invoice_id = i.id AND p.status = 'POSTED' AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.purchase_invoice_id = i.id AND r.date <= ${to}), 0)), 0)::text AS v
      FROM purchase_invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}`);
    const apGl = -(await this.glBalance(tenantId, to, sql`a.system_key = 'AP'`));

    const apAging = await this.rows<{ name: string; b0: string; b1: string; b2: string; b3: string; b4: string }>(sql`
      SELECT x.name, COALESCE(SUM(x.open) FILTER (WHERE x.late <= 0), 0)::text AS b0, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 1 AND 30), 0)::text AS b1,
        COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 31 AND 60), 0)::text AS b2, COALESCE(SUM(x.open) FILTER (WHERE x.late BETWEEN 61 AND 90), 0)::text AS b3, COALESCE(SUM(x.open) FILTER (WHERE x.late > 90), 0)::text AS b4
      FROM (SELECT s.name, (${to}::date - i.due_date) AS late,
          i.total - COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.purchase_invoice_id = i.id AND p.status = 'POSTED' AND p.date <= ${to}), 0)
                  - COALESCE((SELECT SUM(r.total) FROM purchase_returns r WHERE r.purchase_invoice_id = i.id AND r.date <= ${to}), 0) AS open
        FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x
      WHERE x.open > 0.5 GROUP BY x.name ORDER BY SUM(x.open) DESC LIMIT ${CAP}`);
    const agingRows: Cell[][] = apAging.map((r) => [r.name, num(r.b0), num(r.b1), num(r.b2), num(r.b3), num(r.b4), num(r.b0) + num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4)]);
    const today = todayJakarta();
    const grni = await this.rows<{ number: string; d: string; supplier: string; po: string; value: string; billed: string; age: number }>(sql`
      SELECT g.number, g.date::text AS d, s.name AS supplier, o.number AS po, g.value::text AS value, COALESCE((SELECT SUM(l.billed_value) FROM goods_receipt_lines l WHERE l.receipt_id = g.id), 0)::text AS billed, (${today}::date - g.date)::int AS age
      FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id JOIN purchase_orders o ON o.id = g.purchase_order_id
      WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.date <= ${today}
        AND g.value - COALESCE((SELECT SUM(l.billed_value) FROM goods_receipt_lines l WHERE l.receipt_id = g.id), 0) > 0.5 ORDER BY g.date LIMIT ${CAP}`);
    const grniRows: Cell[][] = grni.map((r) => [r.number, r.d, r.supplier, r.po, r.age, num(r.value), num(r.billed), num(r.value) - num(r.billed)]);
    const [grniDoc] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(g.value - COALESCE((SELECT SUM(l.billed_value) FROM goods_receipt_lines l WHERE l.receipt_id = g.id), 0)), 0)::text AS v
      FROM goods_receipts g WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.date <= ${today}`);
    const grniGl = -(await this.glBalance(tenantId, today, sql`a.system_key = 'GRNI'`));
    return {
      title: 'Laporan Pendukung Pembelian',
      summary: 'Rincian pembelian dari faktur pemasok dan retur, dicocokkan dengan akun utang usaha di buku besar.',
      reconciliation: [
        this.recon('purchases-ap-credit', 'Faktur pembelian vs kredit utang usaha', { label: 'Total faktur pemasok (dokumen)', value: Number(docs.tot) }, { label: 'Kredit akun Utang Usaha pada jurnal faktur', value: Number(gl.v) }, 'Selisih berarti jurnal faktur diubah di luar dokumen.'),
        this.recon('purchases-ap-balance', 'Sisa tagihan pemasok vs saldo utang usaha', { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ap.v) }, { label: 'Saldo akun Utang Usaha di buku besar', value: apGl }, 'Selisih biasanya dari jurnal manual ke akun utang, faktur valas, atau utang tanpa faktur.'),
        this.recon('purchases-grni', 'Barang diterima belum ditagih vs akun GRNI', { label: 'Penerimaan barang dikurangi yang sudah ditagih (per hari ini)', value: Number(grniDoc.v) }, { label: 'Saldo akun Barang Diterima Belum Ditagih per hari ini', value: grniGl }, 'Dibandingkan per hari ini karena status penagihan penerimaan tidak menyimpan riwayat. Selisih berarti jurnal manual ke akun GRNI atau penerimaan yang diubah di luar dokumen.'),
      ],
      sections: [
        { key: 'purchases-monthly', number: 'P1', title: 'Rekap pembelian per bulan', paragraphs: ['Menurut faktur pemasok pada periode, dikurangi retur pembelian.'], tables: [{ columns: ['Bulan', 'Faktur', 'Pembelian (DPP)', 'PPN masukan', 'PPh dipotong', 'Total dibayar', 'Retur (DPP)', 'Pembelian neto'], align: [L, R, R, R, R, R, R, R], rows: monthRows, total: monthRows.length ? ['Jumlah', sum(monthRows, 1), sum(monthRows, 2), sum(monthRows, 3), sum(monthRows, 4), sum(monthRows, 5), sum(monthRows, 6), sum(monthRows, 7)] : undefined }] },
        { key: 'purchases-supplier', number: 'P2', title: 'Pembelian per pemasok (100 teratas, sisanya digabung)', paragraphs: [], tables: [{ columns: ['Pemasok', 'Faktur', 'DPP', 'PPN', 'Total'], align: [L, R, R, R, R], rows: supplierRows, total: supplierRows.length ? ['Jumlah', sum(supplierRows, 1), sum(supplierRows, 2), sum(supplierRows, 3), sum(supplierRows, 4)] : undefined }] },
        { key: 'purchases-list', number: 'P3', title: 'Daftar faktur pembelian', paragraphs: [], tables: [{ columns: ['Nomor', 'No. faktur pemasok', 'Tanggal', 'Pemasok', 'Jenis', 'DPP', 'PPN', 'Total', 'Status'], align: [L, L, L, L, L, R, R, R, L], rows: listRows, total: listRows.length ? ['Jumlah', null, null, null, null, sum(listRows, 5), sum(listRows, 6), sum(listRows, 7), null] : undefined }] },
        { key: 'purchases-aging', number: 'P4', title: 'Umur utang usaha per pemasok', paragraphs: ['Sisa tagihan faktur pemasok rupiah per tanggal akhir menurut jatuh tempo.'], tables: [{ columns: ['Pemasok', 'Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', '> 90 hari', 'Total'], align: [L, R, R, R, R, R, R], rows: agingRows, total: agingRows.length ? ['Jumlah', sum(agingRows, 1), sum(agingRows, 2), sum(agingRows, 3), sum(agingRows, 4), sum(agingRows, 5), sum(agingRows, 6)] : undefined }] },
        { key: 'purchases-grni', number: 'P5', title: 'Barang diterima belum ditagih', paragraphs: ['Penerimaan barang yang belum (seluruhnya) difaktur pemasok, per hari ini. Umur panjang menandakan faktur pemasok belum diterima atau belum diinput.'], tables: [{ columns: ['Penerimaan', 'Tanggal', 'Pemasok', 'PO', 'Umur (hari)', 'Nilai', 'Sudah ditagih', 'Belum ditagih'], align: [L, L, L, L, R, R, R, R], rows: grniRows, total: grniRows.length ? ['Jumlah', null, null, null, null, sum(grniRows, 5), sum(grniRows, 6), sum(grniRows, 7)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Persediaan
  private async inventory(tenantId: string, from: string, to: string) {
    const r = await this.rows<{ sku: string; name: string; uom: string; q0: string; v0: string; qin: string; vin: string; qout: string; vout: string; q1: string; v1: string }>(sql`
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
    const rows: Cell[][] = r.map((x) => [x.sku, x.name, x.uom, num(x.q0), num(x.qin), num(x.qout), num(x.q1), num(x.v0), num(x.vin), num(x.vout), num(x.v1)]);
    const byWh = await this.rows<{ code: string; name: string; qty: string; val: string }>(sql`
      SELECT w.code, w.name, COALESCE(SUM(m.qty), 0)::text AS qty, COALESCE(SUM(m.qty * m.unit_cost), 0)::text AS val
      FROM warehouses w JOIN stock_moves m ON m.warehouse_id = w.id AND m.tenant_id = ${tenantId} AND m.date <= ${to}
      WHERE w.tenant_id = ${tenantId} GROUP BY w.id, w.code, w.name ORDER BY w.code`);
    const whRows: Cell[][] = byWh.map((x) => [x.code, x.name, num(x.qty), num(x.val)]);
    const totalValue = sum(rows, 10);
    const glValue = await this.glBalance(tenantId, to, sql`a.system_key IN ('INVENTORY', 'INVENTORY_SEMI')`);
    const [cur] = await this.rows<{ v: string }>(sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE tenant_id = ${tenantId}`);
    const reconciliation = [this.recon('inventory-gl', 'Nilai persediaan vs buku besar', { label: 'Nilai stok menurut kartu stok (qty × biaya)', value: totalValue }, { label: 'Saldo akun Persediaan di buku besar', value: glValue }, 'Selisih biasanya dari persediaan awal yang diisi lewat jurnal, jurnal manual ke akun persediaan, atau pembulatan biaya.')];
    if (to >= todayJakarta()) reconciliation.push(this.recon('inventory-balance', 'Kartu stok vs saldo stok saat ini', { label: 'Nilai dari mutasi stok', value: totalValue }, { label: 'Saldo stok (qty × biaya rata-rata)', value: Number(cur.v) }, 'Hanya dihitung bila tanggal akhir sampai hari ini.'));
    return {
      title: 'Laporan Pendukung Persediaan',
      summary: 'Kartu stok ringkas per produk (saldo awal, masuk, keluar, saldo akhir) dalam jumlah dan nilai, dicocokkan dengan akun persediaan.',
      reconciliation,
      sections: [
        {
          key: 'inventory-card',
          number: 'P1',
          title: 'Mutasi persediaan per produk',
          paragraphs: ['Jumlah dalam satuan dasar. Nilai = jumlah × biaya per satuan pada setiap mutasi.'],
          tables: [
            { title: 'Jumlah', columns: ['SKU', 'Produk', 'Satuan', 'Awal', 'Masuk', 'Keluar', 'Akhir'], align: [L, L, L, R, R, R, R], rows: rows.map((x) => x.slice(0, 7)), total: rows.length ? ['Jumlah', null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6)] : undefined },
            { title: 'Nilai (Rp)', columns: ['SKU', 'Produk', 'Nilai awal', 'Nilai masuk', 'Nilai keluar', 'Nilai akhir'], align: [L, L, R, R, R, R], rows: rows.map((x) => [x[0], x[1], x[7], x[8], x[9], x[10]]), total: rows.length ? ['Jumlah', null, sum(rows, 7), sum(rows, 8), sum(rows, 9), sum(rows, 10)] : undefined },
          ],
        },
        { key: 'inventory-warehouse', number: 'P2', title: 'Persediaan per gudang pada tanggal akhir', paragraphs: [], tables: [{ columns: ['Kode', 'Gudang', 'Jumlah', 'Nilai'], align: [L, L, R, R], rows: whRows, total: whRows.length ? ['Jumlah', null, null, sum(whRows, 3)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Kas & bank
  private async cash(tenantId: string, from: string, to: string) {
    const acc = await this.rows<{ id: string; code: string; name: string; o: string; dr: string; cr: string; c: string }>(sql`
      SELECT a.id::text AS id, a.code, a.name,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date < ${from}), 0)::text AS o,
        COALESCE(SUM(l.debit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS dr,
        COALESCE(SUM(l.credit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS cr,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date <= ${to}), 0)::text AS c
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries j ON j.id = l.journal_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account GROUP BY a.id, a.code, a.name ORDER BY a.code`);
    const accRows: Cell[][] = acc.map((x) => [x.code, x.name, num(x.o), num(x.dr), num(x.cr), num(x.c)]);
    const bySrc = await this.rows<{ src: string; dr: string; cr: string }>(sql`
      SELECT j.source_type AS src, COALESCE(SUM(l.debit), 0)::text AS dr, COALESCE(SUM(l.credit), 0)::text AS cr
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND j.date BETWEEN ${from} AND ${to} GROUP BY j.source_type ORDER BY 2 DESC`);
    const SRC: Record<string, string> = { PAYMENT: 'Pembayaran pelanggan', POS: 'Penjualan kasir', SUPPLIER_PAYMENT: 'Pembayaran pemasok', CASH_IN: 'Kas masuk', CASH_OUT: 'Kas keluar', CASH_TX: 'Transaksi kas', BANK: 'Mutasi bank', TRANSFER: 'Transfer antar kas/bank', PAYROLL: 'Penggajian', PETTY_CASH: 'Kas kecil', TAX_PAYMENT: 'Setoran pajak', MANUAL: 'Jurnal manual', OPENING: 'Saldo awal' };
    const srcRows: Cell[][] = bySrc.map((x) => [SRC[x.src] ?? x.src, num(x.dr), num(x.cr), num(x.dr) - num(x.cr)]);
    const banks = await this.rows<{ code: string; name: string; to_d: string; closing: string; unmatched: number; unmatched_amt: string; gl: string }>(sql`
      SELECT a.code, a.name, s.period_to::text AS to_d, s.closing_balance::text AS closing,
        (SELECT COUNT(*)::int FROM bank_statement_lines b WHERE b.statement_id = s.id AND b.status = 'UNMATCHED') AS unmatched,
        (SELECT COALESCE(SUM(b.amount), 0)::text FROM bank_statement_lines b WHERE b.statement_id = s.id AND b.status = 'UNMATCHED') AS unmatched_amt,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0)::text FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE l.account_id = a.id AND j.tenant_id = ${tenantId} AND j.date <= s.period_to) AS gl
      FROM bank_statements s JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND s.closing_balance IS NOT NULL AND s.period_to <= ${to}
        AND s.period_to = (SELECT MAX(s2.period_to) FROM bank_statements s2 WHERE s2.cash_account_id = s.cash_account_id AND s2.closing_balance IS NOT NULL AND s2.period_to <= ${to})
      ORDER BY a.code`);
    const bankRows: Cell[][] = banks.map((x) => [x.code, x.name, x.to_d, num(x.closing), num(x.gl), num(x.closing) - num(x.gl), x.unmatched, num(x.unmatched_amt)]);
    const totalClose = sum(accRows, 5);
    const glCash = await this.glBalance(tenantId, to, sql`a.is_cash_account`);
    return {
      title: 'Laporan Pendukung Kas & Bank',
      summary: 'Mutasi kas dan bank per akun, sumber penerimaan/pengeluaran, dan kecocokan dengan rekening koran yang sudah diimpor.',
      reconciliation: [
        this.recon('cash-gl', 'Saldo akun kas/bank vs buku besar', { label: 'Jumlah saldo akhir semua akun kas/bank', value: totalClose }, { label: 'Saldo kelompok kas/bank di buku besar', value: glCash }),
        ...banks.map((x) => this.recon(`bank-${x.code}`, `Rekening koran ${x.code} ${x.name} per ${x.to_d}`, { label: 'Saldo akhir rekening koran', value: Number(x.closing) }, { label: 'Saldo buku pada tanggal yang sama', value: Number(x.gl) }, x.unmatched ? `${x.unmatched} mutasi bank belum dicocokkan (Rp${Math.round(Number(x.unmatched_amt)).toLocaleString('id-ID')}).` : undefined)),
      ],
      sections: [
        { key: 'cash-accounts', number: 'P1', title: 'Mutasi per akun kas/bank', paragraphs: [], tables: [{ columns: ['Kode', 'Akun', 'Saldo awal', 'Penerimaan', 'Pengeluaran', 'Saldo akhir'], align: [L, L, R, R, R, R], rows: accRows, total: accRows.length ? ['Jumlah', null, sum(accRows, 2), sum(accRows, 3), sum(accRows, 4), sum(accRows, 5)] : undefined }] },
        { key: 'cash-sources', number: 'P2', title: 'Penerimaan dan pengeluaran per sumber transaksi', paragraphs: ['Transfer antar akun kas muncul di kedua sisi dan saling meniadakan pada jumlah.'], tables: [{ columns: ['Sumber', 'Penerimaan', 'Pengeluaran', 'Neto'], align: [L, R, R, R], rows: srcRows, total: srcRows.length ? ['Jumlah', sum(srcRows, 1), sum(srcRows, 2), sum(srcRows, 3)] : undefined }] },
        { key: 'cash-bank', number: 'P3', title: 'Kecocokan rekening koran (terbaru per rekening)', paragraphs: ['Hanya rekening yang mutasinya sudah diimpor di Kas & Bank › Cocokkan dengan bank.'], tables: [{ columns: ['Kode', 'Rekening', 'Per tanggal', 'Saldo bank', 'Saldo buku', 'Selisih', 'Belum cocok', 'Nilai belum cocok'], align: [L, L, L, R, R, R, R, R], rows: bankRows }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Akun lainnya
  private async other(tenantId: string, from: string, to: string) {
    const acc = await this.rows<{ code: string; name: string; type: string; sk: string | null; cash: boolean; grp: string | null; o: string; dr: string; cr: string; c: string }>(sql`
      SELECT a.code, a.name, a.type::text AS type, a.system_key AS sk, a.is_cash_account AS cash, a.report_group AS grp,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date < ${from}), 0)::text AS o,
        COALESCE(SUM(l.debit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS dr,
        COALESCE(SUM(l.credit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS cr,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date <= ${to}), 0)::text AS c
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries j ON j.id = l.journal_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} GROUP BY a.id, a.code, a.name, a.type, a.system_key, a.is_cash_account, a.report_group ORDER BY a.code`);
    const covered = (x: (typeof acc)[number]) => x.cash || ['AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI', 'SALES', 'SALES_RETURN', 'COGS'].includes(x.sk ?? '');
    const active = (x: (typeof acc)[number]) => Number(x.o) !== 0 || Number(x.dr) !== 0 || Number(x.cr) !== 0 || Number(x.c) !== 0;
    const groups: { key: string; title: string; types: string[]; credit: boolean; group?: string }[] = [
      { key: 'other-receivables', title: 'Piutang lain-lain (di luar piutang usaha)', types: ['ASSET'], credit: false, group: 'OTHER_RECEIVABLE' },
      { key: 'other-assets', title: 'Aset lain', types: ['ASSET'], credit: false },
      { key: 'other-liabilities', title: 'Liabilitas', types: ['LIABILITY'], credit: true },
      { key: 'other-equity', title: 'Ekuitas', types: ['EQUITY'], credit: true },
      { key: 'other-revenue', title: 'Pendapatan lain', types: ['REVENUE'], credit: true },
      { key: 'other-expense', title: 'Beban', types: ['EXPENSE'], credit: false },
    ];
    const sections: SupportSection[] = groups.map((g, i) => {
      const list = acc.filter((x) => g.types.includes(x.type) && !covered(x) && active(x) && (g.group ? x.grp === g.group : !(g.types[0] === 'ASSET' && x.grp === 'OTHER_RECEIVABLE')));
      const sign = g.credit ? -1 : 1;
      const rows: Cell[][] = list.map((x) => [x.code, x.name, num(sign * Number(x.o)), num(g.credit ? x.cr : x.dr), num(g.credit ? x.dr : x.cr), num(sign * Number(x.c))]);
      return {
        key: g.key,
        number: `P${i + 1}`,
        title: g.title,
        paragraphs: i === 0 ? ['Piutang usaha (faktur penjualan) dilaporkan di laporan penjualan; piutang lain seperti karyawan, platform, klaim, retensi, dan antar cabang dipisahkan di bagian ini. Seluruh akun di luar kas/bank, piutang, utang usaha, persediaan, dan penjualan/HPP (yang punya laporan pendukung sendiri). Daftar aset tetap dan umur piutang/utang ada di Lampiran Laporan Keuangan.'] : [],
        tables: [{ columns: ['Kode', 'Akun', 'Saldo awal', g.credit ? 'Kredit' : 'Debit', g.credit ? 'Debit' : 'Kredit', 'Saldo akhir'], align: [L, L, R, R, R, R], rows, total: rows.length ? ['Jumlah', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] : undefined }],
      };
    });
    const tax = acc.filter((x) => ['VAT_IN', 'VAT_OUT', 'PPH21_PAYABLE', 'PPH23_PAYABLE', 'PPH4_2_PAYABLE', 'FINAL_TAX_WITHHELD', 'CORPORATE_TAX_PAYABLE'].includes(x.sk ?? ''));
    const taxRows: Cell[][] = tax.map((x) => [x.code, x.name, num(Number(x.o)), num(x.dr), num(x.cr), num(Number(x.c))]);
    sections.push({ key: 'other-tax', number: `P${sections.length + 1}`, title: 'Pajak: saldo akun PPN dan PPh', paragraphs: ['Saldo debit (positif) = lebih bayar/dapat dikreditkan; saldo kredit (negatif) = masih harus disetor. Cocokkan dengan Setoran Pajak.'], tables: [{ columns: ['Kode', 'Akun', 'Saldo awal (D−K)', 'Debit', 'Kredit', 'Saldo akhir (D−K)'], align: [L, L, R, R, R, R], rows: taxRows }] });
    return {
      title: 'Laporan Pendukung Akun Lainnya',
      summary: 'Mutasi seluruh akun yang tidak tercakup laporan pendukung lain: aset lain, liabilitas, ekuitas, pendapatan dan beban lain, serta saldo pajak.',
      reconciliation: [this.recon('other-balance', 'Neraca saldo seimbang', { label: 'Jumlah saldo debit seluruh akun', value: acc.reduce((a, x) => a + Math.max(Number(x.c), 0), 0) }, { label: 'Jumlah saldo kredit seluruh akun', value: acc.reduce((a, x) => a + Math.max(-Number(x.c), 0), 0) })],
      sections,
    };
  }

  // ------------------------------------------------------------------ Kasir (Ritel & F&B)
  private async pos(tenantId: string, from: string, to: string) {
    const orderIn = sql`o.tenant_id = ${tenantId} AND o.date BETWEEN ${from} AND ${to}`;
    const cashiers = await this.rows<{ name: string; n: number; sub: string; tax: string; tot: string; rtot: string }>(sql`
      SELECT u.name, COUNT(o.id)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax, SUM(o.total)::text AS tot,
        COALESCE(SUM((SELECT SUM(r.total) FROM pos_returns r WHERE r.order_id = o.id AND r.date <= ${to})), 0)::text AS rtot
      FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id JOIN users u ON u.id = s.user_id
      WHERE ${orderIn} GROUP BY u.id, u.name ORDER BY SUM(o.total) DESC`);
    const cashierRows: Cell[][] = cashiers.map((r) => [r.name, r.n, num(r.sub), num(r.tax), num(r.tot), num(r.rtot), num(r.tot) - num(r.rtot)]);
    const sessions = await this.rows<{ number: string; name: string; opened: string; closed: string | null; status: string; n: number; tot: string; expected: string | null; counted: string | null; diff: string | null }>(sql`
      SELECT s.number, u.name, to_char(s.opened_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS opened,
        to_char(s.closed_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS closed, s.status::text AS status,
        (SELECT COUNT(*)::int FROM pos_orders o WHERE o.session_id = s.id) AS n,
        COALESCE((SELECT SUM(o.total) FROM pos_orders o WHERE o.session_id = s.id), 0)::text AS tot,
        s.expected_cash::text AS expected, s.counted_cash::text AS counted, s.difference::text AS diff
      FROM pos_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.tenant_id = ${tenantId} AND (s.opened_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${from} AND ${to}
      ORDER BY s.opened_at LIMIT ${CAP}`);
    const sessionRows: Cell[][] = sessions.map((r) => [r.number, r.name, r.opened, r.closed ?? '-', r.status === 'OPEN' ? 'Terbuka' : 'Ditutup', r.n, num(r.tot), r.expected === null ? null : num(r.expected), r.counted === null ? null : num(r.counted), r.diff === null ? null : num(r.diff)]);
    const methods = await this.rows<{ method: string; n: number; amt: string }>(sql`
      SELECT p.method::text AS method, COUNT(DISTINCT p.order_id)::int AS n, SUM(p.amount)::text AS amt
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn} GROUP BY p.method ORDER BY SUM(p.amount) DESC`);
    const LABEL: Record<string, string> = { CASH: 'Tunai', QRIS: 'QRIS', DEBIT: 'Kartu debit', TRANSFER: 'Transfer', PLATFORM: 'Platform pesan-antar' };
    const methodRows: Cell[][] = methods.map((r) => [LABEL[r.method] ?? r.method, r.n, num(r.amt)]);

    const [docs] = await this.rows<{ sub: string; rsub: string; tot: string; pay: string; nonplat: string }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL)::text AS sub,
             (SELECT COALESCE(SUM(subtotal), 0) FROM pos_returns WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS rsub,
             (SELECT COALESCE(SUM(total), 0) FROM pos_orders o WHERE ${orderIn})::text AS tot,
             (SELECT COALESCE(SUM(p.amount), 0) FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn})::text AS pay,
             (SELECT COALESCE(SUM(p.amount), 0) FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orderIn} AND p.method <> 'PLATFORM')::text AS nonplat`);
    const [gl] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND j.date BETWEEN ${from} AND ${to}
        AND (j.id IN (SELECT journal_id FROM pos_orders WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)
          OR j.id IN (SELECT journal_id FROM pos_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL))`);
    const [diffs] = await this.rows<{ sessions: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(difference), 0) FROM pos_sessions WHERE tenant_id = ${tenantId} AND status = 'CLOSED' AND (closed_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${from} AND ${to})::text AS sessions,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND j.source_type = 'POS_CLOSE' AND a.system_key = 'CASH_DIFF' AND j.date BETWEEN ${from} AND ${to})::text AS gl`);
    const [dep] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit), 0)::text AS v FROM journal_lines l JOIN pos_orders o ON o.journal_id = l.journal_id JOIN pos_sessions s ON s.id = o.session_id
      WHERE ${orderIn} AND l.account_id IN (s.cash_account_id, s.bank_account_id)`);

    return {
      title: 'Laporan Pendukung Kasir (Ritel & F&B)',
      summary: 'Penjualan kasir per kasir, sesi, dan metode bayar, selisih uang di laci, serta pencocokan dengan pendapatan, kas, dan bank di buku besar.',
      reconciliation: [
        this.recon('pos-revenue', 'Penjualan kasir neto vs akun pendapatan', { label: 'Pesanan kasir − retur kasir (DPP)', value: Number(docs.sub) - Number(docs.rsub) }, { label: 'Akun pendapatan pada jurnal kasir & retur kasir', value: Number(gl.v) }, 'Selisih berarti jurnal kasir diubah di luar transaksi kasir.'),
        this.recon('pos-payments', 'Pembayaran vs total pesanan', { label: 'Total pesanan kasir', value: Number(docs.tot) }, { label: 'Jumlah pembayaran tercatat (semua metode)', value: Number(docs.pay) }, 'Tunai dihitung bersih setelah kembalian. Selisih menunjukkan pesanan yang pembayarannya tidak lengkap.'),
        this.recon('pos-deposit', 'Pembayaran tunai & non-tunai vs kas/bank', { label: 'Pembayaran bukan platform', value: Number(docs.nonplat) }, { label: 'Debit ke akun laci kas & rekening kasir pada jurnal pesanan', value: Number(dep.v) }, 'Memastikan uang kasir benar-benar masuk ke laci kas dan rekening yang dipilih pada sesi.'),
        this.recon('pos-cash-diff', 'Selisih kas sesi ditutup vs akun selisih kas', { label: 'Jumlah selisih (dihitung − seharusnya) pada sesi ditutup', value: Number(diffs.sessions) }, { label: 'Akun Selisih Kas Kasir pada jurnal tutup kasir (kredit − debit)', value: Number(diffs.gl) }, 'Selisih kurang tercatat sebagai beban, lebih sebagai pengurang beban.'),
      ],
      sections: [
        { key: 'pos-cashier', number: 'K1', title: 'Penjualan per kasir', paragraphs: ['Berdasarkan sesi tempat pesanan dibuat. Retur kasir dihitung sampai tanggal akhir.'], tables: [{ columns: ['Kasir', 'Pesanan', 'DPP', 'Pajak', 'Total', 'Retur', 'Neto'], align: [L, R, R, R, R, R, R], rows: cashierRows, total: cashierRows.length ? ['Jumlah', sum(cashierRows, 1), sum(cashierRows, 2), sum(cashierRows, 3), sum(cashierRows, 4), sum(cashierRows, 5), sum(cashierRows, 6)] : undefined }] },
        { key: 'pos-method', number: 'K2', title: 'Penjualan per metode bayar', paragraphs: ['Tunai bersih setelah kembalian. Pesanan dengan beberapa metode dihitung sekali per metode.'], tables: [{ columns: ['Metode', 'Pesanan', 'Jumlah'], align: [L, R, R], rows: methodRows, total: methodRows.length ? ['Jumlah', null, sum(methodRows, 2)] : undefined }] },
        { key: 'pos-session', number: 'K3', title: 'Sesi kasir dan selisih uang di laci', paragraphs: ['Selisih = uang dihitung − uang seharusnya. Selisih kurang dicatat sebagai beban; periksa sesi dengan selisih berulang.'], tables: [{ columns: ['Sesi', 'Kasir', 'Dibuka', 'Ditutup', 'Status', 'Pesanan', 'Penjualan', 'Seharusnya', 'Dihitung', 'Selisih'], align: [L, L, L, L, L, R, R, R, R, R], rows: sessionRows, total: sessionRows.length ? ['Jumlah', null, null, null, null, sum(sessionRows, 5), sum(sessionRows, 6), sum(sessionRows, 7), sum(sessionRows, 8), sum(sessionRows, 9)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ F&B
  private async fnb(tenantId: string, from: string, to: string) {
    const orderIn = sql`o.tenant_id = ${tenantId} AND o.date BETWEEN ${from} AND ${to}`;
    const menu = await this.rows<{ sku: string; name: string; qty: string; sales: string; recipe: boolean }>(sql`
      SELECT p.sku, p.name, SUM(l.qty * l.uom_factor)::text AS qty, SUM(l.line_total)::text AS sales, bool_or(l.from_recipe) AS recipe
      FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
      WHERE ${orderIn} GROUP BY p.id, p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT ${CAP}`);
    const menuRowsAll: Cell[][] = menu.map((r) => [r.sku, r.name, num(r.qty), num(r.sales), r.recipe ? 'Ya' : 'Tidak']);
    const menuRows = withRest(menuRowsAll, 100, [2, 3]);
    const types = await this.rows<{ t: string | null; n: number; sub: string; tax: string; tot: string }>(sql`
      SELECT o.order_type AS t, COUNT(*)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax, SUM(o.total)::text AS tot
      FROM pos_orders o WHERE ${orderIn} GROUP BY o.order_type ORDER BY SUM(o.total) DESC`);
    const TYPE: Record<string, string> = { DINE_IN: 'Makan di tempat', TAKEAWAY: 'Bawa pulang', DELIVERY: 'Antar' };
    const typeRows: Cell[][] = types.map((r) => [r.t ? TYPE[r.t] ?? r.t : 'Tidak dicatat', r.n, num(r.sub), num(r.tax), num(r.tot)]);
    const taxes = await this.rows<{ k: string; n: number; sub: string; tax: string; rtax: string }>(sql`
      SELECT o.tax_kind AS k, COUNT(*)::int AS n, SUM(o.subtotal)::text AS sub, SUM(o.tax_amount)::text AS tax,
        COALESCE(SUM((SELECT SUM(r.tax_amount) FROM pos_returns r WHERE r.order_id = o.id AND r.date BETWEEN ${from} AND ${to})), 0)::text AS rtax
      FROM pos_orders o WHERE ${orderIn} GROUP BY o.tax_kind ORDER BY 1`);
    const taxRows: Cell[][] = taxes.map((r) => [r.k === 'LOCAL' ? 'Pajak restoran daerah (PB1/PBJT)' : 'PPN', r.n, num(r.sub), num(r.tax), num(r.rtax), num(r.tax) - num(r.rtax)]);
    const channels = await this.rows<{ c: string; n: number; tot: string; fee: string; settled: string; open: string }>(sql`
      SELECT o.channel AS c, COUNT(*)::int AS n, SUM(o.total)::text AS tot, SUM(o.platform_fee)::text AS fee,
        COALESCE(SUM(o.total - o.platform_fee) FILTER (WHERE o.settlement_id IS NOT NULL), 0)::text AS settled,
        COALESCE(SUM(o.total - o.platform_fee) FILTER (WHERE o.settlement_id IS NULL), 0)::text AS open
      FROM pos_orders o WHERE ${orderIn} AND o.channel IS NOT NULL GROUP BY o.channel ORDER BY 1`);
    const channelRows: Cell[][] = channels.map((r) => [r.c, r.n, num(r.tot), num(r.fee), num(r.tot) - num(r.fee), num(r.settled), num(r.open)]);
    const settlements = await this.rows<{ number: string; channel: string; d: string; n: number; expected: string; received: string; diff: string }>(sql`
      SELECT number, channel, date::text AS d, order_count AS n, expected::text AS expected, received::text AS received, difference::text AS diff
      FROM pos_platform_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND date BETWEEN ${from} AND ${to} ORDER BY date, number LIMIT ${CAP}`);
    const settleRows: Cell[][] = settlements.map((r) => [r.number, r.channel, r.d, r.n, num(r.expected), num(r.received), num(r.diff)]);

    // Bahan terpakai: seharusnya menurut resep aktif vs yang keluar dari kartu stok pada pesanan kasir
    const usage = await this.rows<{ sku: string; name: string; expected: string; actual: string }>(sql`
      WITH menu_line AS (
        SELECT DISTINCT ON (l.id) l.id, l.product_id, l.qty * l.uom_factor AS q, b.id AS bom_id, b.output_qty
        FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        JOIN boms b ON b.tenant_id = ${tenantId} AND b.product_id = l.product_id AND b.created_at <= o.created_at
        WHERE ${orderIn} AND l.from_recipe ORDER BY l.id, b.created_at DESC),
      need AS (
        SELECT bl.product_id, SUM(m.q * bl.qty / NULLIF(m.output_qty, 0)) AS expected
        FROM menu_line m JOIN bom_lines bl ON bl.bom_id = m.bom_id GROUP BY bl.product_id),
      moved AS (
        SELECT sm.product_id, SUM(-sm.qty) AS q FROM stock_moves sm JOIN pos_orders o ON o.id::text = sm.ref_id
        WHERE sm.tenant_id = ${tenantId} AND sm.ref_type = 'POS_ORDER' AND ${orderIn} AND sm.product_id IN (SELECT product_id FROM need) GROUP BY sm.product_id),
      direct AS (
        SELECT l.product_id, SUM(l.qty * l.uom_factor) AS q FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        WHERE ${orderIn} AND NOT l.from_recipe AND l.product_id IN (SELECT product_id FROM need) GROUP BY l.product_id)
      SELECT p.sku, p.name, need.expected::text AS expected, (COALESCE(moved.q, 0) - COALESCE(direct.q, 0))::text AS actual
      FROM need JOIN products p ON p.id = need.product_id LEFT JOIN moved ON moved.product_id = need.product_id LEFT JOIN direct ON direct.product_id = need.product_id
      ORDER BY p.name LIMIT ${CAP}`);
    const usageRows: Cell[][] = usage.map((r) => [r.sku, r.name, num(r.expected), num(r.actual), Math.round((num(r.actual) - num(r.expected)) * 10000) / 10000]);
    const usageOk = usageRows.filter((r) => Math.abs(Number(r[4])) < 0.001).length;

    const [cogs] = await this.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(cogs_amount), 0) FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL)::text AS doc,
             (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'COGS' AND j.id IN (SELECT journal_id FROM pos_orders o WHERE ${orderIn} AND journal_id IS NOT NULL))::text AS gl`);
    const [pb1] = await this.rows<{ doc: string; gl: string }>(sql`
      SELECT ((SELECT COALESCE(SUM(o.tax_amount), 0) FROM pos_orders o WHERE ${orderIn} AND o.tax_kind = 'LOCAL' AND o.journal_id IS NOT NULL)
              - (SELECT COALESCE(SUM(r.tax_amount), 0) FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${from} AND ${to} AND o.tax_kind = 'LOCAL' AND r.journal_id IS NOT NULL))::text AS doc,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key = 'LOCAL_TAX' AND j.date BETWEEN ${from} AND ${to}
                AND (j.id IN (SELECT journal_id FROM pos_orders WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)
                  OR j.id IN (SELECT journal_id FROM pos_returns WHERE tenant_id = ${tenantId} AND journal_id IS NOT NULL)))::text AS gl`);
    const [plat] = await this.rows<{ open: string }>(sql`
      SELECT COALESCE(SUM(o.total - o.platform_fee), 0)::text AS open FROM pos_orders o
      LEFT JOIN pos_platform_settlements s ON s.id = o.settlement_id AND s.status = 'POSTED'
      WHERE o.tenant_id = ${tenantId} AND o.channel IS NOT NULL AND o.date <= ${to} AND (s.id IS NULL OR s.date > ${to})`);
    const platGl = await this.glBalance(tenantId, to, sql`a.system_key = 'PLATFORM_RECEIVABLE'`);

    return {
      title: 'Laporan Pendukung F&B',
      summary: 'Penjualan per menu dan jenis pesanan, pajak restoran daerah, pencairan platform pesan-antar, dan pemakaian bahan dibanding resep.',
      reconciliation: [
        this.recon('fnb-pb1', 'Pajak restoran daerah vs akun pajak daerah', { label: 'Pajak daerah pesanan − retur (dokumen)', value: Number(pb1.doc) }, { label: 'Akun pajak restoran daerah pada jurnal kasir', value: Number(pb1.gl) }, 'Dasar angka setoran PB1/PBJT. Selisih berarti jurnal pajak diubah di luar transaksi kasir.'),
        this.recon('fnb-platform', 'Pesanan platform belum cair vs piutang platform', { label: 'Pesanan online belum dicairkan (bersih dari komisi)', value: Number(plat.open) }, { label: 'Saldo akun Piutang Platform di buku besar', value: platGl }, 'Selisih biasanya dari jurnal manual ke akun piutang platform atau pencairan yang dibatalkan.'),
        this.recon('fnb-cogs', 'HPP pesanan kasir vs akun HPP', { label: 'HPP tercatat pada pesanan', value: Number(cogs.doc) }, { label: 'Akun HPP pada jurnal pesanan', value: Number(cogs.gl) }, 'HPP menu adalah nilai bahan yang dipotong dari persediaan.'),
        this.recon('fnb-usage', 'Bahan sesuai resep', { label: 'Bahan yang dicek', value: usageRows.length }, { label: 'Bahan dengan pemakaian sama dengan resep', value: usageOk }, 'Memakai resep yang berlaku saat pesanan dibuat. Selisih muncul bila isi resep diubah tanpa membuat resep baru, atau kartu stok bahan dikoreksi.'),
      ],
      sections: [
        { key: 'fnb-menu', number: 'F1', title: 'Penjualan per menu (100 teratas, sisanya digabung)', paragraphs: ['Jumlah dalam satuan dasar. "Dari resep" berarti bahan menu dipotong sesuai resep saat dijual.'], tables: [{ columns: ['SKU', 'Menu', 'Jumlah', 'Penjualan', 'Dari resep'], align: [L, L, R, R, L], rows: menuRows, total: menuRows.length ? ['Jumlah', null, sum(menuRows, 2), sum(menuRows, 3), null] : undefined }] },
        { key: 'fnb-type', number: 'F2', title: 'Penjualan per jenis pesanan', paragraphs: [], tables: [{ columns: ['Jenis', 'Pesanan', 'DPP', 'Pajak', 'Total'], align: [L, R, R, R, R], rows: typeRows, total: typeRows.length ? ['Jumlah', sum(typeRows, 1), sum(typeRows, 2), sum(typeRows, 3), sum(typeRows, 4)] : undefined }] },
        { key: 'fnb-tax', number: 'F3', title: 'Pajak penjualan kasir', paragraphs: ['Pajak restoran daerah (PB1/PBJT) menggantikan PPN pada pesanan kasir bila dinyalakan di pengaturan.'], tables: [{ columns: ['Jenis pajak', 'Pesanan', 'DPP', 'Pajak', 'Retur', 'Pajak neto'], align: [L, R, R, R, R, R], rows: taxRows, total: taxRows.length ? ['Jumlah', sum(taxRows, 1), sum(taxRows, 2), sum(taxRows, 3), sum(taxRows, 4), sum(taxRows, 5)] : undefined }] },
        { key: 'fnb-platform', number: 'F4', title: 'Pesanan online dan pencairan platform', paragraphs: ['Piutang platform = total pesanan − komisi, hingga dicairkan. Selisih pencairan menunjukkan dana yang masuk berbeda dari seharusnya.'], tables: [{ title: 'Pesanan per kanal', columns: ['Kanal', 'Pesanan', 'Total', 'Komisi', 'Bersih', 'Sudah cair', 'Belum cair'], align: [L, R, R, R, R, R, R], rows: channelRows, total: channelRows.length ? ['Jumlah', sum(channelRows, 1), sum(channelRows, 2), sum(channelRows, 3), sum(channelRows, 4), sum(channelRows, 5), sum(channelRows, 6)] : undefined }, { title: 'Pencairan dalam periode', columns: ['Nomor', 'Kanal', 'Tanggal', 'Pesanan', 'Seharusnya', 'Diterima', 'Selisih'], align: [L, L, L, R, R, R, R], rows: settleRows, total: settleRows.length ? ['Jumlah', null, null, sum(settleRows, 3), sum(settleRows, 4), sum(settleRows, 5), sum(settleRows, 6)] : undefined }] },
        { key: 'fnb-usage', number: 'F5', title: 'Bahan terpakai vs resep', paragraphs: ['Seharusnya = jumlah menu terjual × kebutuhan bahan menurut resep yang berlaku saat pesanan dibuat (resep terbaru yang sudah ada saat itu). Keluar = pengeluaran stok bahan dari pesanan kasir (tanpa penjualan langsung bahan itu). Satuan dasar bahan. Menu yang diretur tidak mengembalikan bahan ke stok (sudah diolah), jadi retur tidak mengurangi pemakaian.'], tables: [{ columns: ['SKU', 'Bahan', 'Seharusnya', 'Keluar', 'Selisih'], align: [L, L, R, R, R], rows: usageRows }] },
      ],
    };
  }

  // ------------------------------------------------------------------ FMCG
  private async fmcg(tenantId: string, from: string, to: string) {
    const today = todayJakarta();
    const p1 = from.slice(0, 7);
    const p2 = to.slice(0, 7);
    const bySales = await this.rows<{ name: string | null; n: number; sub: string; rsub: string }>(sql`
      SELECT u.name, COUNT(i.id)::int AS n, COALESCE(SUM(i.subtotal), 0)::text AS sub,
        COALESCE(SUM((SELECT SUM(r.subtotal) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date BETWEEN ${from} AND ${to})), 0)::text AS rsub
      FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id LEFT JOIN users u ON u.id = so.salesperson_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening GROUP BY u.id, u.name ORDER BY SUM(i.subtotal) DESC`);
    const salesRows: Cell[][] = bySales.map((r) => [r.name ?? 'Tanpa sales', r.n, num(r.sub), num(r.rsub), num(r.sub) - num(r.rsub)]);
    const comm = await this.rows<{ number: string; name: string; period: string; net: string; target: string; pct: string; amount: string; status: string }>(sql`
      SELECT c.number, u.name, c.period, c.net_sales::text AS net, c.target_amount::text AS target, c.commission_pct::text AS pct, c.amount::text AS amount, c.status
      FROM sales_commissions c JOIN users u ON u.id = c.user_id
      WHERE c.tenant_id = ${tenantId} AND c.period BETWEEN ${p1} AND ${p2} ORDER BY c.period, u.name LIMIT ${CAP}`);
    const STATUS: Record<string, string> = { ACCRUED: 'Utang komisi', PAID: 'Dibayar', VOID: 'Dibatalkan' };
    const commRows: Cell[][] = comm.map((r) => [r.number, r.name, r.period, num(r.net), num(r.target), num(r.target) ? num((num(r.net) / num(r.target)) * 100) : null, num(r.pct), num(r.amount), STATUS[r.status] ?? r.status]);
    const promos = await this.rows<{ name: string; kind: string; n: number; bonus: string; funded: string; claimed: string }>(sql`
      SELECT p.name, p.kind, COUNT(l.id)::int AS n,
        COALESCE(SUM(l.qty * l.uom_factor) FILTER (WHERE l.is_bonus), 0)::text AS bonus, p.funded_pct::text AS funded,
        COALESCE((SELECT SUM(cl.amount) FROM principal_claim_lines cl WHERE cl.promo_id = p.id AND cl.tenant_id = ${tenantId}), 0)::text AS claimed
      FROM promos p JOIN sales_order_lines l ON l.promo_id = p.id JOIN sales_orders so ON so.id = l.order_id
      WHERE p.tenant_id = ${tenantId} AND so.date BETWEEN ${from} AND ${to} AND so.status <> 'CANCELLED'
      GROUP BY p.id, p.name, p.kind, p.funded_pct ORDER BY p.name LIMIT ${CAP}`);
    const promoRows: Cell[][] = promos.map((r) => [r.name, r.kind === 'BONUS' ? 'Bonus barang' : 'Diskon', r.n, num(r.bonus), num(r.funded), num(r.claimed)]);
    const claims = await this.rows<{ number: string; supplier: string; period: string; claimed: string; approved: string; status: string }>(sql`
      SELECT c.number, s.name AS supplier, c.period, c.claimed_amount::text AS claimed, c.approved_amount::text AS approved, c.status
      FROM principal_claims c JOIN suppliers s ON s.id = c.supplier_id
      WHERE c.tenant_id = ${tenantId} AND c.period BETWEEN ${p1} AND ${p2} ORDER BY c.period, c.number LIMIT ${CAP}`);
    const CS: Record<string, string> = { DRAFT: 'Draf', SUBMITTED: 'Diajukan', APPROVED: 'Disetujui (belum cair)', PAID: 'Cair', REJECTED: 'Ditolak' };
    const claimRows: Cell[][] = claims.map((r) => [r.number, r.supplier, r.period, num(r.claimed), num(r.approved), CS[r.status] ?? r.status]);
    const accruals = await this.rows<{ number: string; customer: string; term: string; period: string; base: string; amount: string; settled: string; status: string }>(sql`
      SELECT a.number, c.name AS customer, t.name AS term, a.period, a.base_amount::text AS base, a.amount::text AS amount, a.settled_amount::text AS settled, a.status
      FROM trade_accruals a JOIN customers c ON c.id = a.customer_id JOIN trade_terms t ON t.id = a.term_id
      WHERE a.tenant_id = ${tenantId} AND a.period BETWEEN ${p1} AND ${p2} ORDER BY a.period, c.name LIMIT ${CAP}`);
    const accRows: Cell[][] = accruals.map((r) => [r.number, r.customer, r.term, r.period, num(r.base), num(r.amount), num(r.settled), num(r.amount) - num(r.settled), r.status === 'VOID' ? 'Dibatalkan' : r.status === 'SETTLED' ? 'Lunas' : 'Utang']);
    const swaps = await this.rows<{ reason: string; n: number; cost: string }>(sql`
      SELECT reason, COUNT(*)::int AS n, COALESCE(SUM(cost_amount), 0)::text AS cost FROM goods_swaps
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND date BETWEEN ${from} AND ${to} GROUP BY reason ORDER BY reason`);
    const RS: Record<string, string> = { EXPIRED: 'Kedaluwarsa', DAMAGED: 'Rusak', RECALL: 'Penarikan (recall)' };
    const swapRows: Cell[][] = swaps.map((r) => [RS[r.reason] ?? r.reason, r.n, num(r.cost)]);
    const consign = await this.rows<{ customer: string; sku: string; name: string; qty: string; val: string }>(sql`
      SELECT c.name AS customer, p.sku, p.name, b.qty::text AS qty, (b.qty * b.avg_cost)::text AS val
      FROM (SELECT DISTINCT customer_id, warehouse_id FROM consignment_docs WHERE tenant_id = ${tenantId}) d
      JOIN customers c ON c.id = d.customer_id JOIN stock_balances b ON b.warehouse_id = d.warehouse_id AND b.tenant_id = ${tenantId}
      JOIN products p ON p.id = b.product_id WHERE b.qty <> 0 ORDER BY c.name, p.name LIMIT ${CAP}`);
    const consignRows: Cell[][] = consign.map((r) => [r.customer, r.sku, r.name, num(r.qty), num(r.val)]);
    const [pend] = await this.rows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM consignment_docs WHERE tenant_id = ${tenantId} AND kind = 'REPORT' AND status = 'REPORTED'`);
    const canvass = await this.rows<{ name: string; n: number; amount: string; received: string; shortage: string; pending: string; rejected: string }>(sql`
      SELECT u.name, COUNT(*)::int AS n, SUM(c.amount)::text AS amount,
        COALESCE(SUM(c.received_amount) FILTER (WHERE c.status = 'VERIFIED'), 0)::text AS received,
        COALESCE(SUM(c.shortage) FILTER (WHERE c.status = 'VERIFIED'), 0)::text AS shortage,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PENDING'), 0)::text AS pending,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'REJECTED'), 0)::text AS rejected
      FROM canvass_collections c JOIN users u ON u.id = c.user_id
      WHERE c.tenant_id = ${tenantId} AND c.date BETWEEN ${from} AND ${to} GROUP BY u.id, u.name ORDER BY u.name`);
    const canvassRows: Cell[][] = canvass.map((r) => [r.name, r.n, num(r.amount), num(r.received), num(r.shortage), num(r.pending), num(r.rejected)]);

    // Pencocokan: status dokumen dibandingkan dengan saldo akun per hari ini (status dokumen tidak menyimpan riwayat)
    const [d] = await this.rows<{ comm_acc: string; comm_gl: string; comm_open: string; trade_open: string; claim_open: string; swap_doc: string; swap_gl: string; short_doc: string; short_gl: string }>(sql`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM sales_commissions WHERE tenant_id = ${tenantId} AND status <> 'VOID' AND accrual_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to}))::text AS comm_acc,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE a.system_key = 'SALES_COMMISSION' AND l.journal_id IN (SELECT accrual_journal_id FROM sales_commissions WHERE tenant_id = ${tenantId} AND status <> 'VOID' AND accrual_journal_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to})))::text AS comm_gl,
        (SELECT COALESCE(SUM(c.amount), 0) FROM sales_commissions c JOIN journal_entries ja ON ja.id = c.accrual_journal_id
          WHERE c.tenant_id = ${tenantId} AND ja.date <= ${to}
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = ja.id AND r.date <= ${to})
            AND NOT EXISTS (SELECT 1 FROM journal_entries jp WHERE jp.id = c.payment_journal_id AND jp.date <= ${to}))::text AS comm_open,
        (SELECT COALESCE(SUM(amount - settled_amount), 0) FROM trade_accruals WHERE tenant_id = ${tenantId} AND status <> 'VOID')::text AS trade_open,
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
    const commPay = -(await this.glBalance(tenantId, to, sql`a.system_key = 'COMMISSION_PAYABLE'`));
    const tradePay = -(await this.glBalance(tenantId, today, sql`a.system_key = 'TRADE_ACCRUAL_PAYABLE'`));
    const claimGl = await this.glBalance(tenantId, to, sql`a.system_key = 'PRINCIPAL_CLAIM'`);

    return {
      title: 'Laporan Pendukung FMCG',
      summary: 'Penjualan per sales, komisi, promo dan klaim prinsipal, rebate outlet, tukar-guling, konsinyasi, dan setoran kanvas, dicocokkan dengan buku besar.',
      reconciliation: [
        this.recon('fmcg-commission', 'Komisi sales (periode) vs beban komisi', { label: 'Komisi ditutup pada periode (tidak dibatalkan)', value: Number(d.comm_acc) }, { label: 'Akun Beban Komisi pada jurnal komisi tersebut', value: Number(d.comm_gl) }),
        this.recon('fmcg-commission-payable', 'Komisi belum dibayar vs utang komisi', { label: 'Komisi ditutup, belum dibayar, tidak dibatalkan (per tanggal akhir)', value: Number(d.comm_open) }, { label: 'Saldo akun Utang Komisi Sales per tanggal akhir', value: commPay }),
        this.recon('fmcg-trade', 'Rebate outlet belum dilunasi vs utang rebate', { label: 'Sisa utang rebate/trade promo (per hari ini)', value: Number(d.trade_open) }, { label: 'Saldo akun Utang Rebate & Trade Promo Outlet per hari ini', value: tradePay }, 'Dibandingkan per hari ini karena status tidak menyimpan riwayat.'),
        this.recon('fmcg-claim', 'Klaim disetujui belum cair vs piutang prinsipal', { label: 'Klaim disetujui belum cair (per tanggal akhir)', value: Number(d.claim_open) }, { label: 'Saldo akun Piutang Klaim Promo ke Prinsipal per tanggal akhir', value: claimGl }),
        this.recon('fmcg-swap', 'Tukar-guling disetujui vs akun kerugian', { label: 'Biaya tukar-guling disetujui pada periode', value: Number(d.swap_doc) }, { label: 'Akun kerugian kedaluwarsa/rusak/recall pada jurnal tukar-guling', value: Number(d.swap_gl) }),
        this.recon('fmcg-canvass', 'Kurang setor kanvas vs piutang karyawan', { label: 'Kurang setor pada setoran diverifikasi', value: Number(d.short_doc) }, { label: 'Debit Piutang Karyawan pada jurnal pelunasan kanvas', value: Number(d.short_gl) }, 'Kurang setor menjadi piutang karyawan sampai dipotong atau dilunasi.'),
      ],
      sections: [
        { key: 'fmcg-sales', number: 'M1', title: 'Penjualan per sales', paragraphs: ['Faktur dari pesanan yang dipegang sales (DPP), dikurangi retur pada periode.'], tables: [{ columns: ['Sales', 'Faktur', 'Penjualan (DPP)', 'Retur (DPP)', 'Neto'], align: [L, R, R, R, R], rows: salesRows, total: salesRows.length ? ['Jumlah', sum(salesRows, 1), sum(salesRows, 2), sum(salesRows, 3), sum(salesRows, 4)] : undefined }] },
        { key: 'fmcg-commission', number: 'M2', title: 'Target dan komisi sales', paragraphs: ['Angka dibekukan saat komisi ditutup. Capaian = penjualan neto ÷ target.'], tables: [{ columns: ['Nomor', 'Sales', 'Periode', 'Penjualan neto', 'Target', 'Capaian %', 'Komisi %', 'Komisi', 'Status'], align: [L, L, L, R, R, R, R, R, L], rows: commRows, total: commRows.length ? ['Jumlah', null, null, sum(commRows, 3), null, null, null, sum(commRows, 7), null] : undefined }] },
        { key: 'fmcg-promo', number: 'M3', title: 'Pemakaian promo dan klaim ke prinsipal', paragraphs: ['"Diklaim" = nilai pada klaim prinsipal untuk promo itu (semua periode).'], tables: [{ title: 'Promo yang dipakai pada periode', columns: ['Promo', 'Jenis', 'Baris pesanan', 'Barang bonus', 'Ditanggung prinsipal %', 'Diklaim'], align: [L, L, R, R, R, R], rows: promoRows }, { title: 'Klaim prinsipal', columns: ['Nomor', 'Prinsipal', 'Periode', 'Diklaim', 'Disetujui', 'Status'], align: [L, L, L, R, R, L], rows: claimRows, total: claimRows.length ? ['Jumlah', null, null, sum(claimRows, 3), sum(claimRows, 4), null] : undefined }] },
        { key: 'fmcg-trade', number: 'M4', title: 'Rebate dan trade promo outlet', paragraphs: [], tables: [{ columns: ['Nomor', 'Outlet', 'Syarat', 'Periode', 'Dasar', 'Rebate', 'Dilunasi', 'Sisa', 'Status'], align: [L, L, L, L, R, R, R, R, L], rows: accRows, total: accRows.length ? ['Jumlah', null, null, null, sum(accRows, 4), sum(accRows, 5), sum(accRows, 6), sum(accRows, 7), null] : undefined }] },
        { key: 'fmcg-swap', number: 'M5', title: 'Tukar-guling', paragraphs: ['Hanya yang sudah disetujui; nilai = harga pokok barang yang ditarik.'], tables: [{ columns: ['Alasan', 'Dokumen', 'Biaya'], align: [L, R, R], rows: swapRows, total: swapRows.length ? ['Jumlah', sum(swapRows, 1), sum(swapRows, 2)] : undefined }] },
        { key: 'fmcg-consign', number: 'M6', title: 'Konsinyasi: sisa titipan di outlet', paragraphs: [`Saldo stok di gudang konsinyasi per hari ini (satuan dasar) beserta nilainya pada harga pokok rata-rata; nilai ini termasuk dalam akun persediaan. Laporan penjualan outlet yang belum ditagih: ${pend.n}.`], tables: [{ columns: ['Outlet', 'SKU', 'Produk', 'Sisa titipan', 'Nilai (harga pokok)'], align: [L, L, L, R, R], rows: consignRows, total: consignRows.length ? ['Jumlah', null, null, null, sum(consignRows, 4)] : undefined }] },
        { key: 'fmcg-canvass', number: 'M7', title: 'Setoran tagihan kanvas per sales', paragraphs: ['Uang tagihan di tangan sales baru menjadi pelunasan setelah Keuangan menerima. "Belum diverifikasi" adalah uang yang masih ditahan sales.'], tables: [{ columns: ['Sales', 'Setoran', 'Dicatat sales', 'Diterima', 'Kurang setor', 'Belum diverifikasi', 'Ditolak'], align: [L, R, R, R, R, R, R], rows: canvassRows, total: canvassRows.length ? ['Jumlah', sum(canvassRows, 1), sum(canvassRows, 2), sum(canvassRows, 3), sum(canvassRows, 4), sum(canvassRows, 5), sum(canvassRows, 6)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Manufaktur
  private async mfg(tenantId: string, from: string, to: string) {
    const done = await this.rows<{ number: string; parent: string | null; sku: string; name: string; d: string; batches: string; planned: string; out: string; mat: string; labor: string; oh: string; tot: string }>(sql`
      SELECT o.number, po.number AS parent, p.sku, p.name, o.completed_date::text AS d, o.batches::text AS batches, o.planned_qty::text AS planned, o.output_qty::text AS out,
        o.material_cost::text AS mat, o.labor_cost::text AS labor, o.overhead_cost::text AS oh, o.total_cost::text AS tot
      FROM production_orders o JOIN products p ON p.id = o.product_id LEFT JOIN production_orders po ON po.id = o.parent_order_id
      WHERE o.tenant_id = ${tenantId} AND o.status = 'COMPLETED' AND o.completed_date BETWEEN ${from} AND ${to} ORDER BY o.completed_date, o.number LIMIT ${CAP}`);
    const doneRows: Cell[][] = done.map((r) => [r.number, r.parent ?? '-', r.sku, r.name, r.d, num(r.planned), num(r.out), num(r.planned) ? num((num(r.out) / num(r.planned)) * 100) : null, num(r.mat), num(r.labor), num(r.oh), num(r.tot), num(r.out) ? num(num(r.tot) / num(r.out)) : 0]);
    const usage = await this.rows<{ sku: string; name: string; planned: string; issued: string; planned_v: string; issued_v: string }>(sql`
      SELECT p.sku, p.name, SUM(l.planned_qty)::text AS planned, SUM(l.issued_qty)::text AS issued,
        SUM(l.planned_qty * l.unit_cost)::text AS planned_v, SUM(l.value)::text AS issued_v
      FROM production_order_lines l JOIN production_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
      WHERE o.tenant_id = ${tenantId} AND o.status IN ('IN_PROGRESS', 'COMPLETED') AND o.started_date BETWEEN ${from} AND ${to}
      GROUP BY p.id, p.sku, p.name ORDER BY SUM(l.value - l.planned_qty * l.unit_cost) DESC LIMIT ${CAP}`);
    const usageRows: Cell[][] = usage.map((r) => [r.sku, r.name, num(r.planned), num(r.issued), num(r.issued) - num(r.planned), num(r.issued_v) - num(r.planned_v)]);
    const wip = await this.rows<{ number: string; name: string; started: string; age: number; mat: string }>(sql`
      SELECT o.number, p.name, o.started_date::text AS started, (${to}::date - o.started_date)::int AS age, o.material_cost::text AS mat
      FROM production_orders o JOIN products p ON p.id = o.product_id
      WHERE o.tenant_id = ${tenantId} AND o.started_date IS NOT NULL AND o.started_date <= ${to}
        AND (o.completed_date IS NULL OR o.completed_date > ${to}) AND (o.cancelled_date IS NULL OR o.cancelled_date > ${to}) ORDER BY o.started_date LIMIT ${CAP}`);
    const wipRows: Cell[][] = wip.map((r) => [r.number, r.name, r.started, r.age, num(r.mat)]);

    const [c] = await this.rows<{ start_doc: string; start_gl: string; done_doc: string; done_gl: string; wip_doc: string; applied: string; actual: string }>(sql`
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
    const wipGl = await this.glBalance(tenantId, to, sql`a.system_key = 'WIP'`);

    return {
      title: 'Laporan Pendukung Produksi',
      summary: 'Hasil produksi dan biaya per perintah, pemakaian bahan dibanding resep, barang dalam proses, dan biaya konversi, dicocokkan dengan buku besar.',
      reconciliation: [
        this.recon('mfg-start', 'Bahan masuk produksi vs barang dalam proses', { label: 'Nilai bahan dikeluarkan pada periode', value: Number(c.start_doc) }, { label: 'Debit Barang Dalam Proses pada jurnal mulai produksi', value: Number(c.start_gl) }),
        this.recon('mfg-done', 'Hasil produksi vs jurnal selesai', { label: 'Biaya produksi perintah selesai pada periode', value: Number(c.done_doc) }, { label: 'Kredit BDP dan biaya konversi dibebankan pada jurnal selesai', value: Number(c.done_gl) }, 'Selisih kecil dapat berasal dari pembulatan nilai stok hasil produksi.'),
        this.recon('mfg-wip', 'Perintah berjalan vs saldo barang dalam proses', { label: 'Bahan pada perintah yang belum selesai/batal per tanggal akhir', value: Number(c.wip_doc) }, { label: 'Saldo akun Barang Dalam Proses', value: wipGl }, 'Selisih berarti ada jurnal manual ke akun BDP atau perintah dihapus.'),
        this.recon('mfg-conversion', 'Biaya konversi dibebankan vs aktual', { label: 'Upah + overhead dibebankan ke hasil produksi', value: Number(c.applied) }, { label: 'Upah langsung + overhead pabrik aktual (buku besar)', value: Number(c.actual) }, 'Selisih adalah selisih biaya produksi (kurang/lebih dibebankan), bukan kesalahan pembukuan; analisis di menu Analisis selisih.'),
      ],
      sections: [
        { key: 'mfg-done', number: 'M1', title: 'Perintah produksi selesai', paragraphs: ['Rendemen = hasil ÷ rencana. Biaya/unit = total biaya ÷ hasil. Kolom Induk terisi bila perintah ini membuat barang setengah jadi bagi perintah tingkat atas; nilainya sudah termasuk dalam biaya perintah induk.'], tables: [{ columns: ['Nomor', 'Induk', 'SKU', 'Produk', 'Selesai', 'Rencana', 'Hasil', 'Rendemen %', 'Bahan', 'Upah', 'Overhead', 'Total', 'Biaya/unit'], align: [L, L, L, L, L, R, R, R, R, R, R, R, R], rows: doneRows, total: doneRows.length ? ['Jumlah', null, null, null, null, sum(doneRows, 5), sum(doneRows, 6), null, sum(doneRows, 8), sum(doneRows, 9), sum(doneRows, 10), sum(doneRows, 11), null] : undefined }] },
        { key: 'mfg-usage', number: 'M2', title: 'Pemakaian bahan vs resep', paragraphs: ['Perintah yang dimulai pada periode. Selisih positif = bahan terpakai lebih banyak dari resep. Nilai selisih = nilai keluar − kebutuhan resep pada harga yang sama.'], tables: [{ columns: ['SKU', 'Bahan', 'Menurut resep', 'Dikeluarkan', 'Selisih jumlah', 'Selisih nilai'], align: [L, L, R, R, R, R], rows: usageRows, total: usageRows.length ? ['Jumlah', null, null, null, null, sum(usageRows, 5)] : undefined }] },
        { key: 'mfg-wip', number: 'M3', title: 'Barang dalam proses per tanggal akhir', paragraphs: ['Perintah yang sudah mengeluarkan bahan tetapi belum selesai atau dibatalkan. Umur panjang menandakan produksi macet atau lupa diselesaikan.'], tables: [{ columns: ['Nomor', 'Produk', 'Mulai', 'Umur (hari)', 'Nilai bahan'], align: [L, L, L, R, R], rows: wipRows, total: wipRows.length ? ['Jumlah', null, null, null, sum(wipRows, 4)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Jasa
  private async jasa(tenantId: string, from: string, to: string) {
    const projects = await this.rows<{ code: string; name: string; customer: string; contract: string; status: string; pct: string | null; earned: string | null; accrual: string | null; billed: string }>(sql`
      SELECT p.code, p.name, c.name AS customer, p.contract_value::text AS contract, p.status, g.percent::text AS pct, g.earned::text AS earned, g.accrual_after::text AS accrual,
        COALESCE((SELECT SUM(i.subtotal) FROM invoices i WHERE i.project_id = p.id AND i.tenant_id = ${tenantId} AND i.date <= ${to}), 0)::text AS billed
      FROM projects p JOIN customers c ON c.id = p.customer_id
      LEFT JOIN LATERAL (SELECT percent, earned, accrual_after FROM project_progress WHERE project_id = p.id AND date <= ${to} ORDER BY date DESC, number DESC LIMIT ${CAP}) g ON TRUE
      WHERE p.tenant_id = ${tenantId} AND (p.status = 'ACTIVE' OR g.percent IS NOT NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = p.id AND i.date BETWEEN ${from} AND ${to}))
      ORDER BY p.code LIMIT ${CAP}`);
    const STATUS: Record<string, string> = { ACTIVE: 'Berjalan', DONE: 'Selesai', CANCELLED: 'Batal' };
    const projectRows: Cell[][] = projects.map((r) => [r.code, r.name, r.customer, num(r.contract), r.pct === null ? null : num(r.pct), r.earned === null ? null : num(r.earned), num(r.billed), num(r.contract) - num(r.billed), r.accrual === null ? null : num(r.accrual), STATUS[r.status] ?? r.status]);
    const invoices = await this.rows<{ number: string; d: string; customer: string; project: string | null; sub: string; tax: string; tot: string; status: string }>(sql`
      SELECT i.number, i.date::text AS d, c.name AS customer, p.code AS project, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.tenant_id = ${tenantId} AND i.project_id IS NOT NULL AND i.date BETWEEN ${from} AND ${to} ORDER BY i.date, i.number LIMIT ${CAP}`);
    const invoiceRows: Cell[][] = invoices.map((r) => [r.number, r.d, r.customer, r.project, num(r.sub), num(r.tax), num(r.tot), r.status === 'PAID' ? 'Lunas' : r.status === 'PARTIAL' ? 'Sebagian' : 'Belum bayar']);
    const deposits = await this.rows<{ number: string; d: string; customer: string; project: string | null; dpp: string; tax: string; applied: string }>(sql`
      SELECT d.number, d.date::text AS d, c.name AS customer, p.code AS project, d.dpp::text AS dpp, d.tax_amount::text AS tax,
        COALESCE((SELECT SUM(a.dpp) FROM deposit_applications a WHERE a.deposit_id = d.id AND a.date <= ${to}), 0)::text AS applied
      FROM customer_deposits d JOIN customers c ON c.id = d.customer_id LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.tenant_id = ${tenantId} AND d.date <= ${to} ORDER BY d.date, d.number LIMIT ${CAP}`);
    const depositRows: Cell[][] = deposits.filter((r) => num(r.dpp) - num(r.applied) !== 0 || r.d >= from).map((r) => [r.number, r.d, r.customer, r.project, num(r.dpp), num(r.tax), num(r.applied), num(r.dpp) - num(r.applied)]);

    const work = await this.rows<{ name: string; unit: string; n: number; qty: string; pending: string; approved: string; paid: string }>(sql`
      SELECT e.name, w.unit, COUNT(*)::int AS n, SUM(w.quantity)::text AS qty,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'PENDING'), 0)::text AS pending,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'APPROVED' AND w.run_id IS NULL), 0)::text AS approved,
        COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'APPROVED' AND w.run_id IS NOT NULL), 0)::text AS paid
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${tenantId} AND w.work_date BETWEEN ${from} AND ${to} AND w.status IN ('PENDING', 'APPROVED')
      GROUP BY e.id, e.name, w.unit ORDER BY e.name, w.unit LIMIT ${CAP}`);
    const UNIT: Record<string, string> = { HOUR: 'Jam', SESSION: 'Sesi', JOB: 'Pekerjaan', PERCENT: 'Komisi (%)', SHIFT: 'Shift', PIECE: 'Per hasil' };
    const workRows: Cell[][] = work.map((r) => [r.name, UNIT[r.unit] ?? r.unit, r.n, num(r.qty), num(r.pending), num(r.approved), num(r.paid), num(r.pending) + num(r.approved) + num(r.paid)]);

    const [c] = await this.rows<{ contract: string; dep: string }>(sql`
      SELECT (SELECT COALESCE(SUM(g.accrual_after), 0) FROM projects p
              JOIN LATERAL (SELECT accrual_after FROM project_progress WHERE project_id = p.id AND date <= ${to} ORDER BY date DESC, number DESC LIMIT ${CAP}) g ON TRUE
              WHERE p.tenant_id = ${tenantId})::text AS contract,
             ((SELECT COALESCE(SUM(dpp), 0) FROM customer_deposits WHERE tenant_id = ${tenantId} AND date <= ${to})
              - (SELECT COALESCE(SUM(dpp), 0) FROM deposit_applications WHERE tenant_id = ${tenantId} AND date <= ${to}))::text AS dep`);
    const glContract = (await this.glBalance(tenantId, to, sql`a.system_key = 'UNBILLED_REVENUE'`)) + (await this.glBalance(tenantId, to, sql`a.system_key = 'CONTRACT_LIABILITY'`));
    const glDep = -(await this.glBalance(tenantId, to, sql`a.system_key = 'CUSTOMER_DEPOSIT'`));
    const [rev] = await this.rows<{ doc: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(subtotal), 0) FROM invoices WHERE tenant_id = ${tenantId} AND project_id IS NOT NULL AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL)::text AS doc,
             (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
              WHERE a.type = 'REVENUE' AND l.journal_id IN (SELECT journal_id FROM invoices WHERE tenant_id = ${tenantId} AND project_id IS NOT NULL AND date BETWEEN ${from} AND ${to} AND journal_id IS NOT NULL))::text AS gl`);

    return {
      title: 'Laporan Pendukung Jasa & Proyek',
      summary: 'Proyek dan termin, kemajuan pekerjaan, serta uang muka pelanggan, dicocokkan dengan pendapatan, aset/liabilitas kontrak, dan uang muka di buku besar.',
      reconciliation: [
        this.recon('jasa-revenue', 'Faktur proyek vs akun pendapatan', { label: 'Faktur proyek pada periode (DPP)', value: Number(rev.doc) }, { label: 'Akun pendapatan pada jurnal faktur tersebut', value: Number(rev.gl) }, 'Faktur yang melunasi uang muka dapat memuat pembalikan uang muka sehingga berbeda dari pendapatan.'),
        this.recon('jasa-contract', 'Kemajuan pekerjaan vs aset/liabilitas kontrak', { label: 'Aset (+) / liabilitas (−) kontrak dari catatan kemajuan terakhir', value: Number(c.contract) }, { label: 'Pendapatan Belum Ditagih − Pendapatan Diterima Dimuka di buku besar', value: glContract }),
        this.recon('jasa-deposit', 'Uang muka pelanggan vs saldo uang muka', { label: 'Uang muka diterima − dipakai (DPP)', value: Number(c.dep) }, { label: 'Saldo akun Uang Muka Pelanggan', value: glDep }),
      ],
      sections: [
        { key: 'jasa-project', number: 'J1', title: 'Proyek: kontrak, kemajuan, dan tagihan', paragraphs: ['Pendapatan diakui = nilai kontrak × % selesai (catatan kemajuan terakhir). Aset kontrak positif = pekerjaan lebih cepat dari tagihan; negatif = tagihan lebih cepat dari pekerjaan.'], tables: [{ columns: ['Kode', 'Proyek', 'Pelanggan', 'Kontrak', '% selesai', 'Pendapatan diakui', 'Ditagih (DPP)', 'Sisa kontrak', 'Aset/(liab.) kontrak', 'Status'], align: [L, L, L, R, R, R, R, R, R, L], rows: projectRows, total: projectRows.length ? ['Jumlah', null, null, sum(projectRows, 3), null, sum(projectRows, 5), sum(projectRows, 6), sum(projectRows, 7), sum(projectRows, 8), null] : undefined }] },
        { key: 'jasa-invoice', number: 'J2', title: 'Faktur termin dan jasa proyek', paragraphs: [], tables: [{ columns: ['Nomor', 'Tanggal', 'Pelanggan', 'Proyek', 'DPP', 'PPN', 'Total', 'Status'], align: [L, L, L, L, R, R, R, L], rows: invoiceRows, total: invoiceRows.length ? ['Jumlah', null, null, null, sum(invoiceRows, 4), sum(invoiceRows, 5), sum(invoiceRows, 6), null] : undefined }] },
        { key: 'jasa-deposit', number: 'J3', title: 'Uang muka pelanggan', paragraphs: ['Sisa uang muka adalah kewajiban ke pelanggan sampai dipakai melunasi faktur.'], tables: [{ columns: ['Nomor', 'Tanggal', 'Pelanggan', 'Proyek', 'DPP', 'PPN', 'Dipakai', 'Sisa'], align: [L, L, L, L, R, R, R, R], rows: depositRows, total: depositRows.length ? ['Jumlah', null, null, null, sum(depositRows, 4), sum(depositRows, 5), sum(depositRows, 6), sum(depositRows, 7)] : undefined }] },
        { key: 'jasa-work', number: 'J4', title: 'Jam kerja dan upah jasa', paragraphs: ['Catatan pekerjaan pada periode: menunggu persetujuan, disetujui belum masuk penggajian, dan sudah masuk penggajian. Upah dibayar lewat penggajian (Upah jasa); jurnalnya dilaporkan pada laporan penggajian, bukan di sini.'], tables: [{ columns: ['Karyawan', 'Satuan', 'Catatan', 'Jumlah satuan', 'Menunggu persetujuan', 'Disetujui belum digaji', 'Sudah digaji', 'Total'], align: [L, L, R, R, R, R, R, R], rows: workRows, total: workRows.length ? ['Jumlah', null, sum(workRows, 2), null, sum(workRows, 4), sum(workRows, 5), sum(workRows, 6), sum(workRows, 7)] : undefined }] },
      ],
    };
  }

  // ------------------------------------------------------------------ Utilitas
  private async utility(tenantId: string, from: string, to: string) {
    const p1 = from.slice(0, 7);
    const p2 = to.slice(0, 7);
    const periods = await this.rows<{ period: string; n: number; verified: number; billed: number; rejected: number; flagged: number; usage: string }>(sql`
      SELECT period, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'VERIFIED')::int AS verified, COUNT(*) FILTER (WHERE status = 'BILLED')::int AS billed,
        COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected, COUNT(*) FILTER (WHERE cardinality(flags) > 0)::int AS flagged,
        COALESCE(SUM(usage) FILTER (WHERE status = 'BILLED'), 0)::text AS usage
      FROM utility_readings WHERE tenant_id = ${tenantId} AND period BETWEEN ${p1} AND ${p2} GROUP BY period ORDER BY period`);
    const periodRows: Cell[][] = periods.map((r) => [r.period, r.n, r.verified, r.billed, r.rejected, r.flagged, num(r.usage)]);
    const bills = await this.rows<{ period: string; n: number; usage: string; sub: string; late: string; tot: string; paid: string }>(sql`
      SELECT b.period, COUNT(*)::int AS n, COALESCE(SUM(b.usage), 0)::text AS usage, COALESCE(SUM(i.subtotal), 0)::text AS sub, COALESCE(SUM(b.late_fee), 0)::text AS late,
        COALESCE(SUM(i.total), 0)::text AS tot, COALESCE(SUM(i.paid_amount), 0)::text AS paid
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} GROUP BY b.period ORDER BY b.period`);
    const billRows: Cell[][] = bills.map((r) => [r.period, r.n, num(r.usage), num(r.sub), num(r.late), num(r.tot), num(r.paid), num(r.tot) - num(r.paid)]);
    const arrears = await this.rows<{ conn: string; customer: string; period: string; due: string; tot: string; open: string; age: number }>(sql`
      SELECT c.number AS conn, cu.name AS customer, b.period, i.due_date::text AS due, i.total::text AS tot, (i.total - i.paid_amount - i.returned_amount)::text AS open, (${to}::date - i.due_date)::int AS age
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.date <= ${to} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < ${to} ORDER BY i.due_date LIMIT ${CAP}`);
    const arrearRows: Cell[][] = arrears.map((r) => [r.conn, r.customer, r.period, r.due, r.age, num(r.tot), num(r.open)]);
    const conns = await this.rows<{ tariff: string; active: number; suspended: number; off: number }>(sql`
      SELECT t.name AS tariff, COUNT(*) FILTER (WHERE c.status = 'ACTIVE')::int AS active, COUNT(*) FILTER (WHERE c.status = 'SUSPENDED')::int AS suspended,
        COUNT(*) FILTER (WHERE c.status = 'DISCONNECTED')::int AS off
      FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.installed_at <= ${to} GROUP BY t.name ORDER BY t.name`);
    const connRows: Cell[][] = conns.map((r) => [r.tariff, r.active, r.suspended, r.off]);

    const [c] = await this.rows<{ read_usage: string; bill_usage: string; sub: string; rev: string; late: string; late_gl: string }>(sql`
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

    const arOpen = await this.rows<{ util: string; other: string }>(sql`
      SELECT COALESCE(SUM(x.open) FILTER (WHERE x.util), 0)::text AS util, COALESCE(SUM(x.open) FILTER (WHERE NOT x.util), 0)::text AS other FROM (
        SELECT i.total
          - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= ${to}), 0)
          - COALESCE((SELECT SUM(r.total) FROM sales_returns r WHERE r.invoice_id = i.id AND r.date <= ${to}), 0) AS open,
          EXISTS (SELECT 1 FROM utility_bills b WHERE b.invoice_id = i.id) AS util
        FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to}) x`);
    const arGl = await this.glBalance(tenantId, to, sql`a.system_key = 'AR'`);
    const arRows: Cell[][] = [['Tagihan utilitas', num(arOpen[0].util)], ['Faktur penjualan lain', num(arOpen[0].other)]];

    return {
      title: 'Laporan Pendukung Utilitas',
      summary: 'Pencatatan meter, tagihan pelanggan, denda, tunggakan, dan sambungan, dicocokkan dengan pendapatan di buku besar.',
      reconciliation: [
        this.recon('util-revenue', 'Tagihan pelanggan vs akun pendapatan', { label: 'Faktur tagihan utilitas pada periode (DPP)', value: Number(c.sub) }, { label: 'Akun pendapatan pada jurnal faktur tersebut', value: Number(c.rev) }, 'Selisih berarti jurnal tagihan diubah di luar dokumen.'),
        this.recon('util-usage', 'Pemakaian meter vs pemakaian ditagih', { label: 'Pemakaian pada catatan meter yang ditagih', value: Number(c.read_usage) }, { label: 'Pemakaian pada tagihan', value: Number(c.bill_usage) }, 'Pencatatan meter dan tagihan harus sama; selisih menunjukkan tagihan yang tidak berasal dari catatan meter terverifikasi.'),
        this.recon('util-ar', 'Piutang usaha: sisa faktur vs saldo piutang usaha', { label: 'Sisa tagihan semua faktur (rupiah)', value: Number(arOpen[0].util) + Number(arOpen[0].other) }, { label: 'Saldo akun Piutang Usaha di buku besar', value: arGl }, 'Akun piutang usaha hanya berisi piutang dari faktur; piutang lain (karyawan, klaim, dan sebagainya) ada di Akuntansi › Laporan akun lainnya.'),
        this.recon('util-late', 'Denda ditagih vs akun pendapatan denda', { label: 'Denda pada tagihan', value: Number(c.late) }, { label: 'Akun Pendapatan Denda pada jurnal tagihan', value: Number(c.late_gl) }),
      ],
      sections: [
        { key: 'util-readings', number: 'U1', title: 'Pencatatan meter per periode', paragraphs: ['"Ditandai" = catatan dengan tanda lonjakan, meter diganti, atau janggal lain yang wajib diperiksa.'], tables: [{ columns: ['Periode', 'Dicatat', 'Terverifikasi', 'Ditagih', 'Ditolak', 'Ditandai', 'Pemakaian ditagih'], align: [L, R, R, R, R, R, R], rows: periodRows, total: periodRows.length ? ['Jumlah', sum(periodRows, 1), sum(periodRows, 2), sum(periodRows, 3), sum(periodRows, 4), sum(periodRows, 5), sum(periodRows, 6)] : undefined }] },
        { key: 'util-bills', number: 'U2', title: 'Tagihan per periode', paragraphs: ['Faktur yang terbit pada rentang laporan, dikelompokkan menurut periode tagihan.'], tables: [{ columns: ['Periode', 'Tagihan', 'Pemakaian', 'Subtotal (DPP)', 'Denda', 'Total', 'Dibayar', 'Sisa'], align: [L, R, R, R, R, R, R, R], rows: billRows, total: billRows.length ? ['Jumlah', sum(billRows, 1), sum(billRows, 2), sum(billRows, 3), sum(billRows, 4), sum(billRows, 5), sum(billRows, 6), sum(billRows, 7)] : undefined }] },
        { key: 'util-arrears', number: 'U3', title: 'Tunggakan per tanggal akhir', paragraphs: ['Tagihan yang lewat jatuh tempo dan belum lunas.'], tables: [{ columns: ['Sambungan', 'Pelanggan', 'Periode', 'Jatuh tempo', 'Terlambat (hari)', 'Total', 'Sisa'], align: [L, L, L, L, R, R, R], rows: arrearRows, total: arrearRows.length ? ['Jumlah', null, null, null, null, sum(arrearRows, 5), sum(arrearRows, 6)] : undefined }] },
        { key: 'util-ar', number: 'U4', title: 'Piutang usaha per tanggal akhir', paragraphs: ['Sisa tagihan faktur dipisahkan antara tagihan utilitas dan faktur penjualan lain. Piutang non-faktur tidak termasuk di sini.'], tables: [{ columns: ['Sumber', 'Sisa tagihan'], align: [L, R], rows: arRows, total: ['Jumlah', sum(arRows, 1)] }] },
        { key: 'util-connections', number: 'U5', title: 'Sambungan per tarif', paragraphs: [], tables: [{ columns: ['Tarif', 'Aktif', 'Ditangguhkan', 'Diputus'], align: [L, R, R, R], rows: connRows, total: connRows.length ? ['Jumlah', sum(connRows, 1), sum(connRows, 2), sum(connRows, 3)] : undefined }] },
      ],
    };
  }
}
