import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { APPROVAL_KIND_LABELS, ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { approvalRequests } from '../../db/schema';
import { AccountingService } from '../accounting/accounting.service';
import { CreateJournalDto } from '../accounting/dto/accounting.dto';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service';
import { PurchaseInvoicesService } from '../purchasing/purchase-invoices.service';
import { CreateSupplierAdvanceDto } from '../purchasing/supplier-advances.dto';
import { SupplierAdvancesService } from '../purchasing/supplier-advances.service';
import { SuppliersService } from '../purchasing/suppliers.service';
import { SalesOrdersService } from '../sales/orders/sales-orders.service';
import { PaymentsService } from '../sales/payments/payments.service';
import { WarehouseOpsService } from '../inventory/warehouse-ops.service';
import { BinsService } from '../inventory/bins.service';
import { type MoveBinsDto } from '../inventory/bins.dto';
import { ReturnsService } from '../returns/returns.service';
import { CustomersService } from '../master-data/customers/customers.service';
import { CreatePurchaseInvoiceDto } from '../purchasing/purchasing.dto';
import { AssetsService } from '../assets/assets.service';
import { CashService } from '../cash/cash.service';
import { type CreateCashTxDto } from '../cash/cash.dto';
import { PettyCashService } from '../cash/petty-cash.service';
import { InventoryService } from '../inventory/inventory.service';
import type { StockAdjustmentDto } from '../inventory/dto/inventory.dto';
import type { CreateBillDto, CreateSupplierPaymentDto } from '../purchasing/purchasing.dto';
import type { ChangeMethodDto, DisposeDto } from '../assets/assets.dto';
import { ListDto, AssignDto, DecisionDto, PolicyDto } from './approvals.dto';
import { SupplierPaymentsService } from '../purchasing/supplier-payments.service';
import { AssetDisposalService } from '../assets/asset-disposal.service';
import { AssetMethodService } from '../assets/asset-method.service';
import { SupplierBillsService } from '../purchasing/supplier-bills.service';
import { findOwned, patchById } from '../../db/owned';

@Injectable()
export class ApprovalRequestsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly orders: PurchaseOrdersService,
    private readonly invoices: PurchaseInvoicesService,
    private readonly advances: SupplierAdvancesService,
    private readonly bins: BinsService,
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
    private readonly supplierPayments: SupplierPaymentsService,
    private readonly assetDisposal: AssetDisposalService,
    private readonly assetMethod: AssetMethodService,
    private readonly supplierBills: SupplierBillsService,
  ) {}

  policy(user: AuthUser) {
    return this.approvals.policy(this.db, user.tenantId);
  }

  /** Isi permintaan persetujuan (jsonb) sebagai tipe yang diharapkan pemanggil; kosong = permintaan rusak */
  private payloadOf<T>(req: { payload: Record<string, unknown> | null }): T {
    if (!req.payload) throw new BadRequestException('Permintaan persetujuan tidak memuat isi');
    return req.payload as T;
  }

  async savePolicy(user: AuthUser, dto: PolicyDto) {
    const before = await this.approvals.policy(this.db, user.tenantId);
    const after = await this.approvals.savePolicy(this.db, user.tenantId, dto);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'ApprovalPolicy', entityId: user.tenantId, data: { before, after } });
    return after;
  }

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
    const r = await findOwned(this.db, approvalRequests, user.tenantId, id);
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
        const inv = await this.invoices.createFromOrder({ ...user, sub: req.requestedById }, this.payloadOf<CreatePurchaseInvoiceDto>(req), { approvalId: id });
        resultRef = inv.number;
      } else if (req.kind === 'SALES_ORDER') {
        const so = await this.salesOrders.confirm(user, req.refId!);
        resultRef = so.number;
      } else if (req.kind === 'STOCK_COUNT') {
        const r = await this.warehouseOps.postCount(user, req.refId!, { approved: true });
        resultRef = (r as { adjustmentNumber?: string | null }).adjustmentNumber ?? undefined;
      } else if (req.kind === 'CUSTOMER_PAYMENT') {
        const pay = await this.paymentsSvc.create({ ...user, sub: req.requestedById }, this.payloadOf(req), { approved: true });
        resultRef = (pay as { number?: string }).number;
      } else if (req.kind === 'AR_WRITE_OFF') {
        const w = await this.paymentsSvc.writeOff({ ...user, sub: req.requestedById }, this.payloadOf(req), { approved: true });
        resultRef = (w as { number?: string }).number;
      } else if (req.kind === 'SALES_RETURN') {
        // retur dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const r = await this.returnsSvc.createSales({ ...user, sub: req.requestedById }, this.payloadOf(req), { approved: true });
        resultRef = (r as { number?: string }).number;
      } else if (req.kind === 'CUSTOMER_TERMS') {
        const c = await this.customersSvc.applyTerms({ ...user, sub: req.requestedById }, this.payloadOf(req));
        resultRef = c.code;
      } else if (req.kind === 'SUPPLIER_BANK') {
        // rekening diubah atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const sp = await this.suppliers.applyBankChange({ ...user, sub: req.requestedById }, this.payloadOf(req));
        resultRef = sp.code;
      } else if (req.kind === 'CASH_TX') {
        // dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const t = await this.cash.create({ ...user, sub: req.requestedById }, this.payloadOf<CreateCashTxDto>(req), { approved: true });
        resultRef = t.number;
      } else if (req.kind === 'STOCK_ADJUSTMENT') {
        const r = await this.inventory.adjust({ ...user, sub: req.requestedById }, this.payloadOf<StockAdjustmentDto>(req), undefined, { approved: true });
        resultRef = r.number;
      } else if (req.kind === 'BILL') {
        const b = await this.supplierBills.createBill({ ...user, sub: req.requestedById }, this.payloadOf<CreateBillDto>(req), { approved: true });
        resultRef = (b as { number?: string }).number;
      } else if (req.kind === 'SUPPLIER_PAYMENT') {
        const r = await this.supplierPayments.pay({ ...user, sub: req.requestedById }, this.payloadOf<CreateSupplierPaymentDto>(req), { approved: true });
        resultRef = (r as { number?: string }).number;
      } else if (req.kind === 'BIN_MOVE') {
        await this.bins.move({ ...user, sub: req.requestedById }, this.payloadOf<MoveBinsDto>(req), { approved: true });
        resultRef = 'Stok dipindah antar rak';
      } else if (req.kind === 'SUPPLIER_ADVANCE') {
        const r = await this.advances.create({ ...user, sub: req.requestedById }, this.payloadOf<CreateSupplierAdvanceDto>(req), { approved: true });
        resultRef = (r as { number?: string }).number;
      } else if (req.kind === 'PETTY_REPLENISH') {
        // dijalankan atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const r = await this.petty.executeReplenish({ ...user, sub: req.requestedById }, this.payloadOf<{ fundId: string; date?: string; voucherIds: string[] }>(req));
        resultRef = r.number;
      } else if (req.kind === 'ASSET_METHOD') {
        // dijalankan atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const pl = this.payloadOf<ChangeMethodDto & { id?: string; categoryId?: string }>(req);
        if (pl.categoryId) {
          const r = await this.assetMethod.changeCategoryMethod({ ...user, sub: req.requestedById }, pl.categoryId, pl, { approved: true });
          resultRef = `${r.changed.length} aset diubah`;
        } else {
          const a = await this.assetMethod.changeMethod({ ...user, sub: req.requestedById }, pl.id!, pl, { approved: true });
          resultRef = a.code;
        }
      } else if (req.kind === 'ASSET_DISPOSAL') {
        const { id: assetId, ...dto } = this.payloadOf<DisposeDto & { id: string }>(req);
        const a = await this.assetDisposal.dispose({ ...user, sub: req.requestedById }, assetId, dto, { approved: true });
        resultRef = a.code;
      } else {
        // dicatat atas nama pemohon; penyetuju tercatat di permintaan dan jejak audit
        const j = await this.accounting.createManualJournal({ ...user, sub: req.requestedById }, this.payloadOf<CreateJournalDto>(req), { approved: true });
        resultRef = j.number;
      }
      await patchById(this.db, approvalRequests, id, { resultRef });
    } catch (e) {
      // gagal dijalankan (mis. PO sudah dibatalkan): kembalikan ke menunggu agar bisa ditolak atau dicoba lagi
      await patchById(this.db, approvalRequests, id, { status: 'PENDING', decidedById: null, decidedAt: null, decisionNote: null });
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
