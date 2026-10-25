import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk Sequence: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SequenceRepository {
  /** Dipakai oleh SequenceService.next */
  queryDocumentSequence(db: DbOrTx, tenantId: string, docType: string, per: string) {
    return db.execute<{ last_number: number }>(sql`
      INSERT INTO document_sequences (tenant_id, doc_type, period, last_number)
      VALUES (${tenantId}, ${docType}, ${per}, 1)
      ON CONFLICT (tenant_id, doc_type, period)
      DO UPDATE SET last_number = document_sequences.last_number + 1
      RETURNING last_number`);
  }
}
