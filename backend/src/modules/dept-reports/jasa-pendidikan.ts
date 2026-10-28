import { sql } from 'drizzle-orm';
import { revenueByAccount } from './jasa-shared';
import { Builder, num, rows } from './types';

/** Laporan pendidikan: SPP per kelas, tunggakan per wali, mutasi peserta, pendapatan per jenis */
export const jasaPendidikanReport: Builder = async (c) => {
  const p1 = c.from.slice(0, 7);
  const p2 = c.to.slice(0, 7);
  const classes = await rows(c, sql`
    SELECT k.code, k.name, k.monthly_fee, k.capacity,
      (SELECT COUNT(*) FROM edu_enrollments e WHERE e.class_id = k.id AND (e.left_on IS NULL OR e.left_on > ${c.to}::date) AND e.enrolled_on <= ${c.to}::date)::int AS students,
      COALESCE((SELECT SUM(f.amount) FROM edu_fee_invoices f JOIN edu_enrollments e ON e.id = f.enrollment_id WHERE e.class_id = k.id AND f.period BETWEEN ${p1} AND ${p2}), 0) AS billed
    FROM edu_classes k WHERE k.tenant_id = ${c.tenantId} ORDER BY k.is_active DESC, k.code`);
  const classRows = classes.map((k): Record<string, unknown> => ({ ...k, fill: num(k.capacity) > 0 ? Math.round((num(k.students) / num(k.capacity)) * 1000) / 10 : null }));
  const arrears = await rows(c, sql`
    WITH spp AS (SELECT DISTINCT i.id, i.customer_id, i.due_date, (i.total - i.paid_amount - i.returned_amount) AS open
                 FROM edu_fee_invoices f JOIN invoices i ON i.id = f.invoice_id WHERE f.tenant_id = ${c.tenantId} AND i.status <> 'PAID')
    SELECT cu.name AS customer, COUNT(*)::int AS invoices, SUM(open) AS open, MIN(due_date) AS oldest_due,
      GREATEST(0, ${c.today}::date - MIN(due_date))::int AS days,
      (SELECT string_agg(DISTINCT e.student_name, ', ') FROM edu_enrollments e WHERE e.customer_id = cu.id AND e.tenant_id = ${c.tenantId}) AS students
    FROM spp JOIN customers cu ON cu.id = spp.customer_id
    GROUP BY cu.id, cu.name HAVING SUM(open) > 0 ORDER BY MIN(due_date), SUM(open) DESC LIMIT 200`);
  const moves = await rows(c, sql`
    SELECT e.student_name AS student, k.name AS class, cu.name AS customer, e.enrolled_on AS date, 'Masuk' AS kind, e.discount_pct
    FROM edu_enrollments e JOIN edu_classes k ON k.id = e.class_id JOIN customers cu ON cu.id = e.customer_id
    WHERE e.tenant_id = ${c.tenantId} AND e.enrolled_on BETWEEN ${c.from}::date AND ${c.to}::date
    UNION ALL
    SELECT e.student_name, k.name, cu.name, e.left_on, 'Keluar', e.discount_pct
    FROM edu_enrollments e JOIN edu_classes k ON k.id = e.class_id JOIN customers cu ON cu.id = e.customer_id
    WHERE e.tenant_id = ${c.tenantId} AND e.left_on BETWEEN ${c.from}::date AND ${c.to}::date
    ORDER BY 4 LIMIT 300`);
  const [col] = await rows<{ billed: string; paid: string }>(c, sql`
    SELECT COALESCE(SUM(i.total), 0) AS billed, COALESCE(SUM(i.paid_amount), 0) AS paid
    FROM invoices i WHERE i.id IN (SELECT f.invoice_id FROM edu_fee_invoices f WHERE f.tenant_id = ${c.tenantId} AND f.period BETWEEN ${p1} AND ${p2})`);
  const open = arrears.reduce((a, x) => a + num(x.open), 0);
  return {
    kpis: [
      { label: 'Peserta aktif', value: classRows.reduce((a, k) => a + num(k.students), 0), type: 'int' },
      { label: 'SPP ditagih pada periode', value: col.billed, type: 'money' },
      { label: 'SPP terbayar dari tagihan periode', value: col.paid, type: 'money' },
      { label: 'Tunggakan (semua periode)', value: open, type: 'money', tone: open > 0 ? 'warn' : 'ok' },
      { label: 'Wali menunggak', value: arrears.filter((x) => num(x.days) > 0).length, type: 'int', tone: arrears.some((x) => num(x.days) > 0) ? 'warn' : 'ok' },
    ],
    sections: [
      { key: 'kelas', title: 'SPP per kelas', note: `SPP ditagih untuk periode ${p1}${p1 === p2 ? '' : ` s/d ${p2}`}.`, columns: [{ key: 'code', label: 'Kode' }, { key: 'name', label: 'Kelas' }, { key: 'monthly_fee', label: 'SPP / bulan', type: 'money' }, { key: 'students', label: 'Peserta', type: 'int' }, { key: 'capacity', label: 'Kapasitas', type: 'int' }, { key: 'fill', label: 'Keterisian', type: 'pct' }, { key: 'billed', label: 'SPP ditagih', type: 'money' }], rows: classRows, empty: 'Belum ada kelas.' },
      { key: 'tunggakan', title: 'Tunggakan per wali', note: `Tagihan SPP belum lunas per ${c.today}; hari = umur tagihan tertua sejak jatuh tempo.`, columns: [{ key: 'customer', label: 'Wali' }, { key: 'students', label: 'Peserta' }, { key: 'invoices', label: 'Tagihan', type: 'int' }, { key: 'open', label: 'Sisa', type: 'money' }, { key: 'oldest_due', label: 'Jatuh tempo tertua', type: 'date' }, { key: 'days', label: 'Hari lewat', type: 'int' }], rows: arrears, empty: 'Tidak ada tunggakan.' },
      { key: 'mutasi', title: 'Peserta masuk dan keluar', columns: [{ key: 'date', label: 'Tanggal', type: 'date' }, { key: 'kind', label: 'Mutasi' }, { key: 'student', label: 'Peserta' }, { key: 'class', label: 'Kelas' }, { key: 'customer', label: 'Wali' }, { key: 'discount_pct', label: 'Diskon', type: 'pct' }], rows: moves, empty: 'Tidak ada peserta masuk atau keluar pada periode ini.' },
      await revenueByAccount(c),
    ],
  };
};
