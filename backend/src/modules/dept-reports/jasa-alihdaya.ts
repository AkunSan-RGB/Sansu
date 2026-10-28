import { sql } from 'drizzle-orm';
import { revenueByAccount } from './jasa-shared';
import { AGING_COLS, arAging } from './sales';
import { Builder, num, rows, spanDays } from './types';

/** Hari kerja per bulan untuk estimasi biaya petugas per hari jaga */
const WORK_DAYS = 25;

/** Laporan alih daya: margin per lokasi, keterisian per pos, hari jaga per petugas, tagihan kontrak */
export const jasaAlihDayaReport: Builder = async (c) => {
  const p1 = c.from.slice(0, 7);
  const p2 = c.to.slice(0, 7);
  const sites = await rows(c, sql`
    SELECT s.site_name, cu.name AS customer, s.title, s.is_active,
      (SELECT COALESCE(SUM(p.headcount), 0) FROM site_posts p WHERE p.contract_id = s.id)::int AS headcount,
      COALESCE((SELECT SUM(i.subtotal) FROM site_contract_invoices x JOIN invoices i ON i.id = x.invoice_id WHERE x.contract_id = s.id AND x.period BETWEEN ${p1} AND ${p2}), 0) AS billed,
      COALESCE((SELECT SUM(x.shortfall_head_days) FROM site_contract_invoices x WHERE x.contract_id = s.id AND x.period BETWEEN ${p1} AND ${p2}), 0) AS shortfall,
      (SELECT COUNT(*) FROM site_duty d JOIN site_posts p ON p.id = d.post_id WHERE p.contract_id = s.id AND d.duty_date BETWEEN ${c.from}::date AND ${c.to}::date)::int AS duty_days,
      COALESCE((SELECT SUM(e.base_salary / ${WORK_DAYS}) FROM site_duty d JOIN site_posts p ON p.id = d.post_id JOIN employees e ON e.id = d.employee_id
                WHERE p.contract_id = s.id AND d.duty_date BETWEEN ${c.from}::date AND ${c.to}::date), 0) AS est_cost
    FROM site_contracts s JOIN customers cu ON cu.id = s.customer_id WHERE s.tenant_id = ${c.tenantId}
    ORDER BY s.is_active DESC, s.site_name`);
  const siteRows = sites.map((s): Record<string, unknown> => ({ ...s, margin: num(s.billed) - num(s.est_cost), margin_pct: num(s.billed) > 0 ? Math.round(((num(s.billed) - num(s.est_cost)) / num(s.billed)) * 1000) / 10 : null }));
  const days = spanDays(c.from, c.to);
  const posts = await rows(c, sql`
    SELECT s.site_name, p.name AS post, p.service_kind, p.headcount, p.monthly_rate,
      (SELECT COUNT(*) FROM site_duty d WHERE d.post_id = p.id AND d.duty_date BETWEEN ${c.from}::date AND ${c.to}::date)::int AS assigned,
      (SELECT COUNT(*) FROM generate_series(GREATEST(${c.from}::date, s.start_date), LEAST(${c.to}::date, COALESCE(s.end_date, ${c.to}::date)), interval '1 day'))::int * p.headcount AS required
    FROM site_posts p JOIN site_contracts s ON s.id = p.contract_id WHERE p.tenant_id = ${c.tenantId} AND s.is_active ORDER BY s.site_name, p.name`);
  const KIND: Record<string, string> = { SECURITY: 'Keamanan', CLEANING: 'Kebersihan', OTHER: 'Lainnya' };
  const postRows = posts.map((p): Record<string, unknown> => ({ ...p, service_kind: KIND[String(p.service_kind)] ?? p.service_kind, fill: num(p.required) > 0 ? Math.round((num(p.assigned) / num(p.required)) * 1000) / 10 : null, gap: Math.max(0, num(p.required) - num(p.assigned)) }));
  const staff = await rows(c, sql`
    SELECT e.code, e.name, e.job_title AS position, COUNT(*)::int AS duty_days, COUNT(DISTINCT p.contract_id)::int AS sites, string_agg(DISTINCT s.site_name, ', ') AS where_
    FROM site_duty d JOIN employees e ON e.id = d.employee_id JOIN site_posts p ON p.id = d.post_id JOIN site_contracts s ON s.id = p.contract_id
    WHERE d.tenant_id = ${c.tenantId} AND d.duty_date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY e.id, e.code, e.name, e.job_title ORDER BY e.name`);
  const bills = await rows(c, sql`
    SELECT i.number, i.date, s.site_name, x.period, i.subtotal, x.shortfall_head_days, i.total, (i.total - i.paid_amount - i.returned_amount) AS open
    FROM site_contract_invoices x JOIN invoices i ON i.id = x.invoice_id JOIN site_contracts s ON s.id = x.contract_id
    WHERE x.tenant_id = ${c.tenantId} AND x.period BETWEEN ${p1} AND ${p2} ORDER BY x.period, s.site_name`);
  const need = postRows.reduce((a, p) => a + num(p.required), 0);
  const got = postRows.reduce((a, p) => a + num(p.assigned), 0);
  return {
    kpis: [
      { label: 'Kontrak lokasi aktif', value: sites.filter((s) => s.is_active).length, type: 'int' },
      { label: 'Tagihan kontrak (sebelum PPN)', value: siteRows.reduce((a, s) => a + num(s.billed), 0), type: 'money' },
      { label: 'Keterisian jaga', value: need > 0 ? Math.round((got / need) * 1000) / 10 : 0, type: 'pct', tone: need > 0 && got / need < 0.95 ? 'warn' : 'ok' },
      { label: 'Kekurangan dipotong (hari-orang)', value: siteRows.reduce((a, s) => a + num(s.shortfall), 0), type: 'qty' },
      { label: 'Hari dalam periode', value: days, type: 'int' },
    ],
    sections: [
      { key: 'margin-lokasi', title: 'Margin per lokasi', note: `Biaya petugas = estimasi gaji pokok per hari jaga (gaji pokok ÷ ${WORK_DAYS} hari × hari jaga); belum termasuk lembur, BPJS, dan perlengkapan.`, columns: [{ key: 'site_name', label: 'Lokasi' }, { key: 'customer', label: 'Pengguna jasa' }, { key: 'headcount', label: 'Petugas', type: 'int' }, { key: 'duty_days', label: 'Hari jaga', type: 'int' }, { key: 'billed', label: 'Ditagih', type: 'money' }, { key: 'shortfall', label: 'Potongan (hari-orang)', type: 'qty' }, { key: 'est_cost', label: 'Est. biaya petugas', type: 'money' }, { key: 'margin', label: 'Est. margin', type: 'money' }, { key: 'margin_pct', label: 'Margin', type: 'pct' }], rows: siteRows, empty: 'Belum ada kontrak lokasi.' },
      { key: 'pos', title: 'Keterisian per pos jaga', columns: [{ key: 'site_name', label: 'Lokasi' }, { key: 'post', label: 'Pos' }, { key: 'service_kind', label: 'Jenis' }, { key: 'headcount', label: 'Petugas/hari', type: 'int' }, { key: 'required', label: 'Dibutuhkan (hari-orang)', type: 'int' }, { key: 'assigned', label: 'Terjadwal', type: 'int' }, { key: 'gap', label: 'Kurang', type: 'int' }, { key: 'fill', label: 'Keterisian', type: 'pct' }], rows: postRows, empty: 'Belum ada pos jaga.' },
      { key: 'petugas', title: 'Hari jaga per petugas', columns: [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Petugas' }, { key: 'position', label: 'Jabatan' }, { key: 'duty_days', label: 'Hari jaga', type: 'int' }, { key: 'sites', label: 'Lokasi', type: 'int' }, { key: 'where_', label: 'Ditempatkan di' }], rows: staff, empty: 'Belum ada jadwal jaga pada periode ini.' },
      { key: 'tagihan', title: 'Tagihan kontrak', columns: [{ key: 'number', label: 'Nomor' }, { key: 'date', label: 'Tanggal', type: 'date' }, { key: 'site_name', label: 'Lokasi' }, { key: 'period', label: 'Periode' }, { key: 'subtotal', label: 'Sebelum PPN', type: 'money' }, { key: 'shortfall_head_days', label: 'Potongan (hari-orang)', type: 'qty' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'open', label: 'Sisa', type: 'money' }], rows: bills, empty: 'Belum ada tagihan kontrak pada periode ini.' },
      await revenueByAccount(c),
      { key: 'umur', title: 'Umur piutang pengguna jasa', note: `Per ${c.today}.`, columns: AGING_COLS.map((x) => (x.key === 'customer' ? { ...x, label: 'Pengguna jasa' } : x)), rows: await arAging(c) },
    ],
  };
};
