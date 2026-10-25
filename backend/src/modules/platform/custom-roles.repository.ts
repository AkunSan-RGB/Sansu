import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { customRoles, users } from '../../db/schema';
import { sql, eq, asc, and } from 'drizzle-orm';

/** Akses data untuk CustomRoles: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CustomRolesRepository {
  /** Dipakai oleh CustomRolesService.list */
  countCustomRolesByName(db: DbOrTx, tenantId: string) {
    return db
      .select({
        id: customRoles.id,
        name: customRoles.name,
        baseRole: customRoles.baseRole,
        denied: customRoles.denied,
        createdAt: customRoles.createdAt,
        users: sql<number>`(SELECT COUNT(*)::int FROM users u WHERE u.custom_role_id = custom_roles.id)`,
      })
      .from(customRoles)
      .where(eq(customRoles.tenantId, tenantId))
      .orderBy(asc(customRoles.name));
  }

  /** Dipakai oleh CustomRolesService.create */
  findCustomRolesByName(db: DbOrTx, tenantId: string, name: string) {
    return db
      .select({ id: customRoles.id })
      .from(customRoles)
      .where(and(eq(customRoles.tenantId, tenantId), sql`lower(${customRoles.name}) = lower(${name})`));
  }

  /** Dipakai oleh CustomRolesService.update */
  updateCustomRolesById(db: DbOrTx, name: string, denied: string[], id: string) {
    return db.update(customRoles).set({ name: name, denied: denied }).where(eq(customRoles.id, id)).returning();
  }

  /** Dipakai oleh CustomRolesService.remove */
  countUsersByCustomRoleId(db: DbOrTx, id: string) {
    return db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(users)
      .where(eq(users.customRoleId, id));
  }

  /** Dipakai oleh CustomRolesService.remove */
  deleteCustomRolesById(db: DbOrTx, id: string) {
    return db.delete(customRoles).where(eq(customRoles.id, id));
  }
}
