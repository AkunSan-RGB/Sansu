import { sql } from 'drizzle-orm';
import { Builder, grainOf, grainSql, num, periodLabel, rows } from './types';
import { AGING_COLS, arAging } from './sales';

export const jasaReport: Builder = async (c) => {
  const g = grainOf(c);
  const svc = sql`i.tenant_id = ${c.tenantId} AND i.date BETWEEN ${c.from}::date AND ${c.to}::date AND NOT i.is_opening`;
  const [bill] = await rows<{ dpp: string; n: string }>(c, sql`SELECT COALESCE(SUM(i.subtotal), 0) AS dpp, COUNT(*)::text AS n FROM invoices i WHERE ${svc}`);
  const [unbilled] = await rows<{ hours: string; amount: string }>(c, sql`SELECT COALESCE(SUM(hours), 0) AS hours, COALESCE(SUM(hours * rate), 0) AS amount FROM time_entries WHERE tenant_id = ${c.tenantId} AND status = 'APPROVED' AND billable AND invoice_id IS NULL`);
  const [deposits] = await rows<{ left: string }>(c, sql`SELECT COALESCE(SUM(amount - applied_amount), 0) AS left FROM customer_deposits WHERE tenant_id = ${c.tenantId} AND amount > applied_amount`);
  const retainers = await rows(c, sql`
    SELECT cu.name AS customer, r.title, r.monthly_fee, r.start_date, r.end_date, r.is_active,
      (SELECT MAX(x.period) FROM service_retainer_invoices x WHERE x.retainer_id = r.id) AS last_billed
    FROM service_retainers r JOIN customers cu ON cu.id = r.customer_id WHERE r.tenant_id = ${c.tenantId} ORDER BY r.is_active DESC, cu.name`);
  const thisMonth = c.today.slice(0, 7);
  const retainerRows = retainers.map((r) => ({ ...r, status: !r.is_active ? 'Nonaktif' : (r.last_billed ?? '') >= thisMonth ? 'Lengkap' : 'Ada periode belum ditagih' }));
  const behind = retainerRows.filter((r) => r.status === 'Ada periode belum ditagih').length;
  const byPeriod = await rows(c, sql`SELECT ${grainSql('i.date', g)} AS period, COUNT(*)::int AS invoices, SUM(i.subtotal) AS dpp, SUM(i.total) AS total FROM invoices i WHERE ${svc} GROUP BY 1 ORDER BY 1`);
  const projects = await rows(c, sql`
    SELECT p.code, p.name AS project, cu.name AS customer, p.status, p.contract_value,
      COALESCE((SELECT SUM(i.subtotal) FROM invoices i WHERE i.project_id = p.id AND i.tenant_id = ${c.tenantId}), 0) AS invoiced
    FROM projects p JOIN customers cu ON cu.id = p.customer_id WHERE p.tenant_id = ${c.tenantId} ORDER BY (p.status = 'ACTIVE') DESC, p.code LIMIT 200`);
  const projectRows = projects.map((p) => ({ ...p, pct: num(p.contract_value) > 0 ? Math.round((num(p.invoiced) / num(p.contract_value)) * 1000) / 10 : null, remaining: num(p.contract_value) - num(p.invoiced) }));
  const util = await rows(c, sql`
    SELECT e.name AS employee,
      COALESCE(SUM(t.hours) FILTER (WHERE t.status NOT IN ('REJECTED', 'WRITTEN_OFF')), 0) AS total_hours,
      COALESCE(SUM(t.hours) FILTER (WHERE t.billable AND t.status IN ('APPROVED', 'BILLED')), 0) AS billable_hours,
      COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'BILLED'), 0) AS billed,
      COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'APPROVED'), 0) AS approved_unbilled
    FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${c.tenantId} AND t.work_date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY e.name ORDER BY 2 DESC`);
  const unbilledBy = await rows(c, sql`SELECT cu.name AS customer, COUNT(*)::int AS entries, SUM(t.hours) AS hours, SUM(t.hours * t.rate) AS amount, MIN(t.work_date) AS oldest FROM time_entries t JOIN customers cu ON cu.id = t.customer_id WHERE t.tenant_id = ${c.tenantId} AND t.status = 'APPROVED' AND t.billable AND t.invoice_id IS NULL GROUP BY cu.name ORDER BY MIN(t.work_date)`);
  const depositRows = await rows(c, sql`SELECT cu.name AS customer, COUNT(*)::int AS deposits, SUM(d.amount) AS amount, SUM(d.amount - d.applied_amount) AS remaining FROM customer_deposits d JOIN customers cu ON cu.id = d.customer_id WHERE d.tenant_id = ${c.tenantId} AND d.amount > d.applied_amount GROUP BY cu.name ORDER BY SUM(d.amount - d.applied_amount) DESC`);
  const aging = await arAging(c);
  return {
    kpis: [
      { label: 'Tagihan jasa (sebelum PPN)', value: bill.dpp, type: 'money' }, { label: 'Jumlah tagihan', value: num(bill.n), type: 'int' },
      { label: 'Jam disetujui belum ditagih', value: unbilled.hours, type: 'hours', tone: num(unbilled.hours) > 0 ? 'warn' : 'ok' }, { label: 'Nilai belum ditagih', value: unbilled.amount, type: 'money', tone: num(unbilled.amount) > 0 ? 'warn' : 'ok' },
      { label: 'Retainer dengan periode belum ditagih', value: behind, type: 'int', tone: behind ? 'warn' : 'ok' }, { label: 'Uang muka klien tersisa', value: deposits.left, type: 'money' },
    ],
    sections: [
      { key: 'proyek', title: 'Proyek', note: 'Ditagih = jumlah tagihan proyek (sebelum PPN) dibanding nilai kontrak.', columns: [{ key: 'code', label: 'Kode' }, { key: 'project', label: 'Proyek' }, { key: 'customer', label: 'Klien' }, { key: 'status', label: 'Status' }, { key: 'contract_value', label: 'Nilai kontrak', type: 'money' }, { key: 'invoiced', label: 'Ditagih', type: 'money' }, { key: 'pct', label: '% ditagih', type: 'pct' }, { key: 'remaining', label: 'Sisa kontrak', type: 'money' }], rows: projectRows },
      { key: 'belum-ditagih', title: 'Jam belum ditagih', note: 'Jam yang sudah disetujui tetapi belum masuk tagihan: pendapatan yang tertunda.', columns: [{ key: 'customer', label: 'Klien' }, { key: 'entries', label: 'Catatan', type: 'int' }, { key: 'hours', label: 'Jam', type: 'hours' }, { key: 'amount', label: 'Nilai', type: 'money' }, { key: 'oldest', label: 'Tertua', type: 'date' }], rows: unbilledBy, empty: 'Semua jam disetujui sudah ditagih' },
      { key: 'utilisasi', title: 'Utilisasi karyawan', note: 'Jam dicatat dalam rentang tanggal; dapat ditagih = jam disetujui atau sudah ditagih.', columns: [{ key: 'employee', label: 'Karyawan' }, { key: 'total_hours', label: 'Jam dicatat', type: 'hours' }, { key: 'billable_hours', label: 'Jam dapat ditagih', type: 'hours' }, { key: 'billed', label: 'Tertagih', type: 'money' }, { key: 'approved_unbilled', label: 'Belum ditagih', type: 'money' }], rows: util },
      { key: 'retainer', title: 'Retainer', columns: [{ key: 'customer', label: 'Klien' }, { key: 'title', label: 'Layanan' }, { key: 'monthly_fee', label: 'Per bulan', type: 'money' }, { key: 'start_date', label: 'Mulai', type: 'date' }, { key: 'last_billed', label: 'Periode terakhir ditagih' }, { key: 'status', label: 'Status' }], rows: retainerRows, empty: 'Belum ada retainer' },
      { key: 'periode', title: 'Tagihan per periode', columns: [{ key: 'period', label: periodLabel(g) }, { key: 'invoices', label: 'Tagihan', type: 'int' }, { key: 'dpp', label: 'Sebelum PPN', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows: byPeriod },
      { key: 'uang-muka', title: 'Uang muka klien', columns: [{ key: 'customer', label: 'Klien' }, { key: 'deposits', label: 'Uang muka', type: 'int' }, { key: 'amount', label: 'Diterima', type: 'money' }, { key: 'remaining', label: 'Belum dipakai', type: 'money' }], rows: depositRows, empty: 'Tidak ada uang muka tersisa' },
      { key: 'umur', title: 'Umur piutang klien', note: `Per ${c.today}.`, columns: AGING_COLS.map((x) => (x.key === 'customer' ? { ...x, label: 'Klien' } : x)), rows: aging },
    ],
  };
};
