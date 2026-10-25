import { sql } from 'drizzle-orm';
import { addDays, diffDays, todayJakarta } from '../../common/utils/dates';
import type { Check, HealthContext } from './health-context';

export async function controlChecks(c: HealthContext) {
  const { deps, tenantId, q, checks } = c;
  // 12. Kunci periode
  const locked = await deps.period.lockedUntil(deps.db, tenantId);
  const prevMonthEnd = addDays(`${todayJakarta().slice(0, 7)}-01`, -1);
  const lockLate = (!locked || locked < prevMonthEnd) && diffDays(prevMonthEnd, todayJakarta()) > 15;
  checks.push({
    key: 'lock',
    category: 'Kepatuhan',
    title: 'Periode bulan lalu sudah dikunci',
    status: lockLate ? 'WARN' : 'OK',
    message: lockLate
      ? `Periode s/d ${prevMonthEnd} belum dikunci. Laporan yang sudah dilaporkan bisa berubah bila transaksi lama diedit.`
      : locked
        ? `Terkunci s/d ${locked}`
        : 'Belum perlu dikunci',
    link: '/closing',
  });

  // 12a. Saldo awal: dicatat jauh setelah transaksi berjalan, atau berkali-kali, mengubah seluruh neraca
  const [ob] = await q<{ n: number; late: number; first_created: string | null; last_created: string | null }>(sql`
      SELECT COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE j.created_at > (SELECT MIN(x.created_at) FROM journal_entries x WHERE x.tenant_id = ${tenantId} AND x.source_type NOT IN ('OPENING', 'CLOSING')) + interval '14 days')::int AS late,
        MIN(j.date)::text AS first_created, MAX(j.date)::text AS last_created
      FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'OPENING' AND j.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)`);
  if (ob.n > 0) {
    const issues: string[] = [];
    if (ob.late > 0)
      issues.push(`${ob.late} jurnal saldo awal dicatat lebih dari 14 hari setelah transaksi pertama berjalan`);
    if (ob.n > 2) issues.push(`Saldo awal dicatat ${ob.n} kali (tanggal ${ob.first_created} s/d ${ob.last_created})`);
    checks.push({
      key: 'opening-balance',
      category: 'Kewajaran',
      title: 'Saldo awal dicatat wajar',
      status: issues.length ? 'WARN' : 'OK',
      message: issues.length
        ? `${issues.join('; ')}. Saldo awal mengubah seluruh neraca; pastikan sesuai neraca penutup sistem lama dan penyeimbang Ekuitas Saldo Awal wajar.`
        : 'Saldo awal dicatat sebelum transaksi berjalan',
      link: '/opening-balance',
    });
  }

  // 12b. Pemisahan fungsi: yang memegang uang (Keuangan) berbeda dari yang membukukan (Akuntan)
  const roleRows = await q<{ role: string; n: number }>(
    sql`SELECT role::text AS role, COUNT(*)::int AS n FROM users WHERE tenant_id = ${tenantId} AND is_active GROUP BY role`,
  );
  const nRole = (r: string) => roleRows.find((x) => x.role === r)?.n ?? 0;
  const sod =
    nRole('FINANCE') > 0 && nRole('ACCOUNTANT') === 0
      ? {
          status: 'INFO' as const,
          message:
            'Belum ada pengguna Akuntan: Pemilik/Admin bertindak sebagai akuntan (jurnal manual, kunci periode, tutup buku, posting gaji) dan sistem mengerjakan pembukuan rutin otomatis. Tetapkan peran Akuntan bila tim bertambah agar pemegang uang dan pembukuan terpisah.',
        }
      : nRole('FINANCE') > 0
        ? { status: 'OK' as const, message: 'Pemegang uang (Keuangan) dan pembukuan (Akuntan) dipegang orang berbeda' }
        : {
            status: 'INFO' as const,
            message:
              nRole('ACCOUNTANT') > 0
                ? 'Belum ada pengguna Keuangan: uang dipegang Pemilik/Admin, pembukuan oleh Akuntan.'
                : 'Pemilik/Admin memegang uang sekaligus pembukuan. Wajar untuk usaha kecil; sistem mengerjakan pembukuan rutin otomatis. Tambahkan peran Keuangan dan Akuntan saat tim bertambah.',
          };
  checks.push({
    key: 'sod-roles',
    category: 'Kepatuhan',
    title: 'Pemisahan fungsi: Keuangan dan Akuntan',
    ...sod,
    link: '/settings/users',
  });
  // pekerjaan pembukuan rutin yang dikerjakan sistem (Pengaturan › Pembukuan otomatis)
  const [autoRow] = await q<{ a: Record<string, unknown> | null }>(
    sql`SELECT settings->'autoBookkeeping' AS a FROM tenants WHERE id = ${tenantId}`,
  );
  const auto = { payroll: true, fx: true, lock: false, closeYear: false, ...(autoRow?.a ?? {}) } as Record<
    string,
    boolean
  >;
  const manual = [!auto.lock && 'kunci periode', !auto.closeYear && 'tutup buku'].filter(Boolean) as string[];
  checks.push({
    key: 'auto-bookkeeping',
    category: 'Kepatuhan',
    title: 'Pembukuan otomatis',
    status: manual.length && nRole('ACCOUNTANT') === 0 ? 'INFO' : 'OK',
    message: manual.length
      ? `Otomatis: penyusutan, jurnal berulang${auto.payroll ? ', posting gaji' : ''}${auto.fx ? ', penilaian ulang valas' : ''}. Belum otomatis: ${manual.join(' dan ')}${nRole('ACCOUNTANT') === 0 ? ' (tanpa Akuntan, sebaiknya dinyalakan di Pengaturan › Pembukuan otomatis)' : ''}.`
      : 'Penyusutan, jurnal berulang, posting gaji, penilaian ulang valas, kunci periode, dan tutup buku berjalan otomatis',
    link: '/closing',
  });
  // peran yang saling mengawasi tidak boleh sekadar dipertukarkan orang yang sama (menutupi penyimpangan)
  const hops = await q<{ name: string; from: string; to: string; at: string }>(sql`
      SELECT u.name, a.data->>'previousRole' AS "from", a.data->>'role' AS "to", to_char(a.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS at
      FROM audit_logs a JOIN users u ON u.id::text = a.entity_id AND u.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} AND a.entity = 'User' AND a.action = 'UPDATE' AND a.created_at > now() - interval '180 days'
        AND ((a.data->>'previousRole' = 'FINANCE' AND a.data->>'role' = 'ACCOUNTANT') OR (a.data->>'previousRole' = 'ACCOUNTANT' AND a.data->>'role' = 'FINANCE'))
      ORDER BY a.created_at DESC LIMIT 5`);
  const roleName = (r: string) => (r === 'FINANCE' ? 'Keuangan' : 'Akuntan');
  checks.push({
    key: 'sod-role-change',
    category: 'Kepatuhan',
    title: 'Tidak ada pengguna berpindah antara Keuangan dan Akuntan',
    status: hops.length ? 'WARN' : 'OK',
    message: hops.length
      ? `${hops.length} perpindahan dalam 180 hari terakhir. Orang yang sama memegang uang lalu pembukuan (atau sebaliknya) bisa menutupi penyimpangan; tinjau transaksi yang dibuatnya di jejak audit.`
      : 'Tidak ada perpindahan peran dalam 180 hari terakhir',
    detail: hops.map((h) => ({ label: `${h.name} (${h.at})`, value: `${roleName(h.from)} → ${roleName(h.to)}` })),
    link: '/settings/audit',
  });
  return {};
}

export type Out3 = Awaited<ReturnType<typeof controlChecks>>;
