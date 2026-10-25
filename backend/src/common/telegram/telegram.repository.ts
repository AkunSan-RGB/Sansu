import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users } from '../../db/schema';
import { and, inArray, eq, isNotNull } from 'drizzle-orm';

/** Akses data untuk Telegram: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TelegramRepository {
  /** Dipakai oleh TelegramService.notifyUsers */
  listUsersByIdAndIsActiveAndTelegramChatId(db: DbOrTx, userIds: string[]) {
    return db
      .select({ chat: users.telegramChatId })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.isActive, true), isNotNull(users.telegramChatId)));
  }

  /** Dipakai oleh TelegramService.status */
  findUsersById(db: DbOrTx, userId: string) {
    return db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, userId));
  }

  /** Dipakai oleh TelegramService.handleUpdate */
  updateUsersByTelegramChatId(db: DbOrTx, chatId: string) {
    return db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
  }
}
