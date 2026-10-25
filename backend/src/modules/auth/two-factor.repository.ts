import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';

/** Akses data untuk TwoFactor: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TwoFactorRepository {
  /** Dipakai oleh TwoFactorService.user */
  findUsersById(db: DbOrTx, id: NonNullable<(typeof users.$inferSelect)['id']>) {
    return db.select().from(users).where(eq(users.id, id));
  }
}
