import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users } from '../../db/schema';
import { and, inArray, eq, isNotNull, gt } from 'drizzle-orm';
import { createHash } from 'crypto';

/** Kode disimpan sebagai hash: kebocoran basis data tidak membuka kode yang masih berlaku */
export const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

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

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh TelegramService.handleUpdate */
  findUsersByTelegramLinkCodeAndTelegramLinkExpiresAndIsActive(db: DbOrTx, arg: string) {
    return db
      .select({ id: users.id, name: users.name, email: users.email, tenantId: users.tenantId })
      .from(users)
      .where(
        and(
          eq(users.telegramLinkCode, hashCode(arg)),
          gt(users.telegramLinkExpires, new Date()),
          eq(users.isActive, true),
        ),
      );
  }
}
