import { sql } from 'drizzle-orm';
import { Builder, Ctx, grainOf, grainSql, num, periodLabel, rows } from './types';

const orders = (c: Ctx) => sql`o.tenant_id = ${c.tenantId} AND o.date BETWEEN ${c.from}::date AND ${c.to}::date`;

export const posReport: Builder = async (c) => {
  const g = grainOf(c);
  const [t] = await rows<{ n: string; total: string; tax: string }>(c, sql`SELECT COUNT(*)::text AS n, COALESCE(SUM(o.total), 0) AS total, COALESCE(SUM(o.tax_amount), 0) AS tax FROM pos_orders o WHERE ${orders(c)}`);
  const [ret] = await rows<{ total: string }>(c, sql`SELECT COALESCE(SUM(total), 0) AS total FROM pos_returns WHERE tenant_id = ${c.tenantId} AND date BETWEEN ${c.from}::date AND ${c.to}::date`);
  const [diff] = await rows<{ diff: string }>(c, sql`SELECT COALESCE(SUM(difference), 0) AS diff FROM pos_sessions WHERE tenant_id = ${c.tenantId} AND status = 'CLOSED' AND closed_at::date BETWEEN ${c.from}::date AND ${c.to}::date`);
  const [unsettled] = await rows<{ n: string; amount: string }>(c, sql`SELECT COUNT(*)::text AS n, COALESCE(SUM(p.amount), 0) AS amount FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE o.tenant_id = ${c.tenantId} AND p.method IN ('QRIS', 'DEBIT') AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id)`);

  const byPeriod = await rows(c, sql`SELECT ${grainSql('o.date', g)} AS period, COUNT(*)::int AS orders, SUM(o.subtotal) AS subtotal, SUM(o.tax_amount) AS tax, SUM(o.total) AS total FROM pos_orders o WHERE ${orders(c)} GROUP BY 1 ORDER BY 1`);
  const byCashier = await rows(c, sql`SELECT u.name AS cashier, COUNT(*)::int AS orders, SUM(o.total) AS total, CASE WHEN COUNT(*) > 0 THEN SUM(o.total) / COUNT(*) ELSE 0 END AS average FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id JOIN users u ON u.id = s.user_id WHERE ${orders(c)} GROUP BY u.name ORDER BY SUM(o.total) DESC`);
  const sessions = await rows(c, sql`SELECT s.number, u.name AS cashier, s.opened_at, s.closed_at, s.status, COALESCE((SELECT SUM(o.total) FROM pos_orders o WHERE o.session_id = s.id), 0) AS total, s.difference FROM pos_sessions s JOIN users u ON u.id = s.user_id WHERE s.tenant_id = ${c.tenantId} AND s.opened_at::date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY s.opened_at DESC LIMIT 200`);
  const methods = await rows(c, sql`SELECT p.method, COUNT(*)::int AS payments, SUM(p.amount) AS amount FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id WHERE ${orders(c)} GROUP BY p.method ORDER BY SUM(p.amount) DESC`);
  const top = await rows(c, sql`SELECT pr.sku, pr.name AS product, SUM(l.qty * l.uom_factor) AS qty, SUM(l.line_total) AS sales FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products pr ON pr.id = l.product_id WHERE ${orders(c)} GROUP BY pr.sku, pr.name ORDER BY SUM(l.line_total) DESC LIMIT 20`);
  const hours = await rows(c, sql`SELECT lpad((EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Jakarta'))::int::text, 2, '0') || ':00' AS hour, COUNT(*)::int AS orders, SUM(o.total) AS total FROM pos_orders o WHERE ${orders(c)} GROUP BY 1 ORDER BY 1`);
  const settlements = await rows(c, sql`SELECT s.number, s.date, s.method, s.gross, s.returns_total, s.received, s.difference, s.status FROM pos_card_settlements s WHERE s.tenant_id = ${c.tenantId} AND s.date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY s.date DESC LIMIT 100`);
  const returns = await rows(c, sql`SELECT r.number, r.date, o.number AS "order", r.reason, r.refund_method AS method, r.total FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id WHERE r.tenant_id = ${c.tenantId} AND r.date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY r.date DESC LIMIT 100`);
  return {
    kpis: [
      { label: 'Penjualan kasir (termasuk pajak)', value: t.total, type: 'money' }, { label: 'Jumlah transaksi', value: num(t.n), type: 'int' },
      { label: 'Rata-rata per transaksi', value: num(t.n) ? num(t.total) / num(t.n) : 0, type: 'money' }, { label: 'Retur kasir', value: ret.total, type: 'money' },
      { label: 'Selisih uang di laci (sesi ditutup)', value: diff.diff, type: 'money', tone: num(diff.diff) !== 0 ? 'warn' : 'ok' }, { label: 'QRIS/debit belum cair', value: unsettled.amount, type: 'money', tone: num(unsettled.n) ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'periode', title: 'Per periode', columns: [{ key: 'period', label: periodLabel(g) }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'subtotal', label: 'Sebelum pajak', type: 'money' }, { key: 'tax', label: 'Pajak', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: byPeriod },
      { key: 'kasir', title: 'Per kasir', columns: [{ key: 'cashier', label: 'Kasir' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'total', label: 'Penjualan', type: 'money' }, { key: 'average', label: 'Rata-rata', type: 'money' }], rows: byCashier },
      { key: 'sesi', title: 'Per sesi', note: 'Selisih = uang dihitung − uang seharusnya di laci saat sesi ditutup.', columns: [{ key: 'number', label: 'Sesi' }, { key: 'cashier', label: 'Kasir' }, { key: 'opened_at', label: 'Dibuka', type: 'date' }, { key: 'closed_at', label: 'Ditutup', type: 'date' }, { key: 'status', label: 'Status' }, { key: 'total', label: 'Penjualan', type: 'money' }, { key: 'difference', label: 'Selisih', type: 'money' }], rows: sessions },
      { key: 'metode', title: 'Metode bayar', columns: [{ key: 'method', label: 'Metode' }, { key: 'payments', label: 'Pembayaran', type: 'int' }, { key: 'amount', label: 'Jumlah', type: 'money' }], rows: methods },
      { key: 'terlaris', title: 'Produk terlaris', note: '20 produk dengan penjualan terbesar.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'sales', label: 'Penjualan', type: 'money' }], rows: top },
      { key: 'jam', title: 'Per jam', note: 'Jam transaksi (WIB): untuk menentukan jam ramai dan jadwal kasir.', columns: [{ key: 'hour', label: 'Jam' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'total', label: 'Penjualan', type: 'money' }], rows: hours },
      { key: 'pencairan', title: 'Pencairan QRIS/kartu', columns: [{ key: 'number', label: 'Pencairan' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'method', label: 'Metode' }, { key: 'gross', label: 'Kotor', type: 'money' }, { key: 'returns_total', label: 'Retur', type: 'money' }, { key: 'received', label: 'Diterima', type: 'money' }, { key: 'difference', label: 'Selisih', type: 'money' }, { key: 'status', label: 'Status' }], rows: settlements },
      { key: 'retur', title: 'Retur kasir', columns: [{ key: 'number', label: 'Retur' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'order', label: 'Transaksi' }, { key: 'reason', label: 'Alasan' }, { key: 'method', label: 'Pengembalian' }, { key: 'total', label: 'Nilai', type: 'money' }], rows: returns },
    ],
  };
};

export const fnbReport: Builder = async (c) => {
  const byMenu = await rows(c, sql`SELECT pr.sku, pr.name AS menu, SUM(l.qty * l.uom_factor) AS qty, SUM(l.line_total) AS sales, SUM(l.line_total - l.qty * l.uom_factor * l.unit_cost) AS margin FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products pr ON pr.id = l.product_id WHERE ${orders(c)} GROUP BY pr.sku, pr.name ORDER BY SUM(l.line_total) DESC LIMIT 200`);
  const types = await rows(c, sql`SELECT COALESCE(o.order_type, 'DINE_IN') AS type, COUNT(*)::int AS orders, SUM(o.total) AS total FROM pos_orders o WHERE ${orders(c)} GROUP BY 1 ORDER BY SUM(o.total) DESC`);
  const typeLabel: Record<string, string> = { DINE_IN: 'Makan di tempat', TAKEAWAY: 'Dibawa pulang', DELIVERY: 'Antar' };
  const tax = await rows(c, sql`SELECT CASE o.tax_kind WHEN 'LOCAL' THEN 'Pajak restoran daerah (PB1)' ELSE 'PPN' END AS kind, COUNT(*)::int AS orders, SUM(o.subtotal) AS base, SUM(o.tax_amount) AS tax FROM pos_orders o WHERE ${orders(c)} GROUP BY o.tax_kind ORDER BY 1`);
  const online = await rows(c, sql`SELECT COALESCE(o.channel, 'Kasir sendiri') AS channel, COUNT(*)::int AS orders, SUM(o.total) AS total, SUM(o.platform_fee) AS fee FROM pos_orders o WHERE ${orders(c)} GROUP BY 1 ORDER BY SUM(o.total) DESC`);
  const ingredients = await rows(c, sql`SELECT pr.sku, pr.name AS ingredient, SUM(-m.qty) AS qty, SUM(-m.qty * m.unit_cost) AS value FROM stock_moves m JOIN products pr ON pr.id = m.product_id WHERE m.tenant_id = ${c.tenantId} AND m.ref_type = 'POS_ORDER' AND m.qty < 0 AND m.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY pr.sku, pr.name ORDER BY SUM(-m.qty * m.unit_cost) DESC LIMIT 200`);
  // Selisih bahan: kebutuhan menurut resep (menu terjual × resep yang berlaku saat pesanan) vs yang sungguh keluar dari stok. Yang keluar =
  // pemakaian kasir + penyesuaian keluar (susut, rusak, kurang saat opname). Selisih tinggi = pemborosan atau resep tidak dijalankan.
  const variance = await rows(c, sql`
    WITH menu_line AS (
      SELECT DISTINCT ON (l.id) l.id, l.qty * l.uom_factor AS q, b.id AS bom_id, b.output_qty
      FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
      JOIN boms b ON b.tenant_id = ${c.tenantId} AND b.product_id = l.product_id AND b.created_at <= o.created_at
      WHERE ${orders(c)} AND l.from_recipe ORDER BY l.id, b.created_at DESC),
    need AS (SELECT bl.product_id, SUM(m.q * bl.qty / NULLIF(m.output_qty, 0)) AS expected FROM menu_line m JOIN bom_lines bl ON bl.bom_id = m.bom_id GROUP BY bl.product_id),
    pos_used AS (SELECT sm.product_id, SUM(-sm.qty) AS q FROM stock_moves sm JOIN pos_orders o ON o.id::text = sm.ref_id WHERE sm.tenant_id = ${c.tenantId} AND sm.ref_type = 'POS_ORDER' AND sm.qty < 0 AND ${orders(c)} GROUP BY sm.product_id),
    waste AS (SELECT sm.product_id, SUM(-sm.qty) AS q, SUM(-sm.qty * sm.unit_cost) AS v FROM stock_moves sm WHERE sm.tenant_id = ${c.tenantId} AND sm.type = 'ADJUSTMENT_OUT' AND sm.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY sm.product_id)
    SELECT p.sku, p.name AS ingredient, need.expected, COALESCE(pos_used.q, 0) AS pos_used, COALESCE(waste.q, 0) AS waste, COALESCE(waste.v, 0) AS waste_value,
      CASE WHEN need.expected > 0 THEN ROUND(COALESCE(waste.q, 0) / need.expected * 100, 1) ELSE NULL END AS waste_pct
    FROM need JOIN products p ON p.id = need.product_id LEFT JOIN pos_used ON pos_used.product_id = need.product_id LEFT JOIN waste ON waste.product_id = need.product_id
    ORDER BY COALESCE(waste.v, 0) DESC, p.name LIMIT 200`);
  const [tot] = await rows<{ total: string; n: string }>(c, sql`SELECT COALESCE(SUM(o.total), 0) AS total, COUNT(*)::text AS n FROM pos_orders o WHERE ${orders(c)}`);
  const [pb1] = await rows<{ tax: string }>(c, sql`SELECT COALESCE(SUM(o.tax_amount) FILTER (WHERE o.tax_kind = 'LOCAL'), 0) AS tax FROM pos_orders o WHERE ${orders(c)}`);
  const onlineTotal = online.filter((r) => r.channel !== 'Kasir sendiri').reduce((a, r) => a + num(r.total), 0);
  return {
    kpis: [{ label: 'Penjualan', value: tot.total, type: 'money' }, { label: 'Transaksi', value: num(tot.n), type: 'int' }, { label: 'Pajak restoran daerah (PB1)', value: pb1.tax, type: 'money' }, { label: 'Pesanan online', value: onlineTotal, type: 'money' }, { label: 'Susut bahan (penyesuaian keluar)', value: variance.reduce((a, r) => a + num(r.waste_value), 0), type: 'money', tone: variance.some((r) => num(r.waste_value) > 0) ? 'warn' : 'ok' }],
    sections: [
      { key: 'menu', title: 'Per menu', note: 'Laba kasar = penjualan − harga pokok bahan menurut resep.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'menu', label: 'Menu' }, { key: 'qty', label: 'Terjual', type: 'qty' }, { key: 'sales', label: 'Penjualan', type: 'money' }, { key: 'margin', label: 'Laba kasar', type: 'money' }], rows: byMenu },
      { key: 'jenis', title: 'Jenis pesanan', columns: [{ key: 'type', label: 'Jenis' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'total', label: 'Penjualan', type: 'money' }], rows: types.map((r) => ({ ...r, type: typeLabel[String(r.type)] ?? r.type })) },
      { key: 'pajak', title: 'Pajak restoran', columns: [{ key: 'kind', label: 'Jenis pajak' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'base', label: 'Dasar', type: 'money' }, { key: 'tax', label: 'Pajak', type: 'money' }], rows: tax },
      { key: 'online', title: 'Saluran penjualan', note: 'Pesanan lewat GoFood/GrabFood/ShopeeFood dan lainnya; biaya platform adalah potongan komisi.', columns: [{ key: 'channel', label: 'Saluran' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'total', label: 'Penjualan', type: 'money' }, { key: 'fee', label: 'Biaya platform', type: 'money' }], rows: online },
      { key: 'selisih', title: 'Selisih bahan vs resep', note: 'Seharusnya = menu terjual × kebutuhan bahan menurut resep. Susut = penyesuaian keluar (rusak, kedaluwarsa, kurang saat opname) pada rentang ini. % susut terhadap kebutuhan resep yang tinggi menandakan pemborosan, porsi tidak sesuai resep, atau pencatatan stok yang bermasalah.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'ingredient', label: 'Bahan' }, { key: 'expected', label: 'Seharusnya (resep)', type: 'qty' }, { key: 'pos_used', label: 'Keluar lewat kasir', type: 'qty' }, { key: 'waste', label: 'Susut/penyesuaian keluar', type: 'qty' }, { key: 'waste_pct', label: '% susut', type: 'pct' }, { key: 'waste_value', label: 'Nilai susut', type: 'money' }], rows: variance, empty: 'Belum ada penjualan menu beresep pada rentang ini' },
      { key: 'bahan', title: 'Bahan terpakai', note: 'Bahan yang dipotong otomatis dari stok saat menu terjual. Pencocokan dengan buku besar ada di Laporan pendukung F&B (Akuntansi).', columns: [{ key: 'sku', label: 'Kode' }, { key: 'ingredient', label: 'Bahan' }, { key: 'qty', label: 'Terpakai', type: 'qty' }, { key: 'value', label: 'Nilai', type: 'money' }], rows: ingredients },
    ],
  };
};
