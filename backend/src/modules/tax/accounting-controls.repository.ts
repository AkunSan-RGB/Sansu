import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk AccountingControls: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AccountingControlsRepository {
  /** Dipakai oleh AccountingControlsService.controls */
  queryJournalEntry(db: DbOrTx, tenantId: string, since: string, cutoff: string) {
    return db.execute<{ number: string; d: string; c: string; who: string | null; src: string }>(sql`
      SELECT j.number, j.date::text AS d, j.created_at::date::text AS c, u.name AS who, j.source_type AS src
      FROM journal_entries j LEFT JOIN users u ON u.id = j.created_by_id
      WHERE j.tenant_id = ${tenantId} AND j.created_at::date >= ${since} AND j.date < ${cutoff}
        AND j.source_type NOT IN ('RECURRING', 'REVERSAL', 'CLOSING', 'OPENING', 'ADJUSTMENT')
      ORDER BY j.created_at DESC LIMIT 30`);
  }
}
