import { sql } from 'drizzle-orm';
import { Builder, Ctx, grainOf, grainSql, num, periodLabel, rows, rp } from './types';

/** Umur piutang per pelanggan (per hari ini); dipakai juga oleh laporan FMCG dan Jasa */
export async function arAging(c: Ctx) {
  return rows(c, sql`
    SELECT cu.name AS customer,
      SUM(CASE WHEN i.due_date >= ${c.today}::date THEN o ELSE 0 END) AS current,
      SUM(CASE WHEN i.due_date < ${c.today}::date AND i.due_date >= ${c.today}::date - 30 THEN o ELSE 0 END) AS d1_30,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 30 AND i.due_date >= ${c.today}::date - 60 THEN o ELSE 0 END) AS d31_60,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 60 AND i.due_date >= ${c.today}::date - 90 THEN o ELSE 0 END) AS d61_90,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 90 THEN o ELSE 0 END) AS d90_plus,
      SUM(o) AS total
    FROM (SELECT i2.*, (i2.total - i2.paid_amount - i2.returned_amount) AS o FROM invoices i2 WHERE i2.tenant_id = ${c.tenantId} AND i2.status <> 'PAID') i
    JOIN customers cu ON cu.id = i.customer_id
    GROUP BY cu.name HAVING SUM(o) <> 0 ORDER BY SUM(o) DESC LIMIT 200`);
}
export const AGING_COLS = [
  { key: 'customer', label: 'Pelanggan' }, { key: 'current', label: 'Belum jatuh tempo', type: 'money' as const }, { key: 'd1_30', label: '1–30 hari', type: 'money' as const },
  { key: 'd31_60', label: '31–60 hari', type: 'money' as const }, { key: 'd61_90', label: '61–90 hari', type: 'money' as const }, { key: 'd90_plus', label: '> 90 hari', type: 'money' as const }, { key: 'total', label: 'Total', type: 'money' as const },
];

