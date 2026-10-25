import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../db/db';
import { tenants } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

/** Akses data untuk Settings: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SettingsRepository {
  /** Dipakai oleh SettingsService.reporting */
  findTenantsById(db: DbOrTx, tenantId: NonNullable<(typeof tenants.$inferSelect)['id']>) {
    return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /**
   * Tulis satu kunci pengaturan secara atomik di database (jsonb_set), bukan menimpa seluruh dokumen hasil baca lama:
   * dua penyimpanan pengaturan yang berdekatan tidak lagi saling menghapus (mis. jenis usaha kembali ke nilai lama).
   */
  async writeKey(db: DbOrTx, tenantId: string, key: string, value: object) {
    await db.execute(
      sql`UPDATE tenants SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), ARRAY[${key}]::text[], ${JSON.stringify(value)}::jsonb, true) WHERE id = ${tenantId}`,
    );
  }
}
