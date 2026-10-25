import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { budgets, budgetLines, accounts, budgetAlerts, users } from '../../db/schema';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { SaveBudgetDto } from './budget.dto';

/** Akses data untuk Budget: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BudgetRepository {
  /** Dipakai oleh BudgetService.find */
  findBudgetsByYear(db: DbOrTx, tenantId: string, year: number) {
    return db
      .select()
      .from(budgets)
      .where(and(eq(budgets.tenantId, tenantId), eq(budgets.year, year)));
  }

  /** Dipakai oleh BudgetService.get */
  listBudgetLinesByBudgetId(db: DbOrTx, id: string) {
    return db.select().from(budgetLines).where(eq(budgetLines.budgetId, id));
  }

  /** Dipakai oleh BudgetService.save */
  findBudgetsByYearForSave(db: DbOrTx, tenantId: string, year: number) {
    return db
      .select()
      .from(budgets)
      .where(and(eq(budgets.tenantId, tenantId), eq(budgets.year, year)))
      .for('update');
  }

  /** Dipakai oleh BudgetService.save */
  insertBudgets(db: DbOrTx, tenantId: string, year: number, dto: SaveBudgetDto, sub: string) {
    return db
      .insert(budgets)
      .values({
        tenantId: tenantId,
        year: year,
        name: dto.name?.trim() || `Anggaran ${year}`,
        createdById: sub,
        tolerancePct: dto.tolerancePct ?? 10,
      })
      .returning();
  }

  /** Dipakai oleh BudgetService.save */
  deleteBudgetLinesByBudgetId(db: DbOrTx, id: string) {
    return db.delete(budgetLines).where(eq(budgetLines.budgetId, id));
  }

  /** Dipakai oleh BudgetService.save */
  insertBudgetLines(
    db: DbOrTx,
    values: { tenantId: string; budgetId: string; accountId: string; month: number; amount: string }[],
    i: number,
  ) {
    return db.insert(budgetLines).values(values.slice(i, i + 500));
  }

  /** Dipakai oleh BudgetService.approve */
  queryBudgetLine(db: DbOrTx, id: string) {
    return db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM budget_lines WHERE budget_id = ${id}`);
  }

  /** Dipakai oleh BudgetService.actualByMonth */
  queryJournalLine(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{ account_id: string; m: number; d: string; c: string }>(sql`
      SELECT l.account_id, EXTRACT(MONTH FROM j.date)::int AS m, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date >= ${`${year}-01-01`} AND j.date <= ${`${year}-12-31`}
        AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
      GROUP BY l.account_id, EXTRACT(MONTH FROM j.date)`);
  }

  /** Dipakai oleh BudgetService.guard */
  listAccountsByIdAndType(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids), eq(accounts.type, 'EXPENSE')));
  }

  /** Dipakai oleh BudgetService.alertAll */
  listBudgetsByYearAndStatus(db: DbOrTx, year: number) {
    return db
      .select()
      .from(budgets)
      .where(and(eq(budgets.year, year), eq(budgets.status, 'APPROVED')));
  }

  /** Dipakai oleh BudgetService.alertTenant */
  insertBudgetAlerts(
    db: DbOrTx,
    tenantId: string,
    budgetId: string,
    accountId: string,
    month: number,
    status: 'OK' | 'WARN' | 'OVER' | 'UNBUDGETED',
  ) {
    return db
      .insert(budgetAlerts)
      .values({ tenantId: tenantId, budgetId: budgetId, accountId: accountId, month: month, level: status })
      .onConflictDoNothing()
      .returning({ id: budgetAlerts.id });
  }

  /** Dipakai oleh BudgetService.alertTenant */
  listUsersByIsActiveAndRole(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])));
  }
}
