import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Dipakai oleh tax-controls.taxFindings */
export function queryTaxPayment(db: DbOrTx, tenantId: string, since: string, today: string) {
  return db.execute<{ number: string; type: string; period: string; v: string }>(sql`
    SELECT number, type, period, amount::text AS v FROM tax_payments
    WHERE tenant_id = ${tenantId} AND date >= ${since} AND date <= ${addDays(today, -7)} AND COALESCE(NULLIF(TRIM(ntpn), ''), '') = ''
    ORDER BY date DESC LIMIT 30`);
}

/** Dipakai oleh tax-controls.taxFindings */
export function queryJournalEntry(db: DbOrTx, tenantId: string, since: string) {
  return db.execute<{ number: string; d: string; acc: string }>(sql`
    SELECT DISTINCT j.number, j.date::text AS d, a.name AS acc
    FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
    WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since}
      AND COALESCE(a.system_key, '') IN ('VAT_IN', 'VAT_OUT', 'PPH21_PAYABLE', 'PPH23_PAYABLE', 'PPH4_2_PAYABLE', 'FINAL_TAX_WITHHELD')
    ORDER BY d DESC LIMIT 30`);
}

/** Dipakai oleh tax-controls.taxFindings */
export function queryPayrollRun(db: DbOrTx, tenantId: string, today: string) {
  return db.execute<{ period: string; withheld: string; paid: string }>(sql`
    SELECT r.period, r.total_pph21::text AS withheld,
      COALESCE((SELECT SUM(t.amount) FROM tax_payments t WHERE t.tenant_id = ${tenantId} AND t.type = 'PPH21' AND t.period = r.period), 0)::text AS paid
    FROM payroll_runs r
    WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.total_pph21 > 0
      AND ((r.period || '-01')::date + interval '1 month' + interval '9 days')::date < ${today}::date
    ORDER BY r.period DESC LIMIT 12`);
}
