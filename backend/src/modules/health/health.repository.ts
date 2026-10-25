import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk Health: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class HealthRepository {
  /** Dipakai oleh HealthService.check */
  queryCheck(db: DbOrTx) {
    return db.execute(sql`SELECT 1`);
  }
}
