import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { ListDto, AssignDto } from './approvals.dto';
import { approvalRequests } from '../../db/schema';

/** Akses data untuk Approvals: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ApprovalsRepository {
  /** Dipakai oleh ApprovalRequestsService.list */
  queryApprovalRequest(db: DbOrTx, user: AuthUser, q: ListDto, mineOnly: boolean) {
    return db.execute<{
      id: string;
      kind: string;
      ref_id: string | null;
      title: string;
      amount: string;
      status: string;
      requested_at: string;
      decided_at: string | null;
      decision_note: string | null;
      result_ref: string | null;
      requested_by: string;
      decided_by: string | null;
      requested_by_id: string;
      assigned_to_id: string | null;
      assigned_to: string | null;
    }>(sql`
      SELECT r.id, r.kind, r.ref_id, r.title, r.amount, r.status, r.requested_at, r.decided_at, r.decision_note, r.result_ref, r.requested_by_id, r.assigned_to_id,
             u.name AS requested_by, d.name AS decided_by, a.name AS assigned_to
      FROM approval_requests r JOIN users u ON u.id = r.requested_by_id LEFT JOIN users d ON d.id = r.decided_by_id LEFT JOIN users a ON a.id = r.assigned_to_id
      WHERE r.tenant_id = ${user.tenantId}
        ${q.status === 'PENDING' ? sql`AND r.status = 'PENDING'` : sql``}
        ${mineOnly ? sql`AND r.requested_by_id = ${user.sub}` : user.role === 'OWNER' ? sql`` : sql`AND (r.assigned_to_id IS NULL OR r.assigned_to_id = ${user.sub} OR r.requested_by_id = ${user.sub} OR r.status <> 'PENDING')`}
      ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 200`);
  }

  /** Dipakai oleh ApprovalRequestsService.pendingCount */
  queryApprovalRequestForPendingCount(db: DbOrTx, user: AuthUser) {
    return db.execute<{
      n: number;
    }>(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${user.tenantId} AND status = 'PENDING' AND requested_by_id <> ${user.sub}
      ${user.role === 'OWNER' ? sql`` : sql`AND (assigned_to_id IS NULL OR assigned_to_id = ${user.sub})`}`);
  }

  /** Dipakai oleh ApprovalRequestsService.assign */
  updateApprovalRequestsByIdAndStatus(db: DbOrTx, dto: AssignDto, id: string) {
    return db
      .update(approvalRequests)
      .set({ assignedToId: dto.approverId ?? null })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')));
  }

  /** Dipakai oleh ApprovalRequestsService.approve */
  updateApprovalRequestsByIdAndStatusForApprove(db: DbOrTx, sub: string, note: string | undefined, id: string) {
    return db
      .update(approvalRequests)
      .set({ status: 'APPROVED', decidedById: sub, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
  }

  /** Dipakai oleh ApprovalRequestsService.reject */
  updateApprovalRequestsByIdAndStatusForReject(db: DbOrTx, sub: string, note: string, id: string) {
    return db
      .update(approvalRequests)
      .set({ status: 'REJECTED', decidedById: sub, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
  }

  /** Dipakai oleh ApprovalRequestsService.cancel */
  updateApprovalRequestsByIdAndStatusForCancel(db: DbOrTx, id: string) {
    return db
      .update(approvalRequests)
      .set({ status: 'CANCELLED', decidedAt: new Date() })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
  }
}
