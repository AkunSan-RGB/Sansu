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
export const SUPPORT_KINDS = ['sales', 'purchases', 'inventory', 'cash', 'other', 'pos', 'fnb'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

const L = 'left' as const;
const R = 'right' as const;
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const sum = (rows: Cell[][], i: number) => rows.reduce((a, r) => a + Number(r[i] ?? 0), 0);
const TOLERANCE = 1;

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
    return { kind, ...out, period: { from, to }, generatedAt: new Date().toISOString(), today: todayJakarta() };
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
      WHERE c.tenant_id = ${tenantId} GROUP BY c.id, c.name ORDER BY SUM(i.subtotal) DESC LIMIT 100`);
    const customerRows: Cell[][] = byCustomer.map((r) => [r.name, r.n, num(r.sub), num(r.rsub), num(r.sub) - num(r.rsub)]);
    const byProduct = await this.rows<{ sku: string; name: string; qty: string; sales: string }>(sql`
      SELECT p.sku, p.name, SUM(il.qty * il.uom_factor)::text AS qty, SUM(il.line_total)::text AS sales
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening
      GROUP BY p.id, p.sku, p.name ORDER BY SUM(il.line_total) DESC LIMIT 100`);
    const productRows: Cell[][] = byProduct.map((r) => [r.sku, r.name, num(r.qty), num(r.sales), num(r.qty) ? num(num(r.sales) / num(r.qty)) : 0]);
    const list = await this.rows<{ number: string; d: string; customer: string; sub: string; tax: string; tot: string; status: string }>(sql`
      SELECT i.number, i.date::text AS d, c.name AS customer, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} AND NOT i.is_opening ORDER BY i.date, i.number LIMIT 500`);
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
      FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to} AND i.currency = 'IDR'`);
    const arGl = await this.glBalance(tenantId, to, sql`a.system_key = 'AR'`);

    const totRow = (rows: Cell[][], idx: number[]) => ['Jumlah', ...rows[0]?.slice(1).map((_, k) => (idx.includes(k + 1) ? sum(rows, k + 1) : null)) ?? []];
    return {
      title: 'Laporan Pendukung Penjualan',
      summary: 'Rincian penjualan dari faktur dan retur, dicocokkan dengan akun pendapatan dan piutang usaha di buku besar.',
      reconciliation: [
        this.recon('sales-revenue', 'Penjualan neto vs akun pendapatan', { label: 'Faktur − retur (dokumen)', value: Number(docs.sub) - Number(docs.rsub) }, { label: 'Akun pendapatan pada jurnal faktur & retur', value: Number(gl.v) }, 'Selisih berarti jurnal faktur/retur diubah di luar dokumen atau ada pendapatan non-faktur pada jurnal yang sama.'),
        this.recon('sales-ar', 'Sisa tagihan faktur vs saldo piutang usaha', { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ar.v) }, { label: 'Saldo akun Piutang Usaha di buku besar', value: arGl }, 'Selisih biasanya dari jurnal manual ke akun piutang, faktur valas, atau piutang tanpa faktur.'),
      ],
      sections: [
        { key: 'sales-monthly', number: 'P1', title: 'Rekap penjualan per bulan', paragraphs: ['Penjualan (DPP) menurut faktur, dikurangi retur; HPP dari faktur barang. Tidak termasuk saldo awal.'], tables: [{ columns: ['Bulan', 'Faktur', 'Penjualan (DPP)', 'PPN keluaran', 'Retur (DPP)', 'Penjualan neto', 'HPP', 'Laba kotor'], align: [L, R, R, R, R, R, R, R], rows: monthRows, total: monthRows.length ? ['Jumlah', sum(monthRows, 1), sum(monthRows, 2), sum(monthRows, 3), sum(monthRows, 4), sum(monthRows, 5), sum(monthRows, 6), sum(monthRows, 7)] : undefined }] },
        { key: 'sales-customer', number: 'P2', title: 'Penjualan per pelanggan (100 terbesar)', paragraphs: [], tables: [{ columns: ['Pelanggan', 'Faktur', 'Penjualan (DPP)', 'Retur (DPP)', 'Neto'], align: [L, R, R, R, R], rows: customerRows, total: customerRows.length ? totRow(customerRows, [1, 2, 3, 4]) : undefined }] },
        { key: 'sales-product', number: 'P3', title: 'Penjualan per produk (100 terbesar)', paragraphs: ['Jumlah dalam satuan dasar.'], tables: [{ columns: ['SKU', 'Produk', 'Jumlah', 'Penjualan', 'Harga rata-rata'], align: [L, L, R, R, R], rows: productRows, total: productRows.length ? ['Jumlah', null, sum(productRows, 2), sum(productRows, 3), null] : undefined }] },
        { key: 'sales-list', number: 'P4', title: 'Daftar faktur penjualan', paragraphs: list.length >= 500 ? ['Menampilkan 500 faktur pertama pada periode ini.'] : [], tables: [{ columns: ['Nomor', 'Tanggal', 'Pelanggan', 'DPP', 'PPN', 'Total', 'Status'], align: [L, L, L, R, R, R, L], rows: listRows, total: listRows.length ? ['Jumlah', null, null, sum(listRows, 3), sum(listRows, 4), sum(listRows, 5), null] : undefined }] },
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
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} GROUP BY s.id, s.name ORDER BY SUM(i.subtotal) DESC LIMIT 100`);
    const supplierRows: Cell[][] = bySupplier.map((r) => [r.name, r.n, num(r.sub), num(r.tax), num(r.tot)]);
    const list = await this.rows<{ number: string; no: string; d: string; supplier: string; kind: string; sub: string; tax: string; tot: string; status: string }>(sql`
      SELECT i.number, i.supplier_invoice_no AS no, i.date::text AS d, s.name AS supplier, i.kind, i.subtotal::text AS sub, i.tax_amount::text AS tax, i.total::text AS tot, i.status::text AS status
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to} ORDER BY i.date, i.number LIMIT 500`);
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
      FROM purchase_invoices i WHERE i.tenant_id = ${tenantId} AND i.date <= ${to} AND i.currency = 'IDR'`);
    const apGl = -(await this.glBalance(tenantId, to, sql`a.system_key = 'AP'`));
    return {
      title: 'Laporan Pendukung Pembelian',
      summary: 'Rincian pembelian dari faktur pemasok dan retur, dicocokkan dengan akun utang usaha di buku besar.',
      reconciliation: [
        this.recon('purchases-ap-credit', 'Faktur pembelian vs kredit utang usaha', { label: 'Total faktur pemasok (dokumen)', value: Number(docs.tot) }, { label: 'Kredit akun Utang Usaha pada jurnal faktur', value: Number(gl.v) }, 'Selisih berarti jurnal faktur diubah di luar dokumen.'),
        this.recon('purchases-ap-balance', 'Sisa tagihan pemasok vs saldo utang usaha', { label: 'Sisa tagihan per faktur (rupiah)', value: Number(ap.v) }, { label: 'Saldo akun Utang Usaha di buku besar', value: apGl }, 'Selisih biasanya dari jurnal manual ke akun utang, faktur valas, atau utang tanpa faktur.'),
      ],
      sections: [
        { key: 'purchases-monthly', number: 'P1', title: 'Rekap pembelian per bulan', paragraphs: ['Menurut faktur pemasok pada periode, dikurangi retur pembelian.'], tables: [{ columns: ['Bulan', 'Faktur', 'Pembelian (DPP)', 'PPN masukan', 'PPh dipotong', 'Total dibayar', 'Retur (DPP)', 'Pembelian neto'], align: [L, R, R, R, R, R, R, R], rows: monthRows, total: monthRows.length ? ['Jumlah', sum(monthRows, 1), sum(monthRows, 2), sum(monthRows, 3), sum(monthRows, 4), sum(monthRows, 5), sum(monthRows, 6), sum(monthRows, 7)] : undefined }] },
        { key: 'purchases-supplier', number: 'P2', title: 'Pembelian per pemasok (100 terbesar)', paragraphs: [], tables: [{ columns: ['Pemasok', 'Faktur', 'DPP', 'PPN', 'Total'], align: [L, R, R, R, R], rows: supplierRows, total: supplierRows.length ? ['Jumlah', sum(supplierRows, 1), sum(supplierRows, 2), sum(supplierRows, 3), sum(supplierRows, 4)] : undefined }] },
        { key: 'purchases-list', number: 'P3', title: 'Daftar faktur pembelian', paragraphs: list.length >= 500 ? ['Menampilkan 500 faktur pertama pada periode ini.'] : [], tables: [{ columns: ['Nomor', 'No. faktur pemasok', 'Tanggal', 'Pemasok', 'Jenis', 'DPP', 'PPN', 'Total', 'Status'], align: [L, L, L, L, L, R, R, R, L], rows: listRows, total: listRows.length ? ['Jumlah', null, null, null, null, sum(listRows, 5), sum(listRows, 6), sum(listRows, 7), null] : undefined }] },
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
    const acc = await this.rows<{ code: string; name: string; type: string; sk: string | null; cash: boolean; o: string; dr: string; cr: string; c: string }>(sql`
      SELECT a.code, a.name, a.type::text AS type, a.system_key AS sk, a.is_cash_account AS cash,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date < ${from}), 0)::text AS o,
        COALESCE(SUM(l.debit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS dr,
        COALESCE(SUM(l.credit) FILTER (WHERE j.date BETWEEN ${from} AND ${to}), 0)::text AS cr,
        COALESCE(SUM(l.debit - l.credit) FILTER (WHERE j.date <= ${to}), 0)::text AS c
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries j ON j.id = l.journal_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} GROUP BY a.id, a.code, a.name, a.type, a.system_key, a.is_cash_account ORDER BY a.code`);
    const covered = (x: (typeof acc)[number]) => x.cash || ['AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI', 'SALES', 'SALES_RETURN', 'COGS'].includes(x.sk ?? '');
    const active = (x: (typeof acc)[number]) => Number(x.o) !== 0 || Number(x.dr) !== 0 || Number(x.cr) !== 0 || Number(x.c) !== 0;
    const groups: { key: string; title: string; types: string[]; credit: boolean }[] = [
      { key: 'other-assets', title: 'Aset lain', types: ['ASSET'], credit: false },
      { key: 'other-liabilities', title: 'Liabilitas', types: ['LIABILITY'], credit: true },
      { key: 'other-equity', title: 'Ekuitas', types: ['EQUITY'], credit: true },
      { key: 'other-revenue', title: 'Pendapatan lain', types: ['REVENUE'], credit: true },
      { key: 'other-expense', title: 'Beban', types: ['EXPENSE'], credit: false },
    ];
    const sections: SupportSection[] = groups.map((g, i) => {
      const list = acc.filter((x) => g.types.includes(x.type) && !covered(x) && active(x));
      const sign = g.credit ? -1 : 1;
      const rows: Cell[][] = list.map((x) => [x.code, x.name, num(sign * Number(x.o)), num(g.credit ? x.cr : x.dr), num(g.credit ? x.dr : x.cr), num(sign * Number(x.c))]);
      return {
        key: g.key,
        number: `P${i + 1}`,
        title: g.title,
        paragraphs: i === 0 ? ['Seluruh akun di luar kas/bank, piutang, utang usaha, persediaan, dan penjualan/HPP (yang punya laporan pendukung sendiri). Daftar aset tetap dan umur piutang/utang ada di Lampiran Laporan Keuangan.'] : [],
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
      ORDER BY s.opened_at LIMIT 300`);
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
      WHERE ${orderIn} GROUP BY p.id, p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT 100`);
    const menuRows: Cell[][] = menu.map((r) => [r.sku, r.name, num(r.qty), num(r.sales), r.recipe ? 'Ya' : 'Tidak']);
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
      FROM pos_platform_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND date BETWEEN ${from} AND ${to} ORDER BY date, number LIMIT 200`);
    const settleRows: Cell[][] = settlements.map((r) => [r.number, r.channel, r.d, r.n, num(r.expected), num(r.received), num(r.diff)]);

    // Bahan terpakai: seharusnya menurut resep aktif vs yang keluar dari kartu stok pada pesanan kasir
    const usage = await this.rows<{ sku: string; name: string; expected: string; actual: string }>(sql`
      WITH menu_qty AS (
        SELECT l.product_id, SUM(l.qty * l.uom_factor) AS q FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        WHERE ${orderIn} AND l.from_recipe GROUP BY l.product_id),
      bom AS (
        SELECT DISTINCT ON (b.product_id) b.id, b.product_id, b.output_qty FROM boms b
        WHERE b.tenant_id = ${tenantId} AND b.is_active AND b.product_id IN (SELECT product_id FROM menu_qty) ORDER BY b.product_id, b.created_at DESC),
      need AS (
        SELECT bl.product_id, SUM(m.q * bl.qty / NULLIF(bom.output_qty, 0)) AS expected
        FROM menu_qty m JOIN bom ON bom.product_id = m.product_id JOIN bom_lines bl ON bl.bom_id = bom.id GROUP BY bl.product_id),
      moved AS (
        SELECT sm.product_id, SUM(-sm.qty) AS q FROM stock_moves sm JOIN pos_orders o ON o.id::text = sm.ref_id
        WHERE sm.tenant_id = ${tenantId} AND sm.ref_type = 'POS_ORDER' AND ${orderIn} AND sm.product_id IN (SELECT product_id FROM need) GROUP BY sm.product_id),
      direct AS (
        SELECT l.product_id, SUM(l.qty * l.uom_factor) AS q FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
        WHERE ${orderIn} AND NOT l.from_recipe AND l.product_id IN (SELECT product_id FROM need) GROUP BY l.product_id)
      SELECT p.sku, p.name, need.expected::text AS expected, (COALESCE(moved.q, 0) - COALESCE(direct.q, 0))::text AS actual
      FROM need JOIN products p ON p.id = need.product_id LEFT JOIN moved ON moved.product_id = need.product_id LEFT JOIN direct ON direct.product_id = need.product_id
      ORDER BY p.name LIMIT 300`);
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
        this.recon('fnb-usage', 'Bahan sesuai resep', { label: 'Bahan yang dicek', value: usageRows.length }, { label: 'Bahan dengan pemakaian sama dengan resep', value: usageOk }, 'Dihitung dengan resep aktif saat ini. Selisih muncul bila resep diubah setelah penjualan, atau kartu stok bahan dikoreksi.'),
      ],
      sections: [
        { key: 'fnb-menu', number: 'F1', title: 'Penjualan per menu (100 terbesar)', paragraphs: ['Jumlah dalam satuan dasar. "Dari resep" berarti bahan menu dipotong sesuai resep saat dijual.'], tables: [{ columns: ['SKU', 'Menu', 'Jumlah', 'Penjualan', 'Dari resep'], align: [L, L, R, R, L], rows: menuRows, total: menuRows.length ? ['Jumlah', null, sum(menuRows, 2), sum(menuRows, 3), null] : undefined }] },
        { key: 'fnb-type', number: 'F2', title: 'Penjualan per jenis pesanan', paragraphs: [], tables: [{ columns: ['Jenis', 'Pesanan', 'DPP', 'Pajak', 'Total'], align: [L, R, R, R, R], rows: typeRows, total: typeRows.length ? ['Jumlah', sum(typeRows, 1), sum(typeRows, 2), sum(typeRows, 3), sum(typeRows, 4)] : undefined }] },
        { key: 'fnb-tax', number: 'F3', title: 'Pajak penjualan kasir', paragraphs: ['Pajak restoran daerah (PB1/PBJT) menggantikan PPN pada pesanan kasir bila dinyalakan di pengaturan.'], tables: [{ columns: ['Jenis pajak', 'Pesanan', 'DPP', 'Pajak', 'Retur', 'Pajak neto'], align: [L, R, R, R, R, R], rows: taxRows, total: taxRows.length ? ['Jumlah', sum(taxRows, 1), sum(taxRows, 2), sum(taxRows, 3), sum(taxRows, 4), sum(taxRows, 5)] : undefined }] },
        { key: 'fnb-platform', number: 'F4', title: 'Pesanan online dan pencairan platform', paragraphs: ['Piutang platform = total pesanan − komisi, hingga dicairkan. Selisih pencairan menunjukkan dana yang masuk berbeda dari seharusnya.'], tables: [{ title: 'Pesanan per kanal', columns: ['Kanal', 'Pesanan', 'Total', 'Komisi', 'Bersih', 'Sudah cair', 'Belum cair'], align: [L, R, R, R, R, R, R], rows: channelRows, total: channelRows.length ? ['Jumlah', sum(channelRows, 1), sum(channelRows, 2), sum(channelRows, 3), sum(channelRows, 4), sum(channelRows, 5), sum(channelRows, 6)] : undefined }, { title: 'Pencairan dalam periode', columns: ['Nomor', 'Kanal', 'Tanggal', 'Pesanan', 'Seharusnya', 'Diterima', 'Selisih'], align: [L, L, L, R, R, R, R], rows: settleRows, total: settleRows.length ? ['Jumlah', null, null, sum(settleRows, 3), sum(settleRows, 4), sum(settleRows, 5), sum(settleRows, 6)] : undefined }] },
        { key: 'fnb-usage', number: 'F5', title: 'Bahan terpakai vs resep', paragraphs: ['Seharusnya = jumlah menu terjual × kebutuhan bahan menurut resep aktif. Keluar = pengeluaran stok bahan dari pesanan kasir (tanpa penjualan langsung bahan itu). Satuan dasar bahan; retur kasir tidak dikurangkan.'], tables: [{ columns: ['SKU', 'Bahan', 'Seharusnya', 'Keluar', 'Selisih'], align: [L, L, R, R, R], rows: usageRows }] },
      ],
    };
  }
}
