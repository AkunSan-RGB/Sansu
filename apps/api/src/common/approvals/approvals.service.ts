/**
 * Persetujuan transaksi bernilai besar.
 *
 * Perusahaan menetapkan batas nilai (0 = nonaktif) untuk pesanan pembelian dan jurnal manual. Peran yang berwenang
 * (OWNER dan ADMIN) tidak terkena batas: tindakan mereka adalah persetujuannya. Peran lain yang melewati batas membuat
 * permintaan yang menunggu keputusan; setelah disetujui, tindakannya dijalankan atas nama pemberi persetujuan.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { approvalRequests, type Role } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { SettingsService } from '../settings.service';

export const APPROVER_ROLES: readonly Role[] = ['OWNER', 'ADMIN'];
export type ApprovalKind = 'PURCHASE_ORDER' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE_PRICE';

export interface ApprovalPolicy {
  /** Pesanan pembelian dengan total ≥ nilai ini perlu persetujuan (0 = nonaktif) */
  purchaseOrder: number;
  /** Jurnal manual dengan total debit ≥ nilai ini perlu persetujuan (0 = nonaktif) */
  manualJournal: number;
  /** Permintaan pembelian dengan perkiraan nilai ≤ batas ini langsung disetujui otomatis (0 = nonaktif, semua menunggu keputusan) */
  purchaseRequestAuto: number;
  /** Pengendalian selisih harga faktur terhadap PO (anti-fraud) */
  priceControl: boolean;
  /** Faktur yang harganya lebih mahal dari PO melebihi persen ini (per baris) butuh persetujuan */
  priceTolerancePct: number;
  /** Harga faktur di atas rata-rata harga beli 90 hari terakhir lebih dari persen ini juga butuh persetujuan */
  priceBenchmarkPct: number;
}
export const DEFAULT_APPROVALS: ApprovalPolicy = { purchaseOrder: 0, manualJournal: 0, purchaseRequestAuto: 0, priceControl: true, priceTolerancePct: 5, priceBenchmarkPct: 10 };

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  PURCHASE_ORDER: 'Pesanan pembelian',
  MANUAL_JOURNAL: 'Jurnal manual',
  PURCHASE_INVOICE_PRICE: 'Faktur supplier — harga di atas toleransi',
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async policy(db: DbOrTx, tenantId: string): Promise<ApprovalPolicy> {
    return this.settings.section(db, tenantId, 'approvals', DEFAULT_APPROVALS);
  }

  savePolicy(db: DbOrTx, tenantId: string, patch: Partial<ApprovalPolicy>) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<ApprovalPolicy>;
    return this.settings.saveSection(db, tenantId, 'approvals', DEFAULT_APPROVALS, clean);
  }

  isApprover(role: Role) {
    return APPROVER_ROLES.includes(role);
  }

  /** Apakah transaksi bernilai `amount` ini perlu persetujuan dari pengguna ini? */
  async needs(db: DbOrTx, user: AuthUser, kind: ApprovalKind, amount: number): Promise<number | null> {
    if (this.isApprover(user.role)) return null;
    const limit = (await this.policy(db, user.tenantId))[kind === 'PURCHASE_ORDER' ? 'purchaseOrder' : 'manualJournal'];
    return limit > 0 && amount >= limit ? limit : null;
  }

  /**
   * Gerbang untuk dokumen yang sudah ada (pesanan pembelian). Mengembalikan bila sudah disetujui; bila belum, membuat
   * permintaan (di luar transaksi pemanggil agar tidak ikut dibatalkan) lalu melempar 409 APPROVAL_REQUIRED.
   */
  async gateDocument(db: DbOrTx, user: AuthUser, p: { kind: ApprovalKind; refId: string; title: string; amount: number }) {
    const limit = await this.needs(db, user, p.kind, p.amount);
    if (limit === null) return;
    const [existing] = await db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.tenantId, user.tenantId), eq(approvalRequests.kind, p.kind), eq(approvalRequests.refId, p.refId), inArray(approvalRequests.status, ['PENDING', 'APPROVED'])));
    if (existing?.status === 'APPROVED') return;
    if (existing) throw this.required(existing.id, 'Permintaan persetujuan sudah dikirim dan masih menunggu keputusan pemilik atau admin.');
    const request = await this.create(db, user, { ...p, payload: null });
    throw this.required(request.id, `Nilai ${APPROVAL_KIND_LABELS[p.kind].toLowerCase()} mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin.`);
  }

  /** Buat permintaan baru dan catat di jejak audit */
  async create(db: DbOrTx, user: AuthUser, p: { kind: ApprovalKind; refId: string | null; title: string; amount: number; payload: Record<string, unknown> | null }) {
    const [row] = await db
      .insert(approvalRequests)
      .values({ tenantId: user.tenantId, kind: p.kind, refId: p.refId, title: p.title, amount: p.amount.toFixed(2), payload: p.payload, requestedById: user.sub })
      .returning();
    await this.audit.log(db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'ApprovalRequest', entityId: row.id, data: { kind: p.kind, title: p.title, amount: p.amount } });
    return row;
  }

  required(requestId: string, message: string) {
    return new ConflictException({ statusCode: 409, code: 'APPROVAL_REQUIRED', requestId, message });
  }
}
