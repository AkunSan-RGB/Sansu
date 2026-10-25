import { taxDeadline } from '@sansu/shared';
import { taxProfileOf } from '../../common/settings.service';
import { sql } from 'drizzle-orm';
import { addDays, diffDays, todayJakarta } from '../../common/utils/dates';
import type { Check, HealthContext } from './health-context';

export async function journalChecks(c: HealthContext) {
  const { deps, tenantId, asOf, yearStart, q, checks } = c;
  // 10. Jurnal manual tanpa nomor bukti
  const [noRef] = await q<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = ${tenantId} AND source_type IN ('MANUAL', 'ADJUSTMENT') AND reversal_of_id IS NULL
        AND (reference IS NULL OR reference = '') AND date BETWEEN ${yearStart} AND ${asOf}`);
  checks.push({
    key: 'no-reference',
    category: 'Kepatuhan',
    title: 'Jurnal manual memiliki nomor bukti',
    status: noRef.n ? 'WARN' : 'OK',
    message: noRef.n
      ? `${noRef.n} jurnal manual tahun ini tanpa nomor bukti. Auditor & pemeriksa pajak meminta bukti untuk setiap jurnal.`
      : 'Semua jurnal manual berbukti',
    link: '/journals',
  });

  // 11. Jurnal bertanggal di masa depan
  const [future] = await q<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND date > ${todayJakarta()}`,
  );
  checks.push({
    key: 'future',
    category: 'Kewajaran',
    title: 'Tidak ada transaksi bertanggal di masa depan',
    status: future.n ? 'WARN' : 'OK',
    message: future.n
      ? `${future.n} jurnal bertanggal setelah hari ini — kemungkinan salah ketik tahun.`
      : 'Tanggal transaksi wajar',
    link: '/journals',
  });

  // 11b. Rekonsiliasi bank: mutasi rekening koran yang belum dicocokkan / belum pernah diimpor
  const bankRows = await q<{
    code: string;
    name: string;
    last_date: string | null;
    unmatched: number;
    book_n: number;
  }>(sql`
      SELECT a.code, a.name, MAX(l.date)::text AS last_date,
             COUNT(l.id) FILTER (WHERE l.status = 'UNMATCHED' AND l.date <= ${asOf})::int AS unmatched,
             (SELECT COUNT(*)::int FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
               WHERE jl.account_id = a.id AND je.date <= ${asOf}) AS book_n
      FROM accounts a
      LEFT JOIN bank_statements s ON s.cash_account_id = a.id
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true AND a.system_key IS DISTINCT FROM 'CASH'
        AND a.name NOT ILIKE '%kas kecil%'
      GROUP BY a.id ORDER BY a.code`);
  const banks = bankRows.filter((b) => b.book_n > 0);
  if (banks.length) {
    const unmatched = banks.reduce((n, b) => n + b.unmatched, 0);
    const stale = banks.filter((b) => !b.last_date || diffDays(b.last_date, asOf) > 40);
    checks.push({
      key: 'bank-recon',
      category: 'Rekonsiliasi',
      title: 'Rekening bank direkonsiliasi dengan rekening koran',
      status: unmatched ? 'WARN' : stale.length ? 'WARN' : 'OK',
      message: unmatched
        ? `${unmatched} mutasi bank belum cocok dengan transaksi di buku.`
        : stale.length
          ? `Mutasi rekening ${stale.map((b) => b.name).join(', ')} belum diimpor ${stale.some((b) => b.last_date) ? 'lebih dari 40 hari' : 'sama sekali'}.`
          : 'Semua mutasi bank sudah cocok dengan buku',
      detail: banks.map((b) => ({
        label: `${b.code} ${b.name}`,
        value: b.last_date ? `mutasi s/d ${b.last_date}, ${b.unmatched} belum cocok` : 'belum pernah diimpor',
      })),
      link: '/bank',
    });
  }

  // 11c. Setoran pajak masa lalu yang terlewat (PPh 21 / PPN)
  const prevPeriod = addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7);
  const prevPrev = addDays(`${prevPeriod}-01`, -1).slice(0, 7);
  const missedTax: string[] = [];
  const holidays =
    taxProfileOf(
      (
        await q<{ settings: Record<string, unknown> | null }>(sql`SELECT settings FROM tenants WHERE id = ${tenantId}`)
      )[0]?.settings,
    ).holidays ?? [];
  for (const [type, key, period, label] of [
    ['PPH21', 'PPH21_PAYABLE', prevPeriod, 'PPh 21'],
    ['PPN', 'VAT_OUT', prevPrev, 'PPN'],
  ] as const) {
    const due = taxDeadline(type, period, holidays);
    if (asOf <= due) continue;
    const [acc] = await q<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND a.system_key = ${key} AND l.credit > 0 AND j.source_type <> 'TAX_PAYMENT'
          AND j.date BETWEEN ${`${period}-01`} AND ${addDays(`${addDays(`${period}-28`, 10).slice(0, 7)}-01`, -1)}`);
    const [paid] = await q<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period = ${period}`,
    );
    if (acc.n && !paid.n) missedTax.push(`${label} masa ${period}`);
  }
  checks.push({
    key: 'tax-payments',
    category: 'Kepatuhan',
    title: 'Setoran pajak tepat waktu',
    status: missedTax.length ? 'WARN' : 'OK',
    message: missedTax.length
      ? `Belum ada catatan setoran: ${missedTax.join(', ')}. Lewat jatuh tempo bisa kena sanksi bunga.`
      : 'Setoran PPh 21 & PPN masa sebelumnya sudah dicatat',
    link: '/tax',
  });

  // Ambang pajak: batas PKP / PPh final Rp4,8 miliar, fasilitas Pasal 31E, kriteria UMKM
  for (const a of (await deps.thresholds.evaluate(tenantId, asOf)).alerts) {
    checks.push({
      key: `threshold-${a.key}`,
      category: 'Kepatuhan',
      title: a.title,
      status: a.level,
      message: a.message,
      link: a.link,
    });
  }
  return {};
}

export type Out2 = Awaited<ReturnType<typeof journalChecks>>;
