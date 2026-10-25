import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users } from '../../db/schema';
import { and, eq } from 'drizzle-orm';

/** Akses data untuk ApprovalLinks: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ApprovalLinksRepository {
  /** Dipakai oleh ApprovalLinksService.resolve */
  findUsersByIdAndIsActive(db: DbOrTx, u: NonNullable<(typeof users.$inferSelect)['id']>) {
    return db
      .select()
      .from(users)
      .where(and(eq(users.id, u), eq(users.isActive, true)));
  }

  /** Dipakai oleh ApprovalLinksService.summary */
  findUsersById(db: DbOrTx, requestedById: NonNullable<(typeof users.$inferSelect)['id']>) {
    return db.select({ name: users.name }).from(users).where(eq(users.id, requestedById));
  }
}
