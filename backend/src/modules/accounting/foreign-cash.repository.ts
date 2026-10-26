import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';

@Injectable()
export class ForeignCashRepository {
  /** Saldo valas dan nilai Rupiah tercatatnya untuk satu rekening bermata uang asing, sampai tanggal (kosong = seluruhnya) */
  queryPosition(db: DbOrTx, tenantId: string, accountId: string, asOf?: string) {
    return db.execute<{ foreign_bal: string; idr_bal: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN l.debit > 0 THEN l.foreign_amount ELSE -l.foreign_amount END), 0)::text AS foreign_bal,
             COALESCE(SUM(l.debit - l.credit), 0)::text AS idr_bal
      FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id
      WHERE e.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND (${asOf ?? null}::date IS NULL OR e.date <= ${asOf ?? null}::date)`);
  }

  /** Serialkan transaksi keluar per rekening agar dua pengeluaran bersamaan tidak sama-sama lolos kontrol saldo */
  queryLock(db: DbOrTx, accountId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-balance:${accountId}`}))`);
  }

  queryBlockNegative(db: DbOrTx, tenantId: string) {
    return db.execute<{ block: boolean | null }>(sql`SELECT (settings->'cashControl'->>'blockNegative')::boolean AS block FROM tenants WHERE id = ${tenantId}`);
  }

  /** Rekening kas/bank bermata uang asing beserta posisinya per tanggal */
  queryForeignAccounts(db: DbOrTx, tenantId: string, asOf: string) {
    return db.execute<{ id: string; code: string; name: string; currency: string; foreign_bal: string; idr_bal: string }>(sql`
      SELECT a.id, a.code, a.name, a.currency,
             COALESCE(SUM(CASE WHEN l.debit > 0 THEN l.foreign_amount ELSE -l.foreign_amount END), 0)::text AS foreign_bal,
             COALESCE(SUM(l.debit - l.credit), 0)::text AS idr_bal
      FROM accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries e ON e.id = l.journal_id AND e.date <= ${asOf}::date
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account AND a.currency <> 'IDR'
        AND (l.id IS NULL OR e.id IS NOT NULL)
      GROUP BY a.id ORDER BY a.code`);
  }
}
