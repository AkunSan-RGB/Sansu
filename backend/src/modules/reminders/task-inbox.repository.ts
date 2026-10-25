import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk TaskInbox: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TaskInboxRepository {
  /** Dipakai oleh TaskInboxService.one */
  queryOne(db: DbOrTx, q: SQL<unknown>) {
    return db.execute<{ n: number; oldest: number }>(q);
  }
}
