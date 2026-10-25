import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants } from '../../db/schema';
import { eq } from 'drizzle-orm';

/** Akses data untuk Period: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PeriodRepository {
  /** Dipakai oleh PeriodService.lockedUntil */
  findTenantsById(db: DbOrTx, tenantId: NonNullable<(typeof tenants.$inferSelect)['id']>) {
    return db.select({ lockedUntil: tenants.lockedUntil }).from(tenants).where(eq(tenants.id, tenantId));
  }
}
