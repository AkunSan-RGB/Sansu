import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { ADJUSTING_SOURCES } from './ledger-data';

/** Akses data untuk Adjustments: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AdjustmentsRepository {
  /** Dipakai oleh AdjustmentsService.summary */
  queryJournalEntry(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ source_type: string; n: number; total: string }>(sql`
      SELECT j.source_type, COUNT(DISTINCT j.id)::int AS n, COALESCE(SUM(l.debit), 0) AS total
      FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${from} AND ${to}
        AND j.source_type IN (${sql.join(
          ADJUSTING_SOURCES.map((s) => sql`${s}`),
          sql`, `,
        )})
      GROUP BY j.source_type`);
  }
}
