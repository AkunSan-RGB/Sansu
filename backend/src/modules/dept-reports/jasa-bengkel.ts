import { sql } from 'drizzle-orm';
import { revenueByAccount } from './jasa-shared';
import { AGING_COLS, arAging } from './sales';
import { Builder, grainOf, grainSql, num, periodLabel, rows } from './types';

/** Laporan bengkel: pendapatan per mekanik, layanan terlaris, margin suku cadang, tagihan armada */
export const jasaBengkelReport: Builder = async (c) => {
  const g = grainOf(c);
  const ln = sql`FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
    WHERE o.tenant_id = ${c.tenantId} AND o.date BETWEEN ${c.from}::date AND ${c.to}::date`;
  const byMechanic = await rows(c, sql`
    SELECT COALESCE(e.name, '(tanpa mekanik)') AS mechanic, COUNT(*)::int AS jobs, COUNT(DISTINCT l.order_id)::int AS orders, SUM(l.line_total) AS revenue
    FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id LEFT JOIN employees e ON e.id = l.staff_id
    WHERE o.tenant_id = ${c.tenantId} AND o.date BETWEEN ${c.from}::date AND ${c.to}::date AND p.is_service
    GROUP BY e.name ORDER BY SUM(l.line_total) DESC`);
  const services = await rows(c, sql`
    SELECT p.sku, p.name, SUM(l.qty) AS qty, SUM(l.line_total) AS revenue ${ln} AND p.is_service GROUP BY p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT 100`);
  const parts = await rows(c, sql`
    SELECT p.sku, p.name, SUM(l.qty * l.uom_factor) AS qty, SUM(l.line_total) AS revenue, SUM(l.qty * l.uom_factor * l.unit_cost) AS cost
    ${ln} AND NOT p.is_service GROUP BY p.sku, p.name ORDER BY SUM(l.line_total) DESC LIMIT 100`);
  const partRows = parts.map((x): Record<string, unknown> => ({ ...x, margin: num(x.revenue) - num(x.cost), margin_pct: num(x.revenue) > 0 ? Math.round(((num(x.revenue) - num(x.cost)) / num(x.revenue)) * 1000) / 10 : null }));
  const daily = await rows(c, sql`
    SELECT ${grainSql('o.date', g)} AS period, COUNT(DISTINCT o.id)::int AS orders,
      SUM(l.line_total) FILTER (WHERE p.is_service) AS services, SUM(l.line_total) FILTER (WHERE NOT p.is_service) AS parts
    ${ln} GROUP BY 1 ORDER BY 1`);
  const fleet = await rows(c, sql`
    SELECT i.number, i.date, cu.name AS customer, i.subtotal, i.withholding_amount, i.total, (i.total - i.paid_amount - i.returned_amount) AS open, i.due_date
    FROM invoices i JOIN customers cu ON cu.id = i.customer_id
    WHERE i.tenant_id = ${c.tenantId} AND i.kind = 'SERVICE' AND NOT i.is_opening AND i.date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY i.date, i.number`);
  const svc = byMechanic.reduce((a, x) => a + num(x.revenue), 0);
  const prt = partRows.reduce((a, x) => a + num(x.revenue), 0);
  return {
    kpis: [
      { label: 'Transaksi kasir', value: daily.reduce((a, x) => a + num(x.orders), 0), type: 'int' },
      { label: 'Pendapatan layanan', value: svc, type: 'money' },
      { label: 'Penjualan suku cadang', value: prt, type: 'money' },
      { label: 'Margin suku cadang', value: partRows.reduce((a, x) => a + num(x.margin), 0), type: 'money' },
      { label: 'Tagihan armada (sebelum PPN)', value: fleet.reduce((a, x) => a + num(x.subtotal), 0), type: 'money' },
    ],
    sections: [
      { key: 'mekanik', title: 'Pendapatan layanan per mekanik', note: 'Dasar komisi: layanan di kasir yang mencatat mekanik (sebelum pajak).', columns: [{ key: 'mechanic', label: 'Mekanik' }, { key: 'jobs', label: 'Pekerjaan', type: 'int' }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'revenue', label: 'Pendapatan layanan', type: 'money' }], rows: byMechanic, empty: 'Belum ada layanan di kasir pada periode ini.' },
      { key: 'layanan', title: 'Layanan terlaris', columns: [{ key: 'sku', label: 'Kode' }, { key: 'name', label: 'Layanan' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'revenue', label: 'Pendapatan', type: 'money' }], rows: services, empty: 'Belum ada layanan terjual.' },
      { key: 'suku-cadang', title: 'Suku cadang terjual dan marginnya', columns: [{ key: 'sku', label: 'Kode' }, { key: 'name', label: 'Suku cadang' }, { key: 'qty', label: 'Jumlah', type: 'qty' }, { key: 'revenue', label: 'Penjualan', type: 'money' }, { key: 'cost', label: 'Harga pokok', type: 'money' }, { key: 'margin', label: 'Margin', type: 'money' }, { key: 'margin_pct', label: 'Margin %', type: 'pct' }], rows: partRows, empty: 'Belum ada suku cadang terjual.' },
      { key: 'harian', title: 'Kasir per periode', columns: [{ key: 'period', label: periodLabel(g) }, { key: 'orders', label: 'Transaksi', type: 'int' }, { key: 'services', label: 'Layanan', type: 'money' }, { key: 'parts', label: 'Suku cadang', type: 'money' }], rows: daily, empty: 'Belum ada transaksi kasir.' },
      { key: 'armada', title: 'Tagihan servis armada', columns: [{ key: 'number', label: 'Nomor' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'customer', label: 'Pelanggan' }, { key: 'subtotal', label: 'Sebelum PPN', type: 'money' }, { key: 'withholding_amount', label: 'PPh dipotong', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'open', label: 'Sisa', type: 'money' }, { key: 'due_date', label: 'Jatuh tempo', type: 'date' }], rows: fleet, empty: 'Belum ada tagihan armada pada periode ini.' },
      await revenueByAccount(c),
      { key: 'umur', title: 'Umur piutang pelanggan', note: `Per ${c.today}.`, columns: AGING_COLS, rows: await arAging(c) },
    ],
  };
};
