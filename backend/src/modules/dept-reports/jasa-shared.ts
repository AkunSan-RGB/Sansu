import { sql } from 'drizzle-orm';
import { Ctx, rows, type Section } from './types';

/** Pendapatan per akun pada periode (dari buku besar): menunjukkan porsi tiap jenis layanan */
export async function revenueByAccount(c: Ctx): Promise<Section> {
  const r = await rows(c, sql`
    SELECT a.code, a.name, SUM(l.credit - l.debit) AS amount
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE j.tenant_id = ${c.tenantId} AND a.type = 'REVENUE' AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION') AND j.date BETWEEN ${c.from}::date AND ${c.to}::date
    GROUP BY a.code, a.name HAVING SUM(l.credit - l.debit) <> 0 ORDER BY a.code`);
  const total = r.reduce((a, x) => a + Number(x.amount ?? 0), 0);
  return {
    key: 'pendapatan-jenis',
    title: 'Pendapatan per jenis',
    note: 'Dari buku besar: tiap jenis layanan dibukukan ke akun pendapatannya sendiri.',
    columns: [{ key: 'code', label: 'Akun' }, { key: 'name', label: 'Jenis pendapatan' }, { key: 'amount', label: 'Jumlah', type: 'money' }, { key: 'share', label: 'Porsi', type: 'pct' }],
    rows: r.map((x) => ({ ...x, share: total ? Math.round((Number(x.amount) / total) * 1000) / 10 : null })),
    empty: 'Belum ada pendapatan pada periode ini.',
  };
}
