import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { auditContext } from './audit-context';
import { AuditRepository } from './audit.repository';

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async log(
    tx: DbOrTx,
    entry: { tenantId: string; userId?: string; action: string; entity: string; entityId: string; data?: unknown },
  ) {
    // tandai agar pencatat otomatis (AuditInterceptor) tidak mencatat ganda
    const ctx = auditContext.getStore();
    if (ctx) ctx.logged = true;
    await this.repo.insertAuditLogs(tx, entry);
  }
}
