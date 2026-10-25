import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users, authTokens, tenants, customRoles, budgets, branches } from '../../db/schema';
import { eq, and, isNull, gt, sql, inArray } from 'drizzle-orm';
import { sha256 } from '../../common/utils/secret';

/** Akses data untuk Auth: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AuthRepository {
  /** Dipakai oleh AuthService.login */
  findUsersByEmail(db: DbOrTx, email: string) {
    return db.select().from(users).where(eq(users.email, email));
  }

  /** Dipakai oleh AuthService.loginTwoFactor */
  findUsersById(db: DbOrTx, sub: string) {
    return db.select().from(users).where(eq(users.id, sub));
  }

  /** Dipakai oleh AuthService.createToken */
  updateAuthTokensByUserIdAndPurposeAndUsedAt(db: DbOrTx, userId: string, purpose: 'RESET' | 'VERIFY') {
    return db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
  }

  /** Dipakai oleh AuthService.createToken */
  insertAuthTokens(db: DbOrTx, userId: string, purpose: 'RESET' | 'VERIFY', token: string, ttlMs: number) {
    return db
      .insert(authTokens)
      .values({ userId: userId, purpose: purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  }

  /** Dipakai oleh AuthService.issueResetLink */
  findUsersByIdForIssueResetLink(db: DbOrTx, userId: string) {
    return db.select().from(users).where(eq(users.id, userId));
  }

  /** Dipakai oleh AuthService.consumeToken */
  updateAuthTokensByTokenHashAndPurposeAndUsedAt(db: DbOrTx, token: string, purpose: 'RESET' | 'VERIFY') {
    return db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, sha256(token)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning();
  }

  /** Dipakai oleh AuthService.recentlySent */
  findAuthTokensByUserIdAndPurposeAndCreatedAt(db: DbOrTx, userId: string, purpose: 'RESET' | 'VERIFY') {
    return db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          gt(authTokens.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
  }

  /** Dipakai oleh AuthService.me */
  findUsersWithTenantsAndCustomRolesById(db: DbOrTx, sub: string) {
    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        tenantId: tenants.id,
        tenantName: tenants.name,
        ppnRate: tenants.ppnRate,
        emailVerifiedAt: users.emailVerifiedAt,
        warehouseIds: users.warehouseIds,
        branchIds: users.branchIds,
        totpEnabledAt: users.totpEnabledAt,
        customRoleName: customRoles.name,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(customRoles, eq(customRoles.id, users.customRoleId))
      .where(eq(users.id, sub));
  }

  /** Dipakai oleh AuthService.me */
  findBudgets(db: DbOrTx, tenantId: string) {
    return db.select({ id: budgets.id }).from(budgets).where(eq(budgets.tenantId, tenantId)).limit(1);
  }

  /** Dipakai oleh AuthService.taxFeatures */
  queryTaxFeatures(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM invoices WHERE tenant_id = ${tenantId} AND withholding_amount > 0) AS n`,
    );
  }

  /** Dipakai oleh AuthService.createUser */
  findCustomRolesById(db: DbOrTx, customRoleId: string, tenantId: string) {
    return db
      .select({ baseRole: customRoles.baseRole })
      .from(customRoles)
      .where(and(eq(customRoles.id, customRoleId), eq(customRoles.tenantId, tenantId)));
  }

  /** Dipakai oleh AuthService.multiBranch */
  findBranches(db: DbOrTx, tenantId: string) {
    return db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1);
  }

  /** Dipakai oleh AuthService.normalizeBranchIds */
  listBranchesById(db: DbOrTx, tenantId: string, uniq: string[]) {
    return db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, uniq)));
  }

  /** Dipakai oleh AuthService.assertEmailFree */
  findUsersByEmailForAssertEmailFree(db: DbOrTx, email: string) {
    return db.select({ id: users.id }).from(users).where(eq(users.email, email));
  }
}
