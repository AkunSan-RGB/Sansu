import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { APPROVAL_KIND_LABELS, ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { verifyApprovalLink } from '../../common/approvals/approval-link';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { approvalRequests, users } from '../../db/schema';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import { ApprovalRequestsService } from './approvals.service';
import { ListDto, AssignDto, PolicyDto, DecisionDto, LinkDecisionDto } from './approvals.dto';

@ApiTags('Persetujuan')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly svc: ApprovalRequestsService,
    private readonly approvals: ApprovalsService,
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) {
    return this.svc.list(u, q);
  }

  @Get('approvers')
  approvers(@CurrentUser() u: AuthUser) {
    return this.svc.approvers(u);
  }

  @Post(':id/assign')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.svc.assign(u, id, dto);
  }

  @Get('pending-count')
  count(@CurrentUser() u: AuthUser) {
    return this.svc.pendingCount(u);
  }

  @Get('policy')
  @Roles('ADMIN')
  policy(@CurrentUser() u: AuthUser) {
    return this.approvals.policy(this.db, u.tenantId);
  }

  @Put('policy')
  @Roles('ADMIN')
  async savePolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto) {
    const before = await this.approvals.policy(this.db, u.tenantId);
    const after = await this.approvals.savePolicy(this.db, u.tenantId, dto);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ApprovalPolicy', entityId: u.tenantId, data: { before, after } });
    return after;
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.svc.approve(u, id, dto);
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.svc.reject(u, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}

/** Persetujuan lewat tautan email pribadi (tanpa login): ringkasan dulu, keputusan saat tombol ditekan */
@ApiTags('Persetujuan')
@Controller('public/approval-links')
export class PublicApprovalLinksController {
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

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  async summary(@Param('token') token: string) {
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
    const [r] = await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.id, p.r), eq(approvalRequests.tenantId, user.tenantId)));
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

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':token/decide')
  async decide(@Param('token') token: string, @Body() dto: LinkDecisionDto) {
    const { p, user } = await this.resolve(token);
    if (p.k === 'PR') {
      const r = await this.requests.decide(user, p.r, dto.approve, dto.note);
      return { status: r.status };
    }
    const out = dto.approve ? await this.svc.approve(user, p.r, { note: dto.note }) : await this.svc.reject(user, p.r, { note: dto.note });
    return { status: (out as { status?: string }).status ?? (dto.approve ? 'APPROVED' : 'REJECTED') };
  }
}
