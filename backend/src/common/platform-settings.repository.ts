import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbOrTx } from '../db/db';
import { platformSettings } from '../db/schema';

/** Pengaturan tingkat platform (satu baris per kunci, isi jsonb): dipakai bersama oleh langganan dan status cadangan. */
@Injectable()
export class PlatformSettingsRepository {
  async find(db: DbOrTx, key: string) {
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
    return row;
  }

  async upsert(db: DbOrTx, key: string, value: unknown) {
    await db
      .insert(platformSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
  }
}
