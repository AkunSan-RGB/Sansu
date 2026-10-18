/**
 * Kotak persetujuan: pemilik / admin memutuskan permintaan dari peran lain atas transaksi bernilai besar.
 * Disetujui → tindakan dijalankan (pesanan pembelian dikonfirmasi, jurnal manual diposting); ditolak → dicatat dengan alasan.
 */
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
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
import { SuppliersService } from '../purchasing/suppliers.service';
import { SalesOrdersService } from '../sales/orders/sales-orders.service';
import { PaymentsService } from '../sales/payments/payments.service';
import { WarehouseOpsService } from '../inventory/warehouse-ops';
import { ReturnsService } from '../returns/returns.service';
import { CustomersService } from '../master-data/customers/customers.service';
import { CreatePurchaseInvoiceDto } from '../purchasing/purchasing.dto';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SalesModule } from '../sales/sales.module';
import { ReturnsModule } from '../returns/returns.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AssetsModule, AssetsService } from '../assets/assets.module';
import { CashModule } from '../cash/cash.module';
import { CashService, type CreateCashTxDto } from '../cash/cash.module';
import { PettyCashService } from '../cash/petty-cash';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import type { StockAdjustmentDto } from '../inventory/dto/inventory.dto';
import type { CreateBillDto, CreateSupplierPaymentDto } from '../purchasing/purchasing.dto';
import type { DisposeDto } from '../assets/assets.module';

