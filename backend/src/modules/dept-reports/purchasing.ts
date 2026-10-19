import { sql } from 'drizzle-orm';
import { Builder, grainOf, grainSql, num, periodLabel, rows } from './types';

export const purchasesReport: Builder = async (c) => {
  const g = grainOf(c);
  const inv = sql`i.tenant_id = ${c.tenantId} AND i.date BETWEEN ${c.from}::date AND ${c.to}::date`;
  const [tot] = await rows<{ n: string; dpp: string }>(c, sql`SELECT COUNT(*)::text AS n, COALESCE(SUM(i.subtotal), 0) AS dpp FROM purchase_invoices i WHERE ${inv}`);
  const [open] = await rows<{ amount: string }>(c, sql`SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS amount FROM purchase_invoices WHERE tenant_id = ${c.tenantId} AND status <> 'PAID'`);
  const [over] = await rows<{ amount: string }>(c, sql`SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS amount FROM purchase_invoices WHERE tenant_id = ${c.tenantId} AND status <> 'PAID' AND due_date < ${c.today}::date`);
  const [ret] = await rows<{ total: string }>(c, sql`SELECT COALESCE(SUM(subtotal), 0) AS total FROM purchase_returns WHERE tenant_id = ${c.tenantId} AND date BETWEEN ${c.from}::date AND ${c.to}::date`);

  const byPeriod = await rows(c, sql`SELECT ${grainSql('i.date', g)} AS period, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.tax_amount) AS tax, SUM(i.total) AS total FROM purchase_invoices i WHERE ${inv} GROUP BY 1 ORDER BY 1`);
  const bySupplier = await rows(c, sql`SELECT s.name AS supplier, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total) AS total, SUM(i.total - i.paid_amount - i.returned_amount) AS outstanding FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE ${inv} GROUP BY s.name ORDER BY SUM(i.subtotal) DESC LIMIT 200`);
  const byProduct = await rows(c, sql`SELECT p.sku, p.name AS product, SUM(l.qty * l.uom_factor) AS qty, SUM(l.line_total) AS amount, CASE WHEN SUM(l.qty * l.uom_factor) > 0 THEN SUM(l.line_total) / SUM(l.qty * l.uom_factor) ELSE 0 END AS avg_cost
    FROM purchase_invoice_lines l JOIN purchase_invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id WHERE ${inv} AND l.line_type = 'PRODUCT' GROUP BY p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT 300`);
  const aging = await rows(c, sql`
    SELECT s.name AS supplier,
      SUM(CASE WHEN i.due_date >= ${c.today}::date THEN o ELSE 0 END) AS current,
      SUM(CASE WHEN i.due_date < ${c.today}::date AND i.due_date >= ${c.today}::date - 30 THEN o ELSE 0 END) AS d1_30,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 30 AND i.due_date >= ${c.today}::date - 60 THEN o ELSE 0 END) AS d31_60,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 60 AND i.due_date >= ${c.today}::date - 90 THEN o ELSE 0 END) AS d61_90,
      SUM(CASE WHEN i.due_date < ${c.today}::date - 90 THEN o ELSE 0 END) AS d90_plus, SUM(o) AS total
    FROM (SELECT i2.*, (i2.total - i2.paid_amount - i2.returned_amount) AS o FROM purchase_invoices i2 WHERE i2.tenant_id = ${c.tenantId} AND i2.status <> 'PAID') i
    JOIN suppliers s ON s.id = i.supplier_id GROUP BY s.name HAVING SUM(o) <> 0 ORDER BY SUM(o) DESC LIMIT 200`);
  const variance = await rows(c, sql`SELECT i.number, i.date, s.name AS supplier, i.price_variance AS variance, COALESCE(i.variance_reason, '') AS reason FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE ${inv} AND i.price_variance <> 0 ORDER BY ABS(i.price_variance) DESC LIMIT 100`);
  const notReceived = await rows(c, sql`
    SELECT po.number, po.date, s.name AS supplier, SUM(l.qty - l.received_qty) AS remaining, SUM((l.qty - l.received_qty) * l.price) AS value, (${c.today}::date - po.date)::int AS days
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN purchase_order_lines l ON l.order_id = po.id
    WHERE po.tenant_id = ${c.tenantId} AND po.status = 'CONFIRMED' GROUP BY po.number, po.date, s.name HAVING SUM(l.qty - l.received_qty) > 0 ORDER BY po.date LIMIT 200`);
  const notBilled = await rows(c, sql`
    SELECT g.number, g.date, s.name AS supplier, SUM(l.value - l.billed_value) AS value, (${c.today}::date - g.date)::int AS days
    FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id JOIN goods_receipt_lines l ON l.receipt_id = g.id
    WHERE g.tenant_id = ${c.tenantId} AND g.status <> 'CANCELLED' GROUP BY g.number, g.date, s.name HAVING SUM(l.qty - l.billed_qty) > 0 ORDER BY g.date LIMIT 200`);

  return {
    kpis: [
      { label: 'Pembelian (sebelum PPN)', value: tot.dpp, type: 'money' }, { label: 'Jumlah faktur pemasok', value: num(tot.n), type: 'int' }, { label: 'Retur pembelian', value: ret.total, type: 'money' },
      { label: 'Utang berjalan', value: open.amount, type: 'money' }, { label: 'Utang lewat jatuh tempo', value: over.amount, type: 'money', tone: num(over.amount) > 0 ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'periode', title: 'Per periode', columns: [{ key: 'period', label: periodLabel(g) }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Pembelian', type: 'money' }, { key: 'tax', label: 'PPN', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: byPeriod },
      { key: 'pemasok', title: 'Per pemasok', columns: [{ key: 'supplier', label: 'Pemasok' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Pembelian', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'outstanding', label: 'Sisa utang', type: 'money' }], rows: bySupplier },
      { key: 'produk', title: 'Per produk', note: 'Hanya baris barang; jumlah dalam satuan dasar.', columns: [{ key: 'sku', label: 'Kode' }, { key: 'product', label: 'Produk' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'amount', label: 'Nilai', type: 'money' }, { key: 'avg_cost', label: 'Harga rata-rata', type: 'money' }], rows: byProduct },
      { key: 'umur', title: 'Umur utang', note: `Per ${c.today}, dari tanggal jatuh tempo.`, columns: [{ key: 'supplier', label: 'Pemasok' }, { key: 'current', label: 'Belum jatuh tempo', type: 'money' }, { key: 'd1_30', label: '1–30 hari', type: 'money' }, { key: 'd31_60', label: '31–60 hari', type: 'money' }, { key: 'd61_90', label: '61–90 hari', type: 'money' }, { key: 'd90_plus', label: '> 90 hari', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: aging },
      { key: 'selisih-harga', title: 'Selisih harga beli', note: 'Faktur yang harganya berbeda dari pesanan.', columns: [{ key: 'number', label: 'Faktur' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'supplier', label: 'Pemasok' }, { key: 'variance', label: 'Selisih', type: 'money' }, { key: 'reason', label: 'Alasan' }], rows: variance, empty: 'Tidak ada selisih harga pada periode ini' },
      { key: 'po-belum', title: 'Pesanan belum diterima', columns: [{ key: 'number', label: 'Pesanan' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'supplier', label: 'Pemasok' }, { key: 'remaining', label: 'Sisa jumlah', type: 'qty' }, { key: 'value', label: 'Nilai sisa', type: 'money' }, { key: 'days', label: 'Hari', type: 'int' }], rows: notReceived, empty: 'Semua pesanan dikonfirmasi sudah diterima' },
      { key: 'terima-belum-faktur', title: 'Penerimaan belum difakturkan', note: 'Barang sudah diterima tetapi tagihan pemasok belum dicatat (utang yang belum tercatat).', columns: [{ key: 'number', label: 'Penerimaan' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'supplier', label: 'Pemasok' }, { key: 'value', label: 'Nilai', type: 'money' }, { key: 'days', label: 'Hari', type: 'int' }], rows: notBilled, empty: 'Semua penerimaan sudah difakturkan' },
    ],
  };
};