export const salesReport: Builder = async (c) => {
  const g = grainOf(c);
  const inv = sql`i.tenant_id = ${c.tenantId} AND i.date BETWEEN ${c.from}::date AND ${c.to}::date AND NOT i.is_opening`;
  const [tot] = await rows<{ n: string; dpp: string; total: string }>(c, sql`SELECT COUNT(*)::text AS n, COALESCE(SUM(i.subtotal), 0) AS dpp, COALESCE(SUM(i.total), 0) AS total FROM invoices i WHERE ${inv}`);
  const [ret] = await rows<{ total: string; n: string }>(c, sql`SELECT COALESCE(SUM(r.subtotal), 0) AS total, COUNT(*)::text AS n FROM sales_returns r WHERE r.tenant_id = ${c.tenantId} AND r.date BETWEEN ${c.from}::date AND ${c.to}::date`);
  const [over] = await rows<{ amount: string; n: string }>(c, sql`SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS amount, COUNT(*)::text AS n FROM invoices WHERE tenant_id = ${c.tenantId} AND status <> 'PAID' AND due_date < ${c.today}::date`);
  const [open] = await rows<{ amount: string }>(c, sql`SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS amount FROM invoices WHERE tenant_id = ${c.tenantId} AND status <> 'PAID'`);

  const byPeriod = await rows(c, sql`
    SELECT ${grainSql('i.date', g)} AS period, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.tax_amount) AS tax, SUM(i.total) AS total
    FROM invoices i WHERE ${inv} GROUP BY 1 ORDER BY 1`);
  const byCustomer = await rows(c, sql`
    SELECT cu.name AS customer, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total) AS total, SUM(i.total - i.paid_amount - i.returned_amount) AS outstanding
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id WHERE ${inv} GROUP BY cu.name ORDER BY SUM(i.subtotal) DESC LIMIT 200`);
  const byProduct = await rows(c, sql`
    SELECT p.sku, p.name AS product, SUM(l.qty * l.uom_factor) AS qty, SUM(l.line_total) AS sales, SUM(l.qty * l.uom_factor * l.unit_cost) AS cogs, SUM(l.line_total - l.qty * l.uom_factor * l.unit_cost) AS margin
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id WHERE ${inv} AND i.kind = 'GOODS' GROUP BY p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT 300`);
  const bySales = await rows(c, sql`
    SELECT COALESCE(u.name, '(tanpa sales)') AS salesperson, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total) AS total
    FROM invoices i LEFT JOIN sales_orders so ON so.id = i.sales_order_id LEFT JOIN users u ON u.id = so.salesperson_id WHERE ${inv} GROUP BY 1 ORDER BY SUM(i.subtotal) DESC`);
  const aging = await arAging(c);
  const overdue = await rows(c, sql`
    SELECT i.number, cu.name AS customer, i.due_date AS due, (${c.today}::date - i.due_date)::int AS days_late, (i.total - i.paid_amount - i.returned_amount) AS outstanding
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id WHERE i.tenant_id = ${c.tenantId} AND i.status <> 'PAID' AND i.due_date < ${c.today}::date ORDER BY i.due_date LIMIT 200`);
  const returns = await rows(c, sql`
    SELECT r.number, r.date, cu.name AS customer, i.number AS invoice, r.reason, r.total
    FROM sales_returns r JOIN customers cu ON cu.id = r.customer_id LEFT JOIN invoices i ON i.id = r.invoice_id WHERE r.tenant_id = ${c.tenantId} AND r.date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY r.date DESC LIMIT 200`);
  const undelivered = await rows(c, sql`
    SELECT d.number, d.date, cu.name AS customer, so.number AS sales_order, (${c.today}::date - d.date)::int AS days
    FROM delivery_orders d JOIN customers cu ON cu.id = d.customer_id JOIN sales_orders so ON so.id = d.sales_order_id
    WHERE d.tenant_id = ${c.tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = d.sales_order_id) ORDER BY d.date LIMIT 200`);

  return {
    kpis: [
      { label: 'Penjualan (sebelum PPN)', value: tot.dpp, type: 'money' }, { label: 'Jumlah faktur', value: num(tot.n), type: 'int' }, { label: 'Retur penjualan', value: ret.total, type: 'money' },
      { label: 'Piutang berjalan', value: open.amount, type: 'money' }, { label: 'Piutang lewat jatuh tempo', value: over.amount, type: 'money', tone: num(over.amount) > 0 ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'periode', title: 'Per periode', columns: [{ key: 'period', label: periodLabel(g) }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Penjualan', type: 'money' }, { key: 'tax', label: 'PPN', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: byPeriod },
      { key: 'pelanggan', title: 'Per pelanggan', columns: [{ key: 'customer', label: 'Pelanggan' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Penjualan', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'outstanding', label: 'Sisa piutang', type: 'money' }], rows: byCustomer },
      { key: 'produk', title: 'Per produk', note: 'Hanya faktur barang; jumlah dalam satuan dasar. Laba kotor = penjualan − harga pokok saat faktur.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'sales', label: 'Penjualan', type: 'money' }, { key: 'cogs', label: 'Harga pokok', type: 'money' }, { key: 'margin', label: 'Laba kotor', type: 'money' }], rows: byProduct },
      { key: 'sales', title: 'Per sales', note: 'Sales penanggung jawab pesanan penjualan; faktur tanpa pesanan dihitung "tanpa sales".', columns: [{ key: 'salesperson', label: 'Sales' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Penjualan', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: bySales },
      { key: 'umur', title: 'Umur piutang', note: `Per ${c.today}, dihitung dari tanggal jatuh tempo (tidak terpengaruh rentang tanggal).`, columns: AGING_COLS, rows: aging },
      { key: 'jatuh-tempo', title: 'Faktur lewat jatuh tempo', columns: [{ key: 'number', label: 'Faktur' }, { key: 'customer', label: 'Pelanggan' }, { key: 'due', label: 'Jatuh tempo', type: 'date' }, { key: 'days_late', label: 'Terlambat (hari)', type: 'int' }, { key: 'outstanding', label: 'Sisa', type: 'money' }], rows: overdue, empty: 'Tidak ada faktur lewat jatuh tempo' },
      { key: 'retur', title: 'Retur penjualan', columns: [{ key: 'number', label: 'Retur' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'customer', label: 'Pelanggan' }, { key: 'invoice', label: 'Faktur asal' }, { key: 'reason', label: 'Alasan' }, { key: 'total', label: 'Nilai', type: 'money' }], rows: returns },
      { key: 'belum-faktur', title: 'Surat jalan belum difakturkan', note: 'Barang sudah dikirim tetapi belum ditagih: pendapatan yang tertunda.', columns: [{ key: 'number', label: 'Surat jalan' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'customer', label: 'Pelanggan' }, { key: 'sales_order', label: 'Pesanan' }, { key: 'days', label: 'Hari', type: 'int' }], rows: undelivered, empty: 'Semua surat jalan sudah difakturkan' },
    ],
  };
};
export { rp };
