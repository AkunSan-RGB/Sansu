import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { auditLogs } from '../../db/schema';
import { auditContext } from './audit-context';
import { maskIdentity } from './mask';

@Injectable()
export class AuditService {
  async log(
    tx: DbOrTx,
    entry: { tenantId: string; userId?: string; action: string; entity: string; entityId: string; data?: unknown },
  ) {
    // tandai agar pencatat otomatis (AuditInterceptor) tidak mencatat ganda
    const ctx = auditContext.getStore();
    if (ctx) ctx.logged = true;
    await tx.insert(auditLogs).values({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      data: entry.data === undefined ? null : maskIdentity(entry.data),
    });
  }
}
