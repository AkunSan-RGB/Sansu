/**
 * Kotak persetujuan: pemilik / admin memutuskan permintaan dari peran lain atas transaksi bernilai besar.
 * Disetujui → tindakan dijalankan (pesanan pembelian dikonfirmasi, jurnal manual diposting); ditolak → dicatat dengan alasan.
 */
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { APPROVAL_KIND_LABELS, ApprovalPolicy, ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { verifyApprovalLink } from '../../common/approvals/approval-link';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { approvalRequests, users } from '../../db/schema';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingService } from '../accounting/accounting.service';
import { CreateJournalDto } from '../accounting/dto/accounting.dto';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service';
import { PurchaseInvoicesService } from '../purchasing/purchase-invoices.service';
import { CreatePurchaseInvoiceDto } from '../purchasing/purchasing.dto';
import { PurchasingModule } from '../purchasing/purchasing.module';

class PolicyDto implements Partial<ApprovalPolicy> {
  @ApiPropertyOptional({ description: 'Pesanan pembelian dengan total ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseOrder?: number;
  @ApiPropertyOptional({ description: 'Jurnal manual dengan total debit ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) manualJournal?: number;
  @ApiPropertyOptional({ description: 'Permintaan pembelian dengan perkiraan nilai ≤ batas ini langsung disetujui otomatis; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseRequestAuto?: number;
  @ApiPropertyOptional({ description: 'Aktifkan pengendalian selisih harga faktur terhadap PO' }) @IsOptional() @IsBoolean() priceControl?: boolean;
  @ApiPropertyOptional({ description: 'Toleransi kenaikan harga faktur vs PO (%) per baris' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceTolerancePct?: number;
  @ApiPropertyOptional({ description: 'Toleransi harga faktur di atas rata-rata harga beli 90 hari (%)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceBenchmarkPct?: number;
}
class DecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class ListDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'ALL'] }) @IsOptional() @IsIn(['PENDING', 'ALL']) status?: 'PENDING' | 'ALL';
  @ApiPropertyOptional({ description: 'true = hanya permintaan saya' }) @IsOptional() @IsIn(['true', 'false']) mine?: string;
}

@Injectable()
export class ApprovalRequestsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly orders: PurchaseOrdersService,
    private readonly invoices: PurchaseInvoicesService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListDto) {
    const approver = this.approvals.isApprover(user.role);
    const mineOnly = q.mine === 'true' || !approver;
    const rows = await this.db.execute<{
      id: string; kind: string; ref_id: string | null; title: string; amount: string; status: string; requested_at: string; decided_at: string | null;
      decision_note: string | null; result_ref: string | null; requested_by: string; decided_by: string | null; requested_by_id: string;
    }>(sql`
      SELECT r.id, r.kind, r.ref_id, r.title, r.amount, r.status, r.requested_at, r.decided_at, r.decision_note, r.result_ref, r.requested_by_id,
             u.name AS requested_by, d.name AS decided_by
      FROM approval_requests r JOIN users u ON u.id = r.requested_by_id LEFT JOIN users d ON d.id = r.decided_by_id
      WHERE r.tenant_id = ${user.tenantId}
        ${q.status === 'PENDING' ? sql`AND r.status = 'PENDING'` : sql``}
        ${mineOnly ? sql`AND r.requested_by_id = ${user.sub}` : sql``}
      ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 200`);
    return rows.rows.map((r) => ({
      id: r.id, kind: r.kind, kindLabel: APPROVAL_KIND_LABELS[r.kind as keyof typeof APPROVAL_KIND_LABELS] ?? r.kind, refId: r.ref_id, title: r.title,
      amount: r.amount, status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, decisionNote: r.decision_note, resultRef: r.result_ref,
      requestedBy: r.requested_by, decidedBy: r.decided_by, mine: r.requested_by_id === user.sub,
    }));
  }

  async pendingCount(user: AuthUser) {
    if (!this.approvals.isApprover(user.role)) return { count: 0 };
    const r = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${user.tenantId} AND status = 'PENDING'`);
    return { count: r.rows[0].n };
  }

  private async load(user: AuthUser, id: string) {
    const [r] = await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), eq(approvalRequests.tenantId, user.tenantId)));
    if (!r) throw new NotFoundException('Permintaan persetujuan tidak ditemukan');
    return r;
  }

  async approve(user: AuthUser, id: string, dto: DecisionDto) {
    const req = await this.load(user, id);
    if (req.requestedById === user.sub) throw new ForbiddenException('Permintaan sendiri tidak bisa disetujui oleh pemohonnya');
    // Ambil keputusan secara atomik: hanya satu penyetuju yang berhasil
    const claimed = await this.db
      .update(approvalRequests)
      .set({ status: 'APPROVED', decidedById: user.sub, decidedAt: new Date(), decisionNote: dto.note })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
    if (!claimed.length) throw new ConflictException('Permintaan ini sudah diputuskan');
    try {
      let resultRef: string | undefined;
      if (req.kind === 'PURCHASE_ORDER') {
        const po = await this.orders.confirm(user, req.refId!);
        resultRef = po.number;
      } else if (req.kind === 'PURCHASE_INVOICE_PRICE') {
        // faktur dicatat atas nama pemohon; penyetuju tercatat di permintaan dan faktur
        const inv = await this.invoices.createFromOrder({ ...user, sub: req.requestedById }, req.payload as unknown as CreatePurchaseInvoiceDto, { approvalId: id });
        resultRef = inv.number;
      } else {
        // dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const j = await this.accounting.createManualJournal({ ...user, sub: req.requestedById }, req.payload as unknown as CreateJournalDto, { approved: true });
        resultRef = j.number;
      }
      await this.db.update(approvalRequests).set({ resultRef }).where(eq(approvalRequests.id, id));
    } catch (e) {
      // gagal dijalankan (mis. PO sudah dibatalkan): kembalikan ke menunggu agar bisa ditolak atau dicoba lagi
      await this.db.update(approvalRequests).set({ status: 'PENDING', decidedById: null, decidedAt: null, decisionNote: null }).where(eq(approvalRequests.id, id));
      throw new BadRequestException(`Persetujuan gagal dijalankan: ${(e as Error).message}`);
    }
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'APPROVE', entity: 'ApprovalRequest', entityId: id, data: { kind: req.kind, title: req.title } });
    return (await this.list(user, { status: 'ALL' })).find((r) => r.id === id) ?? { id };
  }

  async reject(user: AuthUser, id: string, dto: DecisionDto) {
    const req = await this.load(user, id);
    if (!dto.note?.trim()) throw new BadRequestException('Isi alasan penolakan');
    const done = await this.db
      .update(approvalRequests)
      .set({ status: 'REJECTED', decidedById: user.sub, decidedAt: new Date(), decisionNote: dto.note })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
    if (!done.length) throw new ConflictException('Permintaan ini sudah diputuskan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'REJECT', entity: 'ApprovalRequest', entityId: id, data: { kind: req.kind, title: req.title, note: dto.note } });
    return { id, status: 'REJECTED' };
  }

  /** Pemohon membatalkan permintaannya sendiri yang masih menunggu */
  async cancel(user: AuthUser, id: string) {
    const req = await this.load(user, id);
    if (req.requestedById !== user.sub) throw new ForbiddenException('Hanya pemohon yang dapat membatalkan permintaannya');
    const done = await this.db
      .update(approvalRequests)
      .set({ status: 'CANCELLED', decidedAt: new Date() })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
    if (!done.length) throw new ConflictException('Permintaan ini sudah diputuskan');
    return { id, status: 'CANCELLED' };
  }
}

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

class LinkDecisionDto {
  @ApiProperty() @IsBoolean() approve: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
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

@Module({
  imports: [AccountingModule, PurchasingModule],
  controllers: [ApprovalsController, PublicApprovalLinksController],
  providers: [ApprovalRequestsService],
})
export class ApprovalsModule {}
