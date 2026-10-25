import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { pettyCashFunds, accounts, pettyCashVouchers } from '../../db/schema';
import { Dec } from '../../common/utils/money';

/** Akses data untuk PettyCash: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PettyCashRepository {
  /** Dipakai oleh PettyCashService.balanceOf */
  queryJournalLine(db: DbOrTx, accountId: string) {
    return db.execute<{ bal: string }>(
      sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${accountId}`,
    );
  }

  /** Dipakai oleh PettyCashService.funds */
  listPettyCashFundsByCreatedAt(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(pettyCashFunds)
      .where(eq(pettyCashFunds.tenantId, tenantId))
      .orderBy(pettyCashFunds.createdAt);
  }

  /** Dipakai oleh PettyCashService.funds */
  queryPettyCashVoucher(db: DbOrTx, id: string) {
    return db.execute<{ total: string; n: number; oldest: string | null }>(sql`
          SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n, MIN(date)::text AS oldest
          FROM petty_cash_vouchers WHERE fund_id = ${id} AND status = 'OPEN'`);
  }

  /** Dipakai oleh PettyCashService.funds */
  queryCashCount(db: DbOrTx, tenantId: string, accountId: string) {
    return db.execute<{ last: string | null }>(
      sql`SELECT MAX(date)::text AS last FROM cash_counts WHERE tenant_id = ${tenantId} AND account_id = ${accountId} AND status = 'POSTED'`,
    );
  }

  /** Dipakai oleh PettyCashService.saveFund */
  listAccountsById(db: DbOrTx, tenantId: string, accountId: string, fundingAccountId: string) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [accountId, fundingAccountId])));
  }

  /** Dipakai oleh PettyCashService.saveFund */
  findPettyCashFundsByAccountId(db: DbOrTx, tenantId: string, accountId: string) {
    return db
      .select()
      .from(pettyCashFunds)
      .where(and(eq(pettyCashFunds.tenantId, tenantId), eq(pettyCashFunds.accountId, accountId)));
  }

  /** Dipakai oleh PettyCashService.saveFund */
  updatePettyCashFundsById(
    db: DbOrTx,
    fundingAccountId: string,
    name: string,
    custodianName: string,
    imprest: Dec,
    max: Dec,
    id: string,
  ) {
    return db
      .update(pettyCashFunds)
      .set({
        fundingAccountId: fundingAccountId,
        name: name.trim(),
        custodianName: custodianName.trim(),
        imprestAmount: imprest.toFixed(2),
        maxVoucher: max.toFixed(2),
      })
      .where(eq(pettyCashFunds.id, id))
      .returning();
  }

  /** Dipakai oleh PettyCashService.topUp */
  queryPettyCashVoucherForTopUp(db: DbOrTx, id: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM petty_cash_vouchers WHERE fund_id = ${id} AND status = 'OPEN'`,
    );
  }

  /** Dipakai oleh PettyCashService.vouchers */
  listAccounts(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId));
  }

  /** Dipakai oleh PettyCashService.createVoucher */
  queryPettyCashVoucherForCreateVoucher(db: DbOrTx, id: string, receipt: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM petty_cash_vouchers WHERE fund_id = ${id} AND lower(receipt_ref) = lower(${receipt}) AND status <> 'VOID'`,
    );
  }

  /** Dipakai oleh PettyCashService.pickVouchers */
  listPettyCashVouchersByFundIdAndStatus(db: DbOrTx, id: string) {
    return db
      .select()
      .from(pettyCashVouchers)
      .where(and(eq(pettyCashVouchers.fundId, id), eq(pettyCashVouchers.status, 'OPEN')));
  }

  /** Dipakai oleh PettyCashService.executeReplenish */
  updatePettyCashVouchersById(db: DbOrTx, id: string, picked: (typeof pettyCashVouchers.$inferSelect)[]) {
    return db
      .update(pettyCashVouchers)
      .set({ status: 'REPLENISHED', replenishmentId: id })
      .where(
        inArray(
          pettyCashVouchers.id,
          picked.map((v) => v.id),
        ),
      );
  }
}
