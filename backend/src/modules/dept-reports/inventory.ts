import { sql } from 'drizzle-orm';
import { Builder, num, rows, spanDays } from './types';

export const inventoryReport: Builder = async (c) => {
  const days = spanDays(c.from, c.to);
  const [val] = await rows<{ value: string; skus: string }>(c, sql`SELECT COALESCE(SUM(b.qty * b.avg_cost), 0) AS value, COUNT(DISTINCT b.product_id) FILTER (WHERE b.qty > 0)::text AS skus FROM stock_balances b WHERE b.tenant_id = ${c.tenantId}`);
  const byWarehouse = await rows(c, sql`SELECT w.code, w.name AS warehouse, SUM(b.qty) AS qty, SUM(b.qty * b.avg_cost) AS value, COUNT(*) FILTER (WHERE b.qty > 0)::int AS skus FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.tenant_id = ${c.tenantId} GROUP BY w.code, w.name ORDER BY SUM(b.qty * b.avg_cost) DESC`);
  const byProduct = await rows(c, sql`SELECT p.sku, p.name AS product, p.base_uom AS uom, SUM(b.qty) AS qty, CASE WHEN SUM(b.qty) > 0 THEN SUM(b.qty * b.avg_cost) / SUM(b.qty) ELSE 0 END AS avg_cost, SUM(b.qty * b.avg_cost) AS value FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE b.tenant_id = ${c.tenantId} GROUP BY p.sku, p.name, p.base_uom HAVING SUM(b.qty) <> 0 ORDER BY SUM(b.qty * b.avg_cost) DESC LIMIT 300`);
  const belowMin = await rows(c, sql`SELECT p.sku, p.name AS product, w.name AS warehouse, b.qty, m.min_qty AS min_qty, (m.min_qty - b.qty) AS short FROM stock_minimums m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id WHERE m.tenant_id = ${c.tenantId} AND m.min_qty > 0 AND COALESCE(b.qty, 0) < m.min_qty ORDER BY (m.min_qty - COALESCE(b.qty, 0)) DESC LIMIT 200`);
  const expiry = await rows(c, sql`SELECT p.sku, p.name AS product, w.name AS warehouse, l.lot_no, l.expiry_date AS expiry, l.qty_remaining AS qty, (l.expiry_date - ${c.today}::date)::int AS days FROM stock_lots l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id WHERE l.tenant_id = ${c.tenantId} AND l.qty_remaining > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ${c.today}::date + 60 ORDER BY l.expiry_date LIMIT 200`);
  const movement = await rows(c, sql`
    SELECT p.sku, p.name AS product,
      COALESCE(SUM(-m.qty) FILTER (WHERE m.qty < 0 AND m.type IN ('SALE', 'PRODUCTION_ISSUE')), 0) AS used,
      COALESCE(SUM(m.qty) FILTER (WHERE m.qty > 0 AND m.type IN ('PURCHASE', 'PRODUCTION_OUTPUT')), 0) AS received,
      COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.product_id = p.id), 0) AS stock
    FROM stock_moves m JOIN products p ON p.id = m.product_id
    WHERE m.tenant_id = ${c.tenantId} AND m.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY p.id, p.sku, p.name ORDER BY 3 DESC LIMIT 300`);
  const moveRows = movement.map((r) => {
    const used = num(r.used);
    const perDay = used / days;
    return { ...r, cover_days: perDay > 0 ? Math.round(num(r.stock) / perDay) : null, status: used === 0 ? 'Tidak bergerak' : num(r.stock) <= 0 ? 'Habis' : perDay > 0 && num(r.stock) / perDay < 7 ? 'Segera habis' : 'Normal' };
  });
  return {
    kpis: [
      { label: 'Nilai persediaan', value: val.value, type: 'money' }, { label: 'Produk bersaldo', value: num(val.skus), type: 'int' },
      { label: 'Di bawah stok minimum', value: belowMin.length, type: 'int', tone: belowMin.length ? 'warn' : 'ok' }, { label: 'Lot kedaluwarsa ≤ 60 hari', value: expiry.length, type: 'int', tone: expiry.length ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'gudang', title: 'Nilai per gudang', columns: [{ key: 'code', label: 'Kode' }, { key: 'warehouse', label: 'Gudang' }, { key: 'skus', label: 'Produk', type: 'int' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'value', label: 'Nilai', type: 'money' }], rows: byWarehouse },
      { key: 'produk', title: 'Nilai per produk', note: 'Posisi saat ini (semua gudang, termasuk karantina).', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'uom', label: 'Satuan' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'avg_cost', label: 'Harga rata-rata', type: 'money' }, { key: 'value', label: 'Nilai', type: 'money' }], rows: byProduct },
      { key: 'perputaran', title: 'Perputaran', note: 'Pemakaian = penjualan dan pemakaian produksi dalam rentang tanggal; "hari cukup" = stok sekarang ÷ pemakaian rata-rata per hari.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'received', label: 'Masuk', type: 'qty' }, { key: 'used', label: 'Terpakai/terjual', type: 'qty' }, { key: 'stock', label: 'Stok sekarang', type: 'qty' }, { key: 'cover_days', label: 'Hari cukup', type: 'int' }, { key: 'status', label: 'Status' }], rows: moveRows },
      { key: 'minimum', title: 'Di bawah stok minimum', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'warehouse', label: 'Gudang' }, { key: 'qty', label: 'Stok', type: 'qty' }, { key: 'min_qty', label: 'Minimum', type: 'qty' }, { key: 'short', label: 'Kurang', type: 'qty' }], rows: belowMin, empty: 'Semua produk di atas stok minimum' },
      { key: 'kedaluwarsa', title: 'Kedaluwarsa', note: 'Lot yang sudah lewat atau akan kedaluwarsa dalam 60 hari.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'warehouse', label: 'Gudang' }, { key: 'lot_no', label: 'Lot' }, { key: 'expiry', label: 'Kedaluwarsa', type: 'date' }, { key: 'qty', label: 'Sisa', type: 'qty' }, { key: 'days', label: 'Hari lagi', type: 'int' }], rows: expiry, empty: 'Tidak ada lot yang segera kedaluwarsa' },
    ],
  };
};
