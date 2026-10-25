import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, recurringJournals, scheduledReversals } from '../../db/schema';

/** Akses data akuntansi: akun, jurnal berulang, dan pembalikan terjadwal. */
@Injectable()
export class AccountingRepository {
  async accountOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  /** Kunci baris (FOR UPDATE) agar dua proses tidak menjalankan jurnal berulang yang sama */
  async recurringForUpdate(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(recurringJournals).where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, tenantId))).for('update');
    return r;
  }

  async scheduledReversalForUpdate(db: DbOrTx, id: string) {
    const [r] = await db.select().from(scheduledReversals).where(eq(scheduledReversals.id, id)).for('update');
    return r;
  }
}
