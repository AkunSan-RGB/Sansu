import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { branches, warehouses, accounts } from '../../db/schema';
import { eq, asc, and, sql } from 'drizzle-orm';
import { UpdateBranchDto } from './branches.dto';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk Branches: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BranchesRepository {
  /** Dipakai oleh BranchesService.list */
  listBranchesByCode(db: DbOrTx, tenantId: string) {
    return db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.code));
  }

  /** Dipakai oleh BranchesService.list */
  listWarehousesByCode(db: DbOrTx, tenantId: string) {
    return db
      .select({
        id: warehouses.id,
        code: warehouses.code,
        name: warehouses.name,
        branchId: warehouses.branchId,
        isActive: warehouses.isActive,
      })
      .from(warehouses)
      .where(eq(warehouses.tenantId, tenantId))
      .orderBy(asc(warehouses.code));
  }

  /** Dipakai oleh BranchesService.list */
  listAccountsByIsCashAccountAndIsPostableAndCode(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, branchId: accounts.branchId })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.isCashAccount, true), eq(accounts.isPostable, true)))
      .orderBy(asc(accounts.code));
  }

  /** Dipakai oleh BranchesService.create */
  findBranchesByCode(db: DbOrTx, tenantId: string, code: string) {
    return db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.code, code)));
  }

  /** Dipakai oleh BranchesService.update */
  queryWarehouse(db: DbOrTx, id: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM warehouses WHERE branch_id = ${id} AND is_active`,
    );
  }

  /** Dipakai oleh BranchesService.update */
  updateBranchesById(db: DbOrTx, dto: UpdateBranchDto, id: string) {
    return db
      .update(branches)
      .set({ name: dto.name?.trim(), address: dto.address, isActive: dto.isActive })
      .where(eq(branches.id, id))
      .returning();
  }

  /** Dipakai oleh BranchesService.setEnabled */
  findBranches(db: DbOrTx, tenantId: string) {
    return db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1);
  }

  /** Dipakai oleh BranchesService.assignAccount */
  findAccountsByIdAndIsCashAccount(db: DbOrTx, accountId: string, tenantId: string) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId), eq(accounts.isCashAccount, true)));
  }

  /** Dipakai oleh BranchesService.report */
  queryJournalLine(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ account_id: string; branch_id: string | null; d: string; c: string }>(sql`
      SELECT l.account_id, l.branch_id::text AS branch_id, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date >= ${from} AND j.date <= ${to} AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
      GROUP BY l.account_id, l.branch_id`);
  }

  /** Dipakai oleh BranchesService.balanceSheet */
  queryJournalLineForBalanceSheet(db: DbOrTx, tenantId: string, asOf: string) {
    return db.execute<{ account_id: string; branch_id: string | null; d: string; c: string }>(sql`
      SELECT l.account_id, l.branch_id::text AS branch_id, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${asOf}
      GROUP BY l.account_id, l.branch_id`);
  }

  /** Dipakai oleh BranchesService.balanceSheet */
  queryStockTransfer(db: DbOrTx, tenantId: string, asOf: string) {
    return db.execute<{ number: string; date: string; from_b: string | null; to_b: string | null; total: string }>(sql`
      SELECT t.number, t.date::text AS date, wf.branch_id::text AS from_b, wt.branch_id::text AS to_b, t.total_value AS total
      FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id
      WHERE t.tenant_id = ${tenantId} AND t.date <= ${asOf} AND wf.branch_id IS DISTINCT FROM wt.branch_id AND t.status <> 'CANCELLED'
      ORDER BY t.date DESC LIMIT 50`);
  }

  /** Dipakai oleh BranchesService.controls */
  listBranchesByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));
  }

  /** Dipakai oleh BranchesService.controls */
  listWarehousesByIsActiveAndBranchId(db: DbOrTx, tenantId: string) {
    return db
      .select({ code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(
        and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true), sql`${warehouses.branchId} IS NULL`),
      );
  }

  /** Dipakai oleh BranchesService.controls */
  queryJournalLineForControls(db: DbOrTx, tenantId: string, today: string, branchNoSalesDays: number) {
    return db.execute<{ id: string }>(sql`
      SELECT DISTINCT l.branch_id::text AS id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND l.branch_id IS NOT NULL AND j.date >= ${addDays(today, -branchNoSalesDays)} AND j.source_type <> 'CLOSING'`);
  }

  /** Dipakai oleh BranchesService.controls */
  queryJournalLineForControls2(db: DbOrTx, tenantId: string, today: string, branchNoSalesDays: number) {
    return db.execute<{ id: string }>(
      sql`SELECT DISTINCT branch_id::text AS id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND branch_id IS NOT NULL AND j.date < ${addDays(today, -branchNoSalesDays)}`,
    );
  }
}
