import { sql } from 'drizzle-orm';
import { Builder, num, rows } from './types';
import { AGING_COLS, arAging } from './sales';

export const fmcgReport: Builder = async (c) => {
  const inv = sql`i.tenant_id = ${c.tenantId} AND i.date BETWEEN ${c.from}::date AND ${c.to}::date AND NOT i.is_opening`;
  const pFrom = c.from.slice(0, 7);
  const pTo = c.to.slice(0, 7);
  const [tot] = await rows<{ dpp: string; n: string }>(c, sql`SELECT COALESCE(SUM(i.subtotal), 0) AS dpp, COUNT(*)::text AS n FROM invoices i WHERE ${inv}`);
  const bySales = await rows(c, sql`SELECT COALESCE(u.name, '(tanpa sales)') AS salesperson, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total) AS total FROM invoices i LEFT JOIN sales_orders so ON so.id = i.sales_order_id LEFT JOIN users u ON u.id = so.salesperson_id WHERE ${inv} GROUP BY 1 ORDER BY SUM(i.subtotal) DESC`);
  const byOutlet = await rows(c, sql`SELECT cu.name AS outlet, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total - i.paid_amount - i.returned_amount) AS outstanding FROM invoices i JOIN customers cu ON cu.id = i.customer_id WHERE ${inv} GROUP BY cu.name ORDER BY SUM(i.subtotal) DESC LIMIT 200`);
  const commissions = await rows(c, sql`SELECT k.number, u.name AS salesperson, k.period, k.net_sales, k.target_amount, k.commission_pct, k.amount, k.status FROM sales_commissions k JOIN users u ON u.id = k.user_id WHERE k.tenant_id = ${c.tenantId} AND k.period BETWEEN ${pFrom} AND ${pTo} AND k.status <> 'VOID' ORDER BY k.period DESC, u.name LIMIT 200`);
  const promos = await rows(c, sql`SELECT COALESCE(pr.name, '(tanpa promo)') AS promo, COUNT(DISTINCT so.id)::int AS orders, SUM(l.qty * l.uom_factor) AS bonus_qty FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id LEFT JOIN promos pr ON pr.id = l.promo_id WHERE so.tenant_id = ${c.tenantId} AND l.is_bonus AND so.status <> 'CANCELLED' AND so.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY 1 ORDER BY SUM(l.qty * l.uom_factor) DESC`);
  const claims = await rows(c, sql`SELECT k.number, s.name AS principal, k.period, k.claimed_amount, k.approved_amount, k.status FROM principal_claims k JOIN suppliers s ON s.id = k.supplier_id WHERE k.tenant_id = ${c.tenantId} AND k.period BETWEEN ${pFrom} AND ${pTo} ORDER BY k.period DESC LIMIT 100`);
  const canvass = await rows(c, sql`SELECT u.name AS salesperson, COUNT(*)::int AS collections, SUM(k.amount) AS amount, SUM(COALESCE(k.received_amount, 0)) AS received, SUM(COALESCE(k.shortage, 0)) AS shortage FROM canvass_collections k JOIN users u ON u.id = k.user_id WHERE k.tenant_id = ${c.tenantId} AND k.date BETWEEN ${c.from}::date AND ${c.to}::date AND k.status <> 'REJECTED' GROUP BY u.name ORDER BY SUM(k.amount) DESC`);
  const swaps = await rows(c, sql`SELECT g.number, g.date, cu.name AS outlet, g.reason, g.cost_amount, g.status FROM goods_swaps g JOIN customers cu ON cu.id = g.customer_id WHERE g.tenant_id = ${c.tenantId} AND g.date BETWEEN ${c.from}::date AND ${c.to}::date ORDER BY g.date DESC LIMIT 100`);
  const consign = await rows(c, sql`SELECT d.kind, d.status, COUNT(*)::int AS docs FROM consignment_docs d WHERE d.tenant_id = ${c.tenantId} AND d.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY d.kind, d.status ORDER BY d.kind, d.status`);
  const aging = await arAging(c);
  const commissionTotal = commissions.reduce((a, r) => a + num(r.amount), 0);
  return {
    kpis: [{ label: 'Penjualan (sebelum PPN)', value: tot.dpp, type: 'money' }, { label: 'Jumlah faktur', value: num(tot.n), type: 'int' }, { label: 'Komisi sales periode ini', value: commissionTotal, type: 'money' }, { label: 'Bonus barang (satuan dasar)', value: promos.reduce((a, r) => a + num(r.bonus_qty), 0), type: 'qty' }],
    sections: [
      { key: 'sales', title: 'Per sales', columns: [{ key: 'salesperson', label: 'Sales' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Penjualan', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: bySales },
      { key: 'outlet', title: 'Per outlet', columns: [{ key: 'outlet', label: 'Outlet' }, { key: 'invoices', label: 'Faktur', type: 'int' }, { key: 'dpp', label: 'Penjualan', type: 'money' }, { key: 'outstanding', label: 'Sisa piutang', type: 'money' }], rows: byOutlet },
      { key: 'komisi', title: 'Komisi sales', note: 'Periode bulanan dalam rentang tanggal.', columns: [{ key: 'number', label: 'Nomor' }, { key: 'salesperson', label: 'Sales' }, { key: 'period', label: 'Periode' }, { key: 'net_sales', label: 'Penjualan bersih', type: 'money' }, { key: 'target_amount', label: 'Target', type: 'money' }, { key: 'commission_pct', label: 'Komisi %', type: 'pct' }, { key: 'amount', label: 'Komisi', type: 'money' }, { key: 'status', label: 'Status' }], rows: commissions },
      { key: 'promo', title: 'Bonus barang per promo', columns: [{ key: 'promo', label: 'Promo' }, { key: 'orders', label: 'Pesanan', type: 'int' }, { key: 'bonus_qty', label: 'Bonus (satuan dasar)', type: 'qty' }], rows: promos },
      { key: 'klaim', title: 'Klaim prinsipal', columns: [{ key: 'number', label: 'Klaim' }, { key: 'principal', label: 'Prinsipal' }, { key: 'period', label: 'Periode' }, { key: 'claimed_amount', label: 'Diklaim', type: 'money' }, { key: 'approved_amount', label: 'Disetujui', type: 'money' }, { key: 'status', label: 'Status' }], rows: claims },
      { key: 'kanvas', title: 'Setoran kanvas', note: 'Selisih setoran = uang yang seharusnya disetor dikurangi yang diterima.', columns: [{ key: 'salesperson', label: 'Sales' }, { key: 'collections', label: 'Setoran', type: 'int' }, { key: 'amount', label: 'Seharusnya', type: 'money' }, { key: 'received', label: 'Diterima', type: 'money' }, { key: 'shortage', label: 'Kurang', type: 'money' }], rows: canvass },
      { key: 'tukar', title: 'Tukar-guling', columns: [{ key: 'number', label: 'Nomor' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'outlet', label: 'Outlet' }, { key: 'reason', label: 'Alasan' }, { key: 'cost_amount', label: 'Harga pokok', type: 'money' }, { key: 'status', label: 'Status' }], rows: swaps },
      { key: 'konsinyasi', title: 'Konsinyasi', columns: [{ key: 'kind', label: 'Jenis' }, { key: 'status', label: 'Status' }, { key: 'docs', label: 'Dokumen', type: 'int' }], rows: consign },
      { key: 'umur', title: 'Umur piutang outlet', note: `Per ${c.today}.`, columns: AGING_COLS.map((x) => (x.key === 'customer' ? { ...x, label: 'Outlet' } : x)), rows: aging },
    ],
  };
};
