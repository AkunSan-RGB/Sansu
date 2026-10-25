import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, inArray } from 'drizzle-orm';
import { journalLines, accounts } from '../../db/schema';
import { SystemKey } from './default-coa';

/** Akses data untuk Posting: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PostingRepository {
  /** Dipakai oleh PostingService.post */
  queryProject(db: DbOrTx, tenantId: string, pids: string[]) {
    return db.execute(
      sql`SELECT id FROM projects WHERE tenant_id = ${tenantId} AND id IN (${sql.join(
        pids.map((p) => sql`${p}`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh PostingService.post */
  queryBranche(db: DbOrTx, tenantId: string, explicit: string[]) {
    return db.execute(
      sql`SELECT id FROM branches WHERE tenant_id = ${tenantId} AND id IN (${sql.join(
        explicit.map((b) => sql`${b}`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh PostingService.deriveBranch */
  queryBrancheForDeriveBranch(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM branches WHERE tenant_id = ${tenantId} LIMIT 1`);
  }

  /** Dipakai oleh PostingService.reverse */
  insertJournalLines(db: DbOrTx, lines: (typeof journalLines.$inferSelect)[], id: string) {
    return db
      .insert(journalLines)
      .values(
        lines.map((l) => ({
          journalId: id,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          memo: l.memo,
          projectId: l.projectId,
          branchId: l.branchId,
        })),
      )
      .returning();
  }

  /** Dipakai oleh PostingService.assertCashNotCounted */
  queryCashCount(db: DbOrTx, tenantId: string, date: string, ids: string[]) {
    return db.execute<{ number: string; date: string; name: string }>(sql`
      SELECT c.number, c.date::text AS date, a.name FROM cash_counts c JOIN accounts a ON a.id = c.account_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.date >= ${date}
        AND c.account_id = ANY(${`{${ids.join(',')}}`}::uuid[])
      ORDER BY c.date DESC LIMIT 1`);
  }

  /** Dipakai oleh PostingService.resolveCashAccount */
  findAccountsBySystemKey(db: DbOrTx, tenantId: string, fallback: 'CASH' | 'BANK') {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, fallback)));
  }

  /** Dipakai oleh PostingService.assertCashCovers */
  queryTenant(db: DbOrTx, tenantId: string) {
    return db.execute<{ block: boolean | null }>(
      sql`SELECT (settings->'cashControl'->>'blockNegative')::boolean AS block FROM tenants WHERE id = ${tenantId}`,
    );
  }

  /** Dipakai oleh PostingService.assertCashCovers */
  queryAssertCashCovers(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-balance:${id}`}))`);
  }

  /** Dipakai oleh PostingService.assertCashCovers */
  queryJournalLine(db: DbOrTx, id: string) {
    return db.execute<{ bal: string }>(
      sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${id}`,
    );
  }

  /** Dipakai oleh PostingService.ensureSystemAccounts */
  listAccountsBySystemKey(db: DbOrTx, tenantId: string, keys: SystemKey[]) {
    return db
      .select({ systemKey: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.systemKey, keys)));
  }

  /** Dipakai oleh PostingService.ensureSystemAccounts */
  listAccountsByCode(db: DbOrTx, tenantId: string, parent: string) {
    return db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, parent)));
  }

  /** Dipakai oleh PostingService.ensureSystemAccounts */
  findAccountsByCode(db: DbOrTx, tenantId: string, code: string) {
    return db
      .select({ id: accounts.id, systemKey: accounts.systemKey, type: accounts.type, isPostable: accounts.isPostable })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code)));
  }

  /** Dipakai oleh PostingService.ensureSystemAccounts */
  insertAccounts(
    db: DbOrTx,
    tenantId: string,
    sameCode: {
      id: string;
      systemKey: string | null;
      type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
      isPostable: boolean;
    },
    code: string,
    name: string,
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE',
    parent: { id: string },
    key: SystemKey,
    cash: boolean | undefined,
  ) {
    return db.insert(accounts).values({
      tenantId: tenantId,
      code: sameCode ? `${code}-S` : code,
      name: name,
      type: type,
      parentId: parent?.id,
      systemKey: key,
      isCashAccount: !!cash,
    });
  }
}
