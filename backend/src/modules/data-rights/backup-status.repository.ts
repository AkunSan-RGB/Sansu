import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { platformSettings } from '../../db/schema';
import { eq } from 'drizzle-orm';

/** Akses data untuk BackupStatus: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BackupStatusRepository {
  /** Dipakai oleh BackupStatusService.read */
  findPlatformSettingsByKey(db: DbOrTx, key: NonNullable<(typeof platformSettings.$inferSelect)['key']>) {
    return db.select().from(platformSettings).where(eq(platformSettings.key, key));
  }

  /** Dipakai oleh BackupStatusService.write */
  insertPlatformSettings(db: DbOrTx, key: string, value: unknown) {
    return db
      .insert(platformSettings)
      .values({ key: key, value: value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: value, updatedAt: new Date() } });
  }
}
