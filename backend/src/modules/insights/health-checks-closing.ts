import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { frameworkOf } from '../accounting/coa-sync';
import { rp } from './health-context';
import type { Check, HealthContext } from './health-context';
import type { Out0 } from './health-checks-ledger';

export async function closingChecks(c: HealthContext, prev: Out0) {
  const { deps, tenantId, asOf, yearStart, groupTotal, q, checks } = c;
  const { fp } = prev;
  // 13. Tutup buku tahun lalu
  const lastYear = Number(asOf.slice(0, 4)) - 1;
  const [closed] = await q<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'CLOSING' AND source_id = ${String(lastYear)}`,
  );
  // Jurnal saldo awal (mulai memakai SANSU) tidak perlu ditutup
  const [hadTx] = await q<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${`${lastYear}-01-01`} AND ${`${lastYear}-12-31`} AND j.source_type <> 'OPENING'
        AND NOT EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = j.id AND a.system_key = 'OPENING_EQUITY')`);
  if (hadTx.n) {
    checks.push({
      key: 'close-year',
      category: 'Kelengkapan',
      title: `Tutup buku ${lastYear}`,
      status: closed.n ? 'OK' : 'WARN',
      message: closed.n ? 'Sudah ditutup ke saldo laba' : `Tahun ${lastYear} memiliki transaksi tetapi belum ditutup.`,
      link: '/closing',
    });
  }

  // 14. Piutang macet > 90 hari
  const [overdue] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v, COUNT(*)::int AS n FROM invoices
      WHERE tenant_id = ${tenantId} AND status <> 'PAID' AND due_date < ${addDays(asOf, -90)}`);
  const allowance = groupTotal(['ALLOWANCE_RECEIVABLE']).negated();
  if ((await frameworkOf(deps.db, tenantId)) !== 'SAK_EMKM')
    checks.push({
      key: 'bad-debt',
      category: 'Kewajaran',
      title: 'Piutang lewat 90 hari sudah dicadangkan',
      status: D(overdue.v).gt(0) && allowance.lt(D(overdue.v)) ? 'WARN' : 'OK',
      message: D(overdue.v).gt(0)
        ? `${overdue.n} faktur senilai ${rp(D(overdue.v))} lewat 90 hari; cadangan kerugian saat ini ${rp(allowance)}. SAK EP mensyaratkan penurunan nilai bila ada bukti objektif.`
        : 'Tidak ada piutang lewat 90 hari',
      link: '/invoices',
    });

  // 15. Defisiensi modal
  const equity = D(fp.totals.equity.amount);
  checks.push({
    key: 'equity',
    category: 'Kewajaran',
    title: 'Ekuitas positif',
    status: equity.isNegative() ? 'ERROR' : 'OK',
    message: equity.isNegative()
      ? `Ekuitas negatif ${rp(equity)}: kewajiban melebihi aset (defisiensi modal).`
      : `Ekuitas ${rp(equity)}`,
  });

  // 16. Arus kas terekonsiliasi
  const cf = await deps.statements.cashFlow(tenantId, { from: yearStart, to: asOf });
  checks.push({
    key: 'cash-flow',
    category: 'Integritas',
    title: 'Laporan arus kas cocok dengan saldo kas',
    status: D(cf.current.difference).isZero() ? 'OK' : 'ERROR',
    message: D(cf.current.difference).isZero()
      ? 'Kenaikan kas di laporan = perubahan saldo kas & bank'
      : `Selisih ${rp(D(cf.current.difference))}`,
    link: '/reports?tab=position',
  });
  return { equity };
}

export type Out4 = Awaited<ReturnType<typeof closingChecks>>;
