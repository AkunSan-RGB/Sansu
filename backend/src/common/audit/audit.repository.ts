import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { auditLogs } from '../../db/schema';
import { maskIdentity } from './mask';

/** Akses data untuk Audit: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AuditRepository {
  /** Dipakai oleh AuditService.log */
  insertAuditLogs(
    db: DbOrTx,
    entry: { tenantId: string; userId?: string; action: string; entity: string; entityId: string; data?: unknown },
  ) {
    return db.insert(auditLogs).values({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      data: entry.data === undefined ? null : maskIdentity(entry.data),
    });
  }
}
