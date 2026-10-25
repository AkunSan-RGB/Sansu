import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { salesCommissions, users } from '../../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';

/** Akses data untuk SalesCommissions: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SalesCommissionsRepository {
  /** Dipakai oleh SalesCommissionsService.list */
  listSalesCommissionsWithUsersByPeriodAndUserIdAndNumber(db: DbOrTx, u: AuthUser, period: string | undefined) {
    return db
      .select({ c: salesCommissions, name: users.name })
      .from(salesCommissions)
      .innerJoin(users, eq(users.id, salesCommissions.userId))
      .where(
        and(
          eq(salesCommissions.tenantId, u.tenantId),
          period ? eq(salesCommissions.period, period) : undefined,
          u.role === 'SALES' ? eq(salesCommissions.userId, u.sub) : undefined,
        ),
      )
      .orderBy(desc(salesCommissions.period), desc(salesCommissions.number))
      .limit(500);
  }

  /** Dipakai oleh SalesCommissionsService.close */
  findSalesCommissionsByUserIdAndPeriodAndStatus(db: DbOrTx, tenantId: string, userId: string, period: string) {
    return db
      .select({ id: salesCommissions.id })
      .from(salesCommissions)
      .where(
        and(
          eq(salesCommissions.tenantId, tenantId),
          eq(salesCommissions.userId, userId),
          eq(salesCommissions.period, period),
          eq(salesCommissions.status, 'ACCRUED'),
        ),
      );
  }

  /** Dipakai oleh SalesCommissionsService.close */
  listSalesCommissionsByUserIdAndPeriodAndStatus(db: DbOrTx, tenantId: string, userId: string, period: string) {
    return db
      .select({ id: salesCommissions.id })
      .from(salesCommissions)
      .where(
        and(
          eq(salesCommissions.tenantId, tenantId),
          eq(salesCommissions.userId, userId),
          eq(salesCommissions.period, period),
          eq(salesCommissions.status, 'PAID'),
        ),
      );
  }
}
