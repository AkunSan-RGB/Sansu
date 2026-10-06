/**
 * Rincian dokumen asal sebuah jurnal, dalam bentuk seragam (kolom isian + tabel baris), untuk jenis dokumen yang belum punya
 * halaman rincian sendiri: faktur / pembayaran / retur pembelian, retur penjualan, mutasi stok, kas, kasir, pajak.
 */
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';

export interface DocField {
  label: string;
  value: string;
  /** Nilai rupiah: ditampilkan berformat uang */
  money?: boolean;
}
export interface DocTable {
  columns: { key: string; title: string; align?: 'right'; money?: boolean; qty?: boolean }[];
  rows: Record<string, string | null>[];
}
export interface SourceDocument {
  title: string;
  number: string | null;
  date: string | null;
  fields: DocField[];
  table: DocTable | null;
  related: { label: string; route: string }[];
}

type Row = Record<string, string | null>;
const q = async (db: Db, query: ReturnType<typeof sql>) => (await db.execute<Row>(query)).rows;
const one = async (db: Db, query: ReturnType<typeof sql>) => (await q(db, query))[0] ?? null;
const f = (label: string, value: string | null | undefined, money = false): DocField => ({ label, value: value ?? '-', money });

const MOVE_TITLE: Record<string, string> = {
  STOCK_ADJUSTMENT: 'Penyesuaian stok',
  STOCK_TRANSFER: 'Transfer antar gudang',
  PRODUCTION: 'Produksi',
  INVENTORY_WRITEDOWN: 'Penurunan nilai persediaan',
  DELIVERY: 'Surat jalan',
};

const stockTable = async (db: Db, tenantId: string, refId: string): Promise<DocTable> => ({
  columns: [
    { key: 'product', title: 'Barang' },
    { key: 'warehouse', title: 'Gudang' },
    { key: 'type', title: 'Jenis' },
    { key: 'qty', title: 'Jumlah', align: 'right', qty: true },
    { key: 'unit_cost', title: 'Harga pokok', align: 'right', money: true },
    { key: 'value', title: 'Nilai', align: 'right', money: true },
  ],
  rows: await q(db, sql`
    SELECT p.sku || ' · ' || p.name AS product, w.name AS warehouse, m.type, m.qty, m.unit_cost, (m.qty * m.unit_cost)::numeric(18,2)::text AS value
    FROM stock_moves m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
    WHERE m.tenant_id = ${tenantId} AND m.ref_id = ${refId} ORDER BY m.created_at, p.sku`),
});

