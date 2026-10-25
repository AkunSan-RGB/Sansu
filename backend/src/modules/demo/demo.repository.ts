import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Perusahaan demo dihapus setelah sekian hari */
export const DEMO_TTL_DAYS = 3;

/** Akses data untuk Demo: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class DemoRepository {
  /** Dipakai oleh DemoService.start */
  queryTenant(db: DbOrTx) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM tenants WHERE settings ? 'demo' AND created_at > now() - interval '1 hour'`,
    );
  }

  /** Dipakai oleh DemoService.purgeExpired */
  queryTenantForPurgeExpired(db: DbOrTx) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM tenants WHERE settings ? 'demo' AND created_at < now() - (${DEMO_TTL_DAYS} * interval '1 day') LIMIT 20`,
    );
  }
}
