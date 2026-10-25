import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { branches, users, customRoles, tenants } from '../../db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** Akses data untuk Platform: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PlatformRepository {
  /** Dipakai oleh PlatformService.normalizeBranchIds */
  listBranchesById(db: DbOrTx, tenantId: string, uniq: string[]) {
    return db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, uniq)));
  }

  /** Dipakai oleh PlatformService.updateUser */
  listUsersByRoleAndIsActiveAndId(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true), ne(users.id, id)));
  }

  /** Dipakai oleh PlatformService.updateUser */
  findCustomRolesById(db: DbOrTx, customRoleId: string, tenantId: string) {
    return db
      .select({ baseRole: customRoles.baseRole })
      .from(customRoles)
      .where(and(eq(customRoles.id, customRoleId), eq(customRoles.tenantId, tenantId)));
  }

  /** Dipakai oleh PlatformService.company */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PlatformService.updateUser */
  updateUsersByIdAndNameAndEmail(
    db: DbOrTx,
    patch: PgUpdateSetSource<typeof users>,
    id: NonNullable<(typeof users.$inferSelect)['id']>,
  ) {
    return db.update(users).set(patch).where(eq(users.id, id)).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      warehouseIds: users.warehouseIds,
      branchIds: users.branchIds,
      totpEnabledAt: users.totpEnabledAt,
    });
  }
}
