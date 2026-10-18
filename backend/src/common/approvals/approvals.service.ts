/**
 * Persetujuan transaksi bernilai besar.
 *
 * Perusahaan menetapkan batas nilai (0 = nonaktif) untuk pesanan pembelian dan jurnal manual. Peran yang berwenang
 * (OWNER dan ADMIN) tidak terkena batas: tindakan mereka adalah persetujuannya. Peran lain yang melewati batas membuat
 * permintaan yang menunggu keputusan; setelah disetujui, tindakannya dijalankan atas nama pemberi persetujuan.
 */
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { approvalRequests, users, type Role } from '../../db/schema';
import { appUrl, MailService } from '../mail/mail.service';
import { signApprovalLink } from './approval-link';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { SettingsService } from '../settings.service';
import { TelegramService } from '../telegram/telegram.service';

export const APPROVER_ROLES: readonly Role[] = ['OWNER', 'ADMIN'];
export type ApprovalKind = 'PURCHASE_ORDER' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE_PRICE' | 'ASSET_DISPOSAL' | 'CASH_TX' | 'PETTY_REPLENISH' | 'STOCK_ADJUSTMENT' | 'SUPPLIER_PAYMENT' | 'BILL';

export interface ApprovalPolicy {
  /** Pesanan pembelian dengan total ≥ nilai ini perlu persetujuan (0 = nonaktif) */
  purchaseOrder: number;
  /** Jurnal manual dengan total debit ≥ nilai ini perlu persetujuan (0 = nonaktif) */
  manualJournal: number;
  /** Pelepasan aset tetap dengan harga perolehan ≥ nilai ini perlu persetujuan (0 = nonaktif) */
  assetDisposal: number;
  /** Kas keluar / transfer dengan nilai ≥ batas ini perlu persetujuan (0 = nonaktif) */
  cashOut: number;
  /** Penyesuaian stok bernilai ≥ batas ini (masuk + keluar) perlu persetujuan (0 = nonaktif) */
  stockAdjustment: number;
  /** Permintaan pembelian dengan perkiraan nilai ≤ batas ini langsung disetujui otomatis (0 = nonaktif, semua menunggu keputusan) */
  purchaseRequestAuto: number;
  /** Pengendalian selisih harga faktur terhadap PO (anti-fraud) */
  priceControl: boolean;
  /** Faktur yang harganya lebih mahal dari PO melebihi persen ini (per baris) butuh persetujuan */
  priceTolerancePct: number;
  /** Harga faktur di atas rata-rata harga beli 90 hari terakhir lebih dari persen ini juga butuh persetujuan */
  priceBenchmarkPct: number;
  /**
   * Pengendalian anggaran saat belanja (kas keluar, tagihan biaya, jurnal manual) yang membuat realisasi beban melewati anggaran + toleransi:
   * OFF = hanya peringatan; APPROVAL = staf butuh persetujuan Pemilik/Admin; BLOCK = ditolak (hanya Pemilik yang bisa menembus dengan alasan)
   */
  budgetControl: 'OFF' | 'APPROVAL' | 'BLOCK';
  /** Pembayaran PERTAMA ke supplier oleh peran selain pemilik/admin wajib disetujui (anti pemasok fiktif) */
  firstSupplierPayment: boolean;
  /** Masa berlaku tautan persetujuan yang dikirim lewat Telegram (jam, 1–72); email tetap 72 jam */
  telegramLinkHours: number;
}
export const DEFAULT_APPROVALS: ApprovalPolicy = { purchaseOrder: 0, manualJournal: 0, assetDisposal: 0, cashOut: 0, stockAdjustment: 0, purchaseRequestAuto: 0, priceControl: true, priceTolerancePct: 5, priceBenchmarkPct: 10, firstSupplierPayment: false, budgetControl: 'OFF', telegramLinkHours: 72 };

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  PURCHASE_ORDER: 'Pesanan pembelian',
  MANUAL_JOURNAL: 'Jurnal manual',
  PURCHASE_INVOICE_PRICE: 'Faktur supplier — harga di atas toleransi',
  ASSET_DISPOSAL: 'Pelepasan aset tetap',
  CASH_TX: 'Kas keluar / transfer',
  PETTY_REPLENISH: 'Pengisian kembali kas kecil',
  STOCK_ADJUSTMENT: 'Penyesuaian stok',
  SUPPLIER_PAYMENT: 'Pembayaran ke supplier',
  BILL: 'Tagihan biaya / aset',
};

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger('Persetujuan');
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    @InjectDb() private readonly db: Db,
  ) {}

  /**
   * Beri tahu pemilik/admin lewat email dengan tautan pribadi untuk menyetujui atau menolak tanpa login
   * (halaman ringkasan; keputusan baru diambil saat tombol ditekan). Gagal kirim tidak menggagalkan transaksi.
   */
  async notifyApprovers(tenantId: string, p: { kind: 'AR' | 'PR'; id: string; requesterId?: string | null; title: string; lines: string[]; onlyIds?: string[] }) {
    try {
      const to = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, [...APPROVER_ROLES]), p.requesterId ? ne(users.id, p.requesterId) : undefined, p.onlyIds?.length ? inArray(users.id, p.onlyIds) : undefined));
      const hours = Math.min(72, Math.max(1, (await this.policy(this.db, tenantId)).telegramLinkHours || 72));
      for (const t of to) {
        const token = signApprovalLink({ k: p.kind, r: p.id, u: t.id });
        const url = `${appUrl()}/approve/${token}`;
        const tgUrl = `${appUrl()}/approve/${signApprovalLink({ k: p.kind, r: p.id, u: t.id }, Date.now(), hours * 3600_000)}`;
        // Telegram (bila pengguna menghubungkannya): pesan ringkas dengan tautan pribadi yang sama
        await this.telegram.notifyUsers([t.id], `🔔 Perlu persetujuan\n${p.title}\n${p.lines.join('\n')}\n\nTinjau dan putuskan (tautan pribadi, berlaku ${hours} jam):\n${tgUrl}`);
        if (!this.mail.configured) continue;
        await this.mail.send({
          to: t.email,
          subject: `Perlu persetujuan: ${p.title}`,
          heading: 'Menunggu persetujuan Anda',
          paragraphs: [p.title, ...p.lines, 'Tautan ini pribadi untuk Anda dan berlaku 72 jam. Anda bisa menyetujui atau menolak langsung dari halaman yang terbuka, tanpa login.'],
          action: { label: 'Tinjau dan putuskan', url },
        });
      }
    } catch (e) {
      this.logger.warn(`Email persetujuan gagal: ${(e as Error).message}`);
    }
  }

  /**
   * Beri tahu pengguna berperan tertentu bahwa ada proses yang menunggu tindakan mereka (Telegram bila terhubung, email bila dikonfigurasi).
   * Pelaku proses (`excludeUserId`) tidak diberi tahu: dia bukan yang memutuskan (pemisahan fungsi). Gagal kirim tidak menggagalkan proses.
   */
  async notifyRoles(tenantId: string, p: { roles: readonly Role[]; excludeUserId?: string; title: string; lines?: string[]; path: string }) {
    try {
      const to = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, [...p.roles]), p.excludeUserId ? ne(users.id, p.excludeUserId) : undefined));
      const url = `${appUrl()}${p.path}`;
      await this.telegram.notifyUsers(to.map((t) => t.id), `🔔 Menunggu tindakan Anda\n${p.title}\n${(p.lines ?? []).join('\n')}\n${url}`);
      if (!this.mail.configured) return;
      for (const t of to) {
        await this.mail.send({ to: t.email, subject: `Menunggu tindakan Anda: ${p.title}`, heading: 'Menunggu tindakan Anda', paragraphs: [p.title, ...(p.lines ?? [])], action: { label: 'Buka SANSU', url } });
      }
    } catch (e) {
      this.logger.warn(`Notifikasi proses gagal: ${(e as Error).message}`);
    }
  }

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

  /** Pengguna yang berwenang memutuskan (peran penyetuju, aktif), selain pemohon sendiri */
  async eligibleApprovers(db: DbOrTx, tenantId: string, excludeUserId?: string) {
    return db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, [...APPROVER_ROLES]), excludeUserId ? ne(users.id, excludeUserId) : undefined));
  }

  /** Apakah transaksi bernilai `amount` ini perlu persetujuan dari pengguna ini? */
  async needs(db: DbOrTx, user: AuthUser, kind: ApprovalKind, amount: number): Promise<number | null> {
    if (this.isApprover(user.role)) return null;
    const pol = await this.policy(db, user.tenantId);
    const limit = kind === 'PURCHASE_ORDER' ? pol.purchaseOrder : kind === 'ASSET_DISPOSAL' ? pol.assetDisposal : kind === 'CASH_TX' || kind === 'SUPPLIER_PAYMENT' ? pol.cashOut : kind === 'STOCK_ADJUSTMENT' ? pol.stockAdjustment : pol.manualJournal;
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
  async create(db: DbOrTx, user: AuthUser, p: { kind: ApprovalKind; refId: string | null; title: string; amount: number; payload: Record<string, unknown> | null; approverId?: string }) {
    if (p.approverId && !(await this.eligibleApprovers(db, user.tenantId, user.sub)).some((a) => a.id === p.approverId)) throw new BadRequestException('Penyetuju yang dipilih tidak berwenang');
    const [row] = await db
      .insert(approvalRequests)
      .values({ tenantId: user.tenantId, kind: p.kind, refId: p.refId, title: p.title, amount: p.amount.toFixed(2), payload: p.payload, requestedById: user.sub, assignedToId: p.approverId ?? null })
      .returning();
    await this.audit.log(db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'ApprovalRequest', entityId: row.id, data: { kind: p.kind, title: p.title, amount: p.amount } });
    void this.notifyApprovers(user.tenantId, { kind: 'AR', id: row.id, requesterId: user.sub, title: `${APPROVAL_KIND_LABELS[p.kind]}: ${p.title}`, lines: [`Nilai: Rp${Math.round(p.amount).toLocaleString('id-ID')}`], onlyIds: p.approverId ? [p.approverId] : undefined });
    return row;
  }

  required(requestId: string, message: string) {
    return new ConflictException({ statusCode: 409, code: 'APPROVAL_REQUIRED', requestId, message });
  }
}
