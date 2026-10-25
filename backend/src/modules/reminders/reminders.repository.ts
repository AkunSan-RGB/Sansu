import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { reminderSnoozes } from '../../db/schema';
import { and, eq, gt } from 'drizzle-orm';

/** Akses data untuk Reminders: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class RemindersRepository {
  /** Dipakai oleh RemindersService.forUser */
  listReminderSnoozesByUserIdAndUntil(db: DbOrTx, sub: string, today: string) {
    return db
      .select({ key: reminderSnoozes.key, until: reminderSnoozes.until })
      .from(reminderSnoozes)
      .where(and(eq(reminderSnoozes.userId, sub), gt(reminderSnoozes.until, today)));
  }

  /** Dipakai oleh RemindersService.snooze */
  insertReminderSnoozes(db: DbOrTx, tenantId: string, sub: string, key: string, until: string) {
    return db
      .insert(reminderSnoozes)
      .values({ tenantId: tenantId, userId: sub, key: key, until: until })
      .onConflictDoUpdate({ target: [reminderSnoozes.userId, reminderSnoozes.key], set: { until: until } });
  }

  /** Dipakai oleh RemindersService.unsnooze */
  deleteReminderSnoozesByUserIdAndKey(db: DbOrTx, sub: string, key: string) {
    return db.delete(reminderSnoozes).where(and(eq(reminderSnoozes.userId, sub), eq(reminderSnoozes.key, key)));
  }
}
