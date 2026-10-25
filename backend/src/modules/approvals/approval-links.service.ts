import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { APPROVAL_KIND_LABELS, ApprovalsService } from '../../common/approvals/approvals.service';
import { verifyApprovalLink } from '../../common/approvals/approval-link';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { approvalRequests, users } from '../../db/schema';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import { ApprovalRequestsService } from './approvals.service';
import { LinkDecisionDto } from './approvals.dto';
import { findOwned } from '../../db/owned';

/** Persetujuan lewat tautan email pribadi (tanpa login): ringkasan dulu, keputusan saat tombol ditekan */
@Injectable()
export class ApprovalLinksService {
  constructor(
    private readonly svc: ApprovalRequestsService,
    private readonly requests: PurchaseRequestsService,
    private readonly approvals: ApprovalsService,
    @InjectDb() private readonly db: Db,
  ) {}

  private async resolve(token: string) {
    const p = verifyApprovalLink(token);
    if (!p) throw new BadRequestException('Tautan tidak valid atau sudah kedaluwarsa');
    const [u] = await this.db.select().from(users).where(and(eq(users.id, p.u), eq(users.isActive, true)));
    if (!u || !this.approvals.isApprover(u.role)) throw new BadRequestException('Tautan tidak valid atau sudah kedaluwarsa');
    return { p, approver: { name: u.name }, user: { sub: u.id, tenantId: u.tenantId, role: u.role, email: u.email } as AuthUser };
  }

  async summary(token: string) {
    const { p, user, approver } = await this.resolve(token);
    if (p.k === 'PR') {
      const r = await this.requests.get(user.tenantId, p.r);
      return {
        kind: 'PR',
        kindLabel: 'Permintaan pembelian',
        title: `Permintaan pembelian ${r.number}`,
        status: r.status,
        pending: r.status === 'SUBMITTED',
        requestedBy: r.requestedBy,
        approver: approver.name,
        amount: r.estimatedTotal,
        details: [`Gudang: ${r.warehouse.name}`, ...(r.notes ? [`Catatan: ${r.notes}`] : []), ...r.lines.map((l) => `${l.product.sku} · ${l.product.name} — ${Number(l.qty)} ${l.uom}`)],
        decisionNote: r.decisionNote,
      };
    }
    const r = await findOwned(this.db, approvalRequests, user.tenantId, p.r);
    if (!r) throw new NotFoundException('Permintaan persetujuan tidak ditemukan');
    const [by] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, r.requestedById));
    return {
      kind: 'AR',
      kindLabel: APPROVAL_KIND_LABELS[r.kind],
      title: r.title,
      status: r.status,
      pending: r.status === 'PENDING',
      requestedBy: by?.name ?? null,
      approver: approver.name,
      amount: Number(r.amount),
      details: [],
      decisionNote: r.decisionNote,
    };
  }

  async decide(token: string, dto: LinkDecisionDto) {
    const { p, user } = await this.resolve(token);
    if (p.k === 'PR') {
      const r = await this.requests.decide(user, p.r, dto.approve, dto.note);
      return { status: r.status };
    }
    const out = dto.approve ? await this.svc.approve(user, p.r, { note: dto.note }) : await this.svc.reject(user, p.r, { note: dto.note });
    return { status: (out as { status?: string }).status ?? (dto.approve ? 'APPROVED' : 'REJECTED') };
  }
}