/** Dokumen asal untuk jenis sumber tertentu; null bila jenis ini tidak punya dokumen terpisah */
export async function loadSourceDocument(db: Db, tenantId: string, sourceType: string, sourceId: string | null): Promise<SourceDocument | null> {
  if (!sourceId) return null;
  switch (sourceType) {
    case 'PURCHASE_INVOICE': {
      const d = await one(db, sql`
        SELECT i.number, i.date::text, i.due_date::text, i.supplier_invoice_no, s.name AS supplier, i.subtotal, i.tax_amount, i.total, i.paid_amount, i.returned_amount, i.status, i.description, po.number AS po_number, po.id AS po_id
        FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        WHERE i.tenant_id = ${tenantId} AND i.id = ${sourceId}`);
      if (!d) return null;
      return {
        title: 'Faktur pembelian',
        number: d.number,
        date: d.date,
        fields: [f('Pemasok', d.supplier), f('No. faktur pemasok', d.supplier_invoice_no), f('Jatuh tempo', d.due_date), f('Subtotal', d.subtotal, true), f('PPN masukan', d.tax_amount, true), f('Total', d.total, true), f('Dibayar', d.paid_amount, true), f('Diretur', d.returned_amount, true), f('Status', d.status), ...(d.po_number ? [f('Pesanan pembelian', d.po_number)] : [])],
        table: {
          columns: [{ key: 'item', title: 'Uraian' }, { key: 'qty', title: 'Jumlah', align: 'right', qty: true }, { key: 'price', title: 'Harga', align: 'right', money: true }, { key: 'total', title: 'Jumlah (Rp)', align: 'right', money: true }],
          rows: await q(db, sql`
            SELECT COALESCE(p.sku || ' · ' || p.name, l.description, a.name, '-') AS item, l.qty, l.price, l.line_total AS total
            FROM purchase_invoice_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN accounts a ON a.id = l.account_id
            WHERE l.invoice_id = ${sourceId} ORDER BY l.id`),
        },
        related: d.po_id ? [{ label: `Pesanan pembelian ${d.po_number}`, route: `/purchase-orders/${d.po_id}` }] : [],
      };
    }
    case 'SUPPLIER_PAYMENT': {
      const d = await one(db, sql`
        SELECT p.number, p.date::text, p.amount, p.notes, s.name AS supplier, i.number AS invoice_number, a.name AS account
        FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id JOIN purchase_invoices i ON i.id = p.purchase_invoice_id LEFT JOIN accounts a ON a.id = p.cash_account_id
        WHERE p.tenant_id = ${tenantId} AND p.id = ${sourceId}`);
      if (!d) return null;
      return { title: 'Pembayaran utang pemasok', number: d.number, date: d.date, fields: [f('Pemasok', d.supplier), f('Faktur dibayar', d.invoice_number), f('Jumlah', d.amount, true), f('Dibayar dari', d.account), f('Catatan', d.notes)], table: null, related: [] };
    }
    case 'PURCHASE_RETURN': {
      const d = await one(db, sql`
        SELECT r.number, r.date::text, r.subtotal, r.tax_amount, r.total, r.reason, s.name AS supplier, i.number AS invoice_number
        FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN purchase_invoices i ON i.id = r.purchase_invoice_id
        WHERE r.tenant_id = ${tenantId} AND r.id = ${sourceId}`);
      if (!d) return null;
      return {
        title: 'Retur pembelian', number: d.number, date: d.date,
        fields: [f('Pemasok', d.supplier), f('Atas faktur', d.invoice_number), f('Alasan', d.reason), f('Subtotal', d.subtotal, true), f('PPN', d.tax_amount, true), f('Total', d.total, true)],
        table: {
          columns: [{ key: 'item', title: 'Barang' }, { key: 'qty', title: 'Jumlah', align: 'right', qty: true }, { key: 'total', title: 'Nilai', align: 'right', money: true }],
          rows: await q(db, sql`SELECT p.sku || ' · ' || p.name AS item, l.qty, l.line_total AS total FROM purchase_return_lines l JOIN products p ON p.id = l.product_id WHERE l.return_id = ${sourceId}`),
        },
        related: [],
      };
    }
    case 'SALES_RETURN': {
      const d = await one(db, sql`
        SELECT r.number, r.date::text, r.subtotal, r.tax_amount, r.total, r.reason, c.name AS customer, i.number AS invoice_number, i.id AS invoice_id
        FROM sales_returns r JOIN customers c ON c.id = r.customer_id JOIN invoices i ON i.id = r.invoice_id
        WHERE r.tenant_id = ${tenantId} AND r.id = ${sourceId}`);
      if (!d) return null;
      return {
        title: 'Retur penjualan', number: d.number, date: d.date,
        fields: [f('Pelanggan', d.customer), f('Atas faktur', d.invoice_number), f('Alasan', d.reason), f('Subtotal', d.subtotal, true), f('PPN', d.tax_amount, true), f('Total', d.total, true)],
        table: {
          columns: [{ key: 'item', title: 'Barang' }, { key: 'qty', title: 'Jumlah', align: 'right', qty: true }, { key: 'total', title: 'Nilai', align: 'right', money: true }],
          rows: await q(db, sql`SELECT p.sku || ' · ' || p.name AS item, l.qty, l.line_total AS total FROM sales_return_lines l JOIN products p ON p.id = l.product_id WHERE l.return_id = ${sourceId}`),
        },
        related: [{ label: `Faktur ${d.invoice_number}`, route: `/invoices/${d.invoice_id}` }],
      };
    }
    case 'STOCK_ADJUSTMENT':
    case 'STOCK_TRANSFER':
    case 'PRODUCTION':
    case 'INVENTORY_WRITEDOWN': {
      const table = await stockTable(db, tenantId, sourceId);
      let number: string | null = null;
      let date: string | null = null;
      let fields: DocField[] = [];
      if (sourceType === 'STOCK_TRANSFER') {
        const t = await one(db, sql`SELECT t.number, t.date::text, t.status, t.notes, a.name AS from_wh, b.name AS to_wh, t.total_value FROM stock_transfers t JOIN warehouses a ON a.id = t.from_warehouse_id JOIN warehouses b ON b.id = t.to_warehouse_id WHERE t.tenant_id = ${tenantId} AND t.id = ${sourceId}`);
        if (t) { number = t.number; date = t.date; fields = [f('Dari gudang', t.from_wh), f('Ke gudang', t.to_wh), f('Status', t.status), f('Nilai', t.total_value, true), f('Catatan', t.notes)]; }
      } else if (sourceType === 'PRODUCTION') {
        const o = await one(db, sql`SELECT o.number, o.date::text, o.status, o.planned_qty, o.output_qty, o.total_cost, o.unit_cost, p.name AS product FROM production_orders o JOIN products p ON p.id = o.product_id WHERE o.tenant_id = ${tenantId} AND o.id = ${sourceId}`);
        if (o) { number = o.number; date = o.date; fields = [f('Produk', o.product), f('Status', o.status), f('Rencana', o.planned_qty), f('Hasil', o.output_qty), f('Biaya produksi', o.total_cost, true), f('Biaya per unit', o.unit_cost, true)]; }
      } else if (sourceType === 'INVENTORY_WRITEDOWN') {
        const w = await one(db, sql`SELECT number, date::text, reason, kind, total FROM inventory_writedowns WHERE tenant_id = ${tenantId} AND id = ${sourceId}`);
        if (w) { number = w.number; date = w.date; fields = [f('Jenis', w.kind === 'REVERSAL' ? 'Pemulihan nilai' : 'Penurunan nilai'), f('Alasan', w.reason), f('Total', w.total, true)]; }
      } else {
        number = table.rows[0] ? (await one(db, sql`SELECT ref_number, date::text FROM stock_moves WHERE tenant_id = ${tenantId} AND ref_id = ${sourceId} LIMIT 1`))?.ref_number ?? null : null;
        date = table.rows[0] ? (await one(db, sql`SELECT date::text AS d FROM stock_moves WHERE tenant_id = ${tenantId} AND ref_id = ${sourceId} LIMIT 1`))?.d ?? null : null;
      }
      return { title: MOVE_TITLE[sourceType], number, date, fields, table, related: sourceType === 'PRODUCTION' ? [{ label: 'Perintah produksi', route: '/production/orders' }] : [] };
    }
    case 'CASH_IN':
    case 'CASH_OUT':
    case 'TRANSFER': {
      const d = await one(db, sql`
        SELECT t.number, t.date::text, t.type, t.amount, t.reference, t.description, a.name AS account, b.name AS to_account
        FROM cash_transactions t JOIN accounts a ON a.id = t.cash_account_id LEFT JOIN accounts b ON b.id = t.to_cash_account_id
        WHERE t.tenant_id = ${tenantId} AND t.id = ${sourceId}`);
      if (!d) return null;
      return {
        title: d.type === 'IN' ? 'Kas masuk' : d.type === 'OUT' ? 'Kas keluar' : 'Transfer kas / bank',
        number: d.number, date: d.date,
        fields: [f('Akun kas / bank', d.account), ...(d.to_account ? [f('Ke akun', d.to_account)] : []), f('Jumlah', d.amount, true), f('No. bukti', d.reference), f('Keterangan', d.description)],
        table: {
          columns: [{ key: 'account', title: 'Akun lawan' }, { key: 'memo', title: 'Catatan' }, { key: 'amount', title: 'Jumlah', align: 'right', money: true }],
          rows: await q(db, sql`SELECT a.code || ' · ' || a.name AS account, l.memo, l.amount FROM cash_transaction_lines l JOIN accounts a ON a.id = l.account_id WHERE l.transaction_id = ${sourceId}`),
        },
        related: [],
      };
    }
    case 'POS': {
      const d = await one(db, sql`SELECT o.number, o.date::text, o.subtotal, o.tax_amount, o.total, o.tendered, o."change" AS change, s.number AS session FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id WHERE o.tenant_id = ${tenantId} AND o.id = ${sourceId}`);
      if (!d) return null;
      const pays = await q(db, sql`SELECT method, amount FROM pos_payments WHERE order_id = ${sourceId}`);
      return {
        title: 'Penjualan kasir', number: d.number, date: d.date,
        fields: [f('Sesi kasir', d.session), f('Subtotal (DPP)', d.subtotal, true), f('PPN', d.tax_amount, true), f('Total', d.total, true), f('Dibayar', d.tendered, true), f('Kembalian', d.change, true), ...pays.map((p) => f(`Pembayaran ${p.method}`, p.amount, true))],
        table: {
          columns: [{ key: 'item', title: 'Barang' }, { key: 'qty', title: 'Jumlah', align: 'right', qty: true }, { key: 'price', title: 'Harga', align: 'right', money: true }, { key: 'total', title: 'Jumlah (Rp)', align: 'right', money: true }],
          rows: await q(db, sql`SELECT p.sku || ' · ' || p.name AS item, l.qty, l.price, l.line_total AS total FROM pos_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ${sourceId}`),
        },
        related: [{ label: 'Riwayat sesi kasir', route: '/pos/sessions' }],
      };
    }
    case 'POS_CLOSE': {
      const d = await one(db, sql`SELECT number, opened_at::text, closed_at::text, opening_cash, expected_cash, counted_cash, difference, status FROM pos_sessions WHERE tenant_id = ${tenantId} AND id = ${sourceId}`);
      if (!d) return null;
      return { title: 'Tutup sesi kasir', number: d.number, date: d.closed_at?.slice(0, 10) ?? null, fields: [f('Dibuka', d.opened_at?.slice(0, 16).replace('T', ' ')), f('Ditutup', d.closed_at?.slice(0, 16).replace('T', ' ')), f('Kas awal', d.opening_cash, true), f('Kas seharusnya', d.expected_cash, true), f('Kas dihitung', d.counted_cash, true), f('Selisih', d.difference, true)], table: null, related: [{ label: 'Riwayat sesi kasir', route: '/pos/sessions' }] };
    }
    case 'TAX_PAYMENT': {
      const d = await one(db, sql`SELECT p.number, p.date::text, p.type, p.period, p.amount, p.ntpn, p.billing_code, p.notes, a.name AS account FROM tax_payments p LEFT JOIN accounts a ON a.id = p.cash_account_id WHERE p.tenant_id = ${tenantId} AND p.id = ${sourceId}`);
      if (!d) return null;
      return { title: 'Setoran pajak', number: d.number, date: d.date, fields: [f('Jenis', d.type), f('Masa', d.period), f('Jumlah', d.amount, true), f('NTPN', d.ntpn), f('Kode billing', d.billing_code), f('Dibayar dari', d.account), f('Catatan', d.notes)], table: null, related: [{ label: 'Setoran pajak & BPJS', route: '/tax' }] };
    }
    default:
      return null;
  }
}

/** Jenis sumber yang dokumennya dapat dibuka di halaman rincian dokumen */
export const DOCUMENT_VIEW_TYPES = new Set(['PURCHASE_INVOICE', 'SUPPLIER_PAYMENT', 'PURCHASE_RETURN', 'SALES_RETURN', 'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'PRODUCTION', 'INVENTORY_WRITEDOWN', 'CASH_IN', 'CASH_OUT', 'TRANSFER', 'POS', 'POS_CLOSE', 'TAX_PAYMENT']);
