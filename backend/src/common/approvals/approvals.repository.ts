import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users, type Role, approvalRequests, auditLogs } from '../../db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';

export const APPROVER_ROLES: readonly Role[] = ['OWNER', 'ADMIN'];

/** Akses data untuk Approvals: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ApprovalsRepository {
  /** Dipakai oleh ApprovalsService.notifyApprovers */
  listUsersByIsActiveAndRoleAndId(
    db: DbOrTx,
    tenantId: NonNullable<(typeof users.$inferSelect)['tenantId']>,
    p: {
      kind: 'AR' | 'PR';
      id: string;
      requesterId?: string | null;
      title: string;
      lines: string[];
      onlyIds?: string[];
    },
  ) {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
          inArray(users.role, [...APPROVER_ROLES]),
          p.requesterId ? ne(users.id, p.requesterId) : undefined,
          p.onlyIds?.length ? inArray(users.id, p.onlyIds) : undefined,
        ),
      );
  }

  /** Dipakai oleh ApprovalsService.deliverRoles */
  listUsersByIsActiveAndRoleAndIdForDeliverRoles(
    db: DbOrTx,
    tenantId: NonNullable<(typeof users.$inferSelect)['tenantId']>,
    p: {
      roles: readonly Role[];
      excludeUserId?: string;
      title: string;
      lines?: string[];
      path: string;
      info?: boolean;
    },
  ) {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
          inArray(users.role, [...p.roles]),
          p.excludeUserId ? ne(users.id, p.excludeUserId) : undefined,
        ),
      );
  }

  /** Dipakai oleh ApprovalsService.gateDocument */
  findApprovalRequestsByKindAndRefIdAndStatus(
    db: DbOrTx,
    tenantId: NonNullable<(typeof approvalRequests.$inferSelect)['tenantId']>,
    kind: NonNullable<(typeof approvalRequests.$inferSelect)['kind']>,
    refId: NonNullable<(typeof approvalRequests.$inferSelect)['refId']>,
  ) {
    return db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.tenantId, tenantId),
          eq(approvalRequests.kind, kind),
          eq(approvalRequests.refId, refId),
          inArray(approvalRequests.status, ['PENDING', 'APPROVED']),
        ),
      );
  }

  /** Dipakai oleh ApprovalsService.invoiceCreator */
  findAuditLogsByEntityAndEntityIdAndAction(
    db: DbOrTx,
    tenantId: NonNullable<(typeof auditLogs.$inferSelect)['tenantId']>,
    invoiceId: NonNullable<(typeof auditLogs.$inferSelect)['entityId']>,
  ) {
    return db
      .select({ u: auditLogs.userId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.entity, 'Invoice'),
          eq(auditLogs.entityId, invoiceId),
          eq(auditLogs.action, 'CREATE'),
        ),
      )
      .limit(1);
  }
}