class PolicyDto implements Partial<ApprovalPolicy> {
  @ApiPropertyOptional({ description: 'Pesanan pembelian dengan total ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseOrder?: number;
  @ApiPropertyOptional({ description: 'Jurnal manual dengan total debit ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) manualJournal?: number;
  @ApiPropertyOptional({ description: 'Penyesuaian stok bernilai ≥ batas ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) stockAdjustment?: number;
  @ApiPropertyOptional({ description: 'Kas keluar / transfer dengan nilai ≥ batas ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) cashOut?: number;
  @ApiPropertyOptional({ description: 'Pelepasan aset tetap dengan harga perolehan ≥ nilai ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) assetDisposal?: number;
  @ApiPropertyOptional({ description: 'Permintaan pembelian dengan perkiraan nilai ≤ batas ini langsung disetujui otomatis; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) purchaseRequestAuto?: number;
  @ApiPropertyOptional({ description: 'Aktifkan pengendalian selisih harga faktur terhadap PO' }) @IsOptional() @IsBoolean() priceControl?: boolean;
  @ApiPropertyOptional({ description: 'Toleransi kenaikan harga faktur vs PO (%) per baris' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceTolerancePct?: number;
  @ApiPropertyOptional({ description: 'Toleransi harga faktur di atas rata-rata harga beli 90 hari (%)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000) priceBenchmarkPct?: number;
  @ApiPropertyOptional({ enum: ['OFF', 'APPROVAL', 'BLOCK'], description: 'Pengendalian belanja yang melewati anggaran' }) @IsOptional() @IsIn(['OFF', 'APPROVAL', 'BLOCK']) budgetControl?: 'OFF' | 'APPROVAL' | 'BLOCK';
  @ApiPropertyOptional({ description: 'Pembayaran pertama ke supplier wajib disetujui' }) @IsOptional() @IsBoolean() firstSupplierPayment?: boolean;
  @ApiPropertyOptional({ description: 'Penerimaan buta: Gudang mengisi jumlah yang dihitung sendiri' }) @IsOptional() @IsBoolean() blindReceiving?: boolean;
  @ApiPropertyOptional({ description: 'Pengiriman buta: Gudang mengisi jumlah yang dikemas sendiri' }) @IsOptional() @IsBoolean() blindDelivery?: boolean;
  @ApiPropertyOptional({ description: 'Pesanan penjualan bernilai ≥ ini oleh staf perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) salesOrder?: number;
  @ApiPropertyOptional({ description: 'Diskon per baris di atas persen ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(100) salesDiscountMaxPct?: number;
  @ApiPropertyOptional({ description: 'Retur penjualan bernilai ≥ ini oleh staf perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) salesReturn?: number;
  @ApiPropertyOptional({ description: 'Harga jual di bawah harga pokok rata-rata perlu persetujuan' }) @IsOptional() @IsBoolean() salesBelowCost?: boolean;
  @ApiPropertyOptional({ description: 'Pembayaran/retur atas faktur oleh pembuat fakturnya sendiri perlu persetujuan' }) @IsOptional() @IsBoolean() salesSeparateDuties?: boolean;
  @ApiPropertyOptional({ description: 'Pemilik diberi tahu bila penyesuaian stok keluar / selisih opname bernilai ≥ ini; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) stockAlertValue?: number;
  @ApiPropertyOptional({ description: 'Yang mengisi jumlah fisik opname tidak boleh memposting selisihnya' }) @IsOptional() @IsBoolean() stockCountSod?: boolean;
  @ApiPropertyOptional({ description: 'Opname buta: penghitung tidak melihat stok sistem' }) @IsOptional() @IsBoolean() blindCount?: boolean;
  @ApiPropertyOptional({ description: 'Penyesuaian stok masuk dengan harga pokok di atas rata-rata lebih dari persen ini perlu persetujuan; 0 = nonaktif' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1000) stockInCostTolerancePct?: number;
  @ApiPropertyOptional({ description: 'Pembuat transfer gudang tidak boleh menerimanya sendiri' }) @IsOptional() @IsBoolean() transferSod?: boolean;
  @ApiPropertyOptional({ description: 'Pembayaran ke supplier yang rekeningnya baru diubah (hari terakhir) wajib disetujui; 0 = nonaktif' }) @IsOptional() @IsInt() @Min(0) @Max(60) bankChangeHoldDays?: number;
  @ApiPropertyOptional({ description: 'Masa berlaku tautan persetujuan lewat Telegram (jam, 1–72)' }) @IsOptional() @IsInt() @Min(1) @Max(72) telegramLinkHours?: number;
}
class AssignDto {
  @ApiProperty({ description: 'Pengguna berwenang yang dipilih untuk memutuskan; kosong = semua penyetuju' }) @IsOptional() @IsUUID() approverId?: string;
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
    private readonly suppliers: SuppliersService,
    private readonly salesOrders: SalesOrdersService,
    private readonly paymentsSvc: PaymentsService,
    private readonly warehouseOps: WarehouseOpsService,
    private readonly returnsSvc: ReturnsService,
    private readonly customersSvc: CustomersService,
    private readonly accounting: AccountingService,
    private readonly assets: AssetsService,
    private readonly cash: CashService,
    private readonly petty: PettyCashService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListDto) {
    const approver = this.approvals.isApprover(user.role);
    const mineOnly = q.mine === 'true' || !approver;
    const rows = await this.db.execute<{
      id: string; kind: string; ref_id: string | null; title: string; amount: string; status: string; requested_at: string; decided_at: string | null;
      decision_note: string | null; result_ref: string | null; requested_by: string; decided_by: string | null; requested_by_id: string; assigned_to_id: string | null; assigned_to: string | null;
    }>(sql`
      SELECT r.id, r.kind, r.ref_id, r.title, r.amount, r.status, r.requested_at, r.decided_at, r.decision_note, r.result_ref, r.requested_by_id, r.assigned_to_id,
             u.name AS requested_by, d.name AS decided_by, a.name AS assigned_to
      FROM approval_requests r JOIN users u ON u.id = r.requested_by_id LEFT JOIN users d ON d.id = r.decided_by_id LEFT JOIN users a ON a.id = r.assigned_to_id
      WHERE r.tenant_id = ${user.tenantId}
        ${q.status === 'PENDING' ? sql`AND r.status = 'PENDING'` : sql``}
        ${mineOnly ? sql`AND r.requested_by_id = ${user.sub}` : user.role === 'OWNER' ? sql`` : sql`AND (r.assigned_to_id IS NULL OR r.assigned_to_id = ${user.sub} OR r.requested_by_id = ${user.sub} OR r.status <> 'PENDING')`}
      ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 200`);
    return rows.rows.map((r) => ({
      id: r.id, kind: r.kind, kindLabel: APPROVAL_KIND_LABELS[r.kind as keyof typeof APPROVAL_KIND_LABELS] ?? r.kind, refId: r.ref_id, title: r.title,
      amount: r.amount, status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, decisionNote: r.decision_note, resultRef: r.result_ref,
      requestedBy: r.requested_by, decidedBy: r.decided_by, mine: r.requested_by_id === user.sub,
      assignedToId: r.assigned_to_id, assignedTo: r.assigned_to,
      canDecide: r.status === 'PENDING' && approver && r.requested_by_id !== user.sub && (!r.assigned_to_id || r.assigned_to_id === user.sub || user.role === 'OWNER'),
    }));
  }

  async pendingCount(user: AuthUser) {
    if (!this.approvals.isApprover(user.role)) return { count: 0 };
    const r = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${user.tenantId} AND status = 'PENDING' AND requested_by_id <> ${user.sub}
      ${user.role === 'OWNER' ? sql`` : sql`AND (assigned_to_id IS NULL OR assigned_to_id = ${user.sub})`}`);
    return { count: r.rows[0].n };
  }

  private async load(user: AuthUser, id: string) {
    const [r] = await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), eq(approvalRequests.tenantId, user.tenantId)));
    if (!r) throw new NotFoundException('Permintaan persetujuan tidak ditemukan');
    return r;
  }

  /** Hanya penyetuju yang dipilih pemohon (atau Pemilik) yang boleh memutuskan permintaan yang sudah ditujukan */
  private assertAssignee(user: AuthUser, req: typeof approvalRequests.$inferSelect) {
    if (req.assignedToId && req.assignedToId !== user.sub && user.role !== 'OWNER') throw new ForbiddenException('Permintaan ini ditujukan kepada penyetuju lain yang dipilih pemohon');
  }

  /** Penyetuju yang berwenang untuk dipilih pemohon */
  approvers(user: AuthUser) {
    return this.approvals.eligibleApprovers(this.db, user.tenantId, user.sub);
  }

  /** Pemohon menunjuk penyetuju (atau mengosongkan = semua penyetuju) selama permintaan masih menunggu */
  async assign(user: AuthUser, id: string, dto: AssignDto) {
    const req = await this.load(user, id);
    if (req.requestedById !== user.sub) throw new ForbiddenException('Hanya pemohon yang dapat memilih penyetuju');
    if (req.status !== 'PENDING') throw new ConflictException('Permintaan ini sudah diputuskan');
    if (dto.approverId && !(await this.approvals.eligibleApprovers(this.db, user.tenantId, user.sub)).some((a) => a.id === dto.approverId)) throw new BadRequestException('Penyetuju yang dipilih tidak berwenang');
    await this.db.update(approvalRequests).set({ assignedToId: dto.approverId ?? null }).where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'ASSIGN', entity: 'ApprovalRequest', entityId: id, data: { approverId: dto.approverId ?? null } });
    void this.approvals.notifyApprovers(user.tenantId, { kind: 'AR', id, requesterId: user.sub, title: `${APPROVAL_KIND_LABELS[req.kind]}: ${req.title}`, lines: [`Nilai: Rp${Math.round(Number(req.amount)).toLocaleString('id-ID')}`], onlyIds: dto.approverId ? [dto.approverId] : undefined });
    return { id, assignedToId: dto.approverId ?? null };
  }

  async approve(user: AuthUser, id: string, dto: DecisionDto) {
    const req = await this.load(user, id);
    if (req.requestedById === user.sub) throw new ForbiddenException('Permintaan sendiri tidak bisa disetujui oleh pemohonnya');
    this.assertAssignee(user, req);
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
      } else if (req.kind === 'SALES_ORDER') {
        const so = await this.salesOrders.confirm(user, req.refId!);
        resultRef = so.number;
      } else if (req.kind === 'STOCK_COUNT') {
        const r = await this.warehouseOps.postCount(user, req.refId!, { approved: true });
        resultRef = (r as { adjustmentNumber?: string | null }).adjustmentNumber ?? undefined;
      } else if (req.kind === 'CUSTOMER_PAYMENT') {
        const pay = await this.paymentsSvc.create({ ...user, sub: req.requestedById }, req.payload as never, { approved: true });
        resultRef = (pay as { number?: string }).number;
      } else if (req.kind === 'SALES_RETURN') {
        // retur dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const r = await this.returnsSvc.createSales({ ...user, sub: req.requestedById }, req.payload as never, { approved: true });
        resultRef = (r as { number?: string }).number;
      } else if (req.kind === 'CUSTOMER_TERMS') {
        const c = await this.customersSvc.applyTerms({ ...user, sub: req.requestedById }, req.payload as never);
        resultRef = c.code;
      } else if (req.kind === 'SUPPLIER_BANK') {
        // rekening diubah atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const sp = await this.suppliers.applyBankChange({ ...user, sub: req.requestedById }, req.payload as never);
        resultRef = sp.code;
      } else if (req.kind === 'CASH_TX') {
        // dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const t = await this.cash.create({ ...user, sub: req.requestedById }, req.payload as unknown as CreateCashTxDto, { approved: true });
        resultRef = t.number;
      } else if (req.kind === 'STOCK_ADJUSTMENT') {
        const r = await this.inventory.adjust({ ...user, sub: req.requestedById }, req.payload as unknown as StockAdjustmentDto, undefined, { approved: true });
        resultRef = r.number;
      } else if (req.kind === 'BILL') {
        const b = await this.invoices.createBill({ ...user, sub: req.requestedById }, req.payload as unknown as CreateBillDto, { approved: true });
        resultRef = (b as { number?: string }).number;
      } else if (req.kind === 'SUPPLIER_PAYMENT') {
        const r = await this.invoices.pay({ ...user, sub: req.requestedById }, req.payload as unknown as CreateSupplierPaymentDto, { approved: true });
        resultRef = (r as { number?: string }).number;
      } else if (req.kind === 'PETTY_REPLENISH') {
        // dijalankan atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const r = await this.petty.executeReplenish({ ...user, sub: req.requestedById }, req.payload as unknown as { fundId: string; date?: string; voucherIds: string[] });
        resultRef = r.number;
      } else if (req.kind === 'ASSET_DISPOSAL') {
        const { id: assetId, ...dto } = req.payload as unknown as DisposeDto & { id: string };
        const a = await this.assets.dispose({ ...user, sub: req.requestedById }, assetId, dto, { approved: true });
        resultRef = a.code;
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
    void this.approvals.notifyUser(req.requestedById, `✅ Permintaan Anda disetujui\n${APPROVAL_KIND_LABELS[req.kind]}: ${req.title}${dto.note ? `\nCatatan: ${dto.note}` : ''}`);
    return (await this.list(user, { status: 'ALL' })).find((r) => r.id === id) ?? { id };
  }

  async reject(user: AuthUser, id: string, dto: DecisionDto) {
    const req = await this.load(user, id);
    this.assertAssignee(user, req);
    if (!dto.note?.trim()) throw new BadRequestException('Isi alasan penolakan');
    const done = await this.db
      .update(approvalRequests)
      .set({ status: 'REJECTED', decidedById: user.sub, decidedAt: new Date(), decisionNote: dto.note })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
      .returning({ id: approvalRequests.id });
    if (!done.length) throw new ConflictException('Permintaan ini sudah diputuskan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'REJECT', entity: 'ApprovalRequest', entityId: id, data: { kind: req.kind, title: req.title, note: dto.note } });
    void this.approvals.notifyUser(req.requestedById, `❌ Permintaan Anda ditolak\n${APPROVAL_KIND_LABELS[req.kind]}: ${req.title}\nAlasan: ${dto.note}`);
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
  imports: [AccountingModule, PurchasingModule, AssetsModule, CashModule, InventoryModule, SalesModule, ReturnsModule, MasterDataModule],
  controllers: [ApprovalsController, PublicApprovalLinksController],
  providers: [ApprovalRequestsService],
})
export class ApprovalsModule {}
