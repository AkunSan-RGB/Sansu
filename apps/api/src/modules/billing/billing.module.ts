import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked, PlatformAdminGuard, platformAdminEmails } from '../../common/auth/platform-admin';
import { AuditService } from '../../common/audit/audit.service';
import { BillingSettings, SubscriptionService } from '../../common/billing/subscription.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { systemStatus, telegram } from '../../common/monitor/error-monitor';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { billingInvoices, plans, subscriptions, tenants, users } from '../../db/schema';
import { activeGateway, midtrans, xendit, type PaymentNotice } from './gateways';

const DAY = 86_400_000;
const rupiah = (n: number | string) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
const tgl = (d: Date | string) =>
  new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const CYCLE_LABEL = { MONTHLY: '1 bulan', YEARLY: '1 tahun' } as const;

/** Tambah n bulan, tanggal dijepit ke akhir bulan (31 Jan + 1 bln = 28/29 Feb) */
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

// ---------- DTO ----------
export class CreateBillingInvoiceDto {
  @ApiProperty() @IsString() planId: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) @IsIn(['MONTHLY', 'YEARLY']) cycle: 'MONTHLY' | 'YEARLY';
}
export class ProofDto {
  @ApiProperty({ description: 'Foto/PDF bukti transfer sebagai data URL (maks. ±2 MB)' })
  @IsString()
  @MaxLength(2_800_000, { message: 'File bukti terlalu besar (maks. ±2 MB)' })
  @Matches(/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/, {
    message: 'Bukti harus gambar (PNG/JPG/WebP) atau PDF',
  })
  proof: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class RejectDto {
  @ApiProperty() @IsString() @MaxLength(300) reason: string;
}
export class PlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'Kode hanya huruf besar, angka, - dan _' })
  code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() priceMonthly?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() priceYearly?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxUsers?:
    number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  maxWarehouses?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() planId?: string;
  @ApiPropertyOptional({ enum: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'])
  status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] }) @IsOptional() @IsIn(['MONTHLY', 'YEARLY']) cycle?:
    'MONTHLY' | 'YEARLY';
  @ApiPropertyOptional({ description: 'Akhir trial (ISO)' }) @IsOptional() @IsDateString() trialEndsAt?: string;
  @ApiPropertyOptional({ description: 'Akhir masa aktif (ISO); null = tanpa batas', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  currentPeriodEnd?: string | null;
  @ApiPropertyOptional({ description: 'Tambah hari ke masa trial / aktif' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3660)
  extendDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class BillingSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) bankHolder?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) trialDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(30) graceDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() trialPlanCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) supportWhatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(30) renewalNoticeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sellerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) sellerNpwp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) sellerAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() vatEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) @Max(20) vatRate?: number;
}
export class TestEmailDto {
  @ApiProperty() @IsEmail() to: string;
}

// ---------- Service ----------
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Langganan');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  get database() {
    return this.db;
  }

  /** Kontak dukungan untuk Pusat Bantuan (semua pengguna) */
  async support() {
    const s = await this.subs.settings();
    return {
      whatsapp: s.supportWhatsapp || '',
      email: process.env.SUPPORT_EMAIL || platformAdminEmails()[0] || '',
      company: s.sellerName,
    };
  }

  /** Email pemilik & admin aktif perusahaan */
  private async ownerEmails(tenantId: string, db: DbOrTx = this.db) {
    const rows = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])))
      .orderBy(asc(users.createdAt));
    return rows;
  }

  private async notifyOwners(
    tenantId: string,
    subject: string,
    heading: string,
    paragraphs: string[],
    action?: { label: string; url: string },
  ) {
    for (const o of await this.ownerEmails(tenantId)) {
      await this.mail.send({ to: o.email, subject, heading, paragraphs: [`Halo ${o.name},`, ...paragraphs], action });
    }
  }

  private async nextNumber(tx: DbOrTx) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(727002)`);
    const now = new Date();
    const prefix = `SNS/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/`;
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(billingInvoices)
      .where(sql`${billingInvoices.number} LIKE ${`${prefix}%`}`);
    return `${prefix}${String(r.n + 1).padStart(4, '0')}`;
  }

  // ===== Sisi pelanggan =====
  async overview(u: AuthUser) {
    const [state, usage, settings, planRows, invoices] = await Promise.all([
      this.subs.state(u.tenantId, true),
      this.subs.usage(u.tenantId),
      this.subs.settings(),
      this.db
        .select()
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly)),
      this.db
        .select({
          id: billingInvoices.id,
          number: billingInvoices.number,
          planId: billingInvoices.planId,
          planName: plans.name,
          cycle: billingInvoices.cycle,
          subtotal: billingInvoices.subtotal,
          vatRate: billingInvoices.vatRate,
          vatAmount: billingInvoices.vatAmount,
          amount: billingInvoices.amount,
          status: billingInvoices.status,
          method: billingInvoices.method,
          dueDate: billingInvoices.dueDate,
          hasProof: sql<boolean>`${billingInvoices.proof} IS NOT NULL`,
          proofNote: billingInvoices.proofNote,
          rejectReason: billingInvoices.rejectReason,
          gatewayUrl: billingInvoices.gatewayUrl,
          paidAt: billingInvoices.paidAt,
          periodStart: billingInvoices.periodStart,
          periodEnd: billingInvoices.periodEnd,
          createdAt: billingInvoices.createdAt,
        })
        .from(billingInvoices)
        .innerJoin(plans, eq(plans.id, billingInvoices.planId))
        .where(eq(billingInvoices.tenantId, u.tenantId))
        .orderBy(desc(billingInvoices.createdAt))
        .limit(50),
    ]);
    return {
      subscription: state,
      usage,
      plans: planRows,
      invoices,
      payment: {
        gateway: activeGateway(),
        bank: settings.bankAccount
          ? { name: settings.bankName, account: settings.bankAccount, holder: settings.bankHolder }
          : null,
        supportWhatsapp: settings.supportWhatsapp,
      },
    };
  }

  /** Buat tagihan untuk paket & siklus pilihan (tagihan lama yang belum dibayar dibatalkan) */
  async createInvoice(u: AuthUser, dto: CreateBillingInvoiceDto, opts: { auto?: boolean } = {}) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, dto.planId), eq(plans.isActive, true)));
    if (!plan) throw new BadRequestException('Paket tidak ditemukan');
    const usage = await this.subs.usage(u.tenantId);
    if (plan.maxUsers != null && usage.users > plan.maxUsers) {
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxUsers} pengguna aktif, saat ini ada ${usage.users}. Nonaktifkan sebagian pengguna atau pilih paket lebih besar.`,
      );
    }
    if (plan.maxWarehouses != null && usage.warehouses > plan.maxWarehouses) {
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxWarehouses} gudang, saat ini ada ${usage.warehouses}. Pilih paket lebih besar.`,
      );
    }
    const subtotal = Number(dto.cycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly);
    const bs = await this.subs.settings();
    const vatRate = bs.vatEnabled ? Number(bs.vatRate) : 0;
    const vatAmount = Math.round((subtotal * vatRate) / 100);
    const amount = (subtotal + vatAmount).toFixed(2);
    const inv = await this.db.transaction(async (tx) => {
      await tx
        .update(billingInvoices)
        .set({ status: 'CANCELLED' })
        .where(and(eq(billingInvoices.tenantId, u.tenantId), eq(billingInvoices.status, 'UNPAID')));
      const [row] = await tx
        .insert(billingInvoices)
        .values({
          tenantId: u.tenantId,
          number: await this.nextNumber(tx),
          planId: plan.id,
          cycle: dto.cycle,
          subtotal: subtotal.toFixed(2),
          vatRate: vatRate.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          amount,
          dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10),
          createdBy: opts.auto ? null : u.sub,
        })
        .returning();
      return row;
    });
    const st = await this.subs.state(u.tenantId, true);
    await this.notifyOwners(
      u.tenantId,
      `Tagihan SANSU ${inv.number}`,
      opts.auto ? 'Tagihan perpanjangan langganan' : 'Tagihan langganan dibuat',
      [
        `Tagihan ${inv.number} untuk paket ${plan.name} (${CYCLE_LABEL[dto.cycle]}) sebesar ${rupiah(amount)}${vatAmount ? ` (termasuk PPN ${rupiah(vatAmount)})` : ''}.`,
        st.endsAt
          ? `Masa aktif Anda saat ini sampai ${tgl(st.endsAt)}. Pembayaran akan memperpanjang dari tanggal tersebut.`
          : 'Pembayaran akan langsung mengaktifkan paket.',
        'Bayar lewat menu Langganan di aplikasi.',
      ],
      { label: 'Bayar tagihan', url: `${appUrl()}/billing` },
    );
    return inv;
  }

  private async ownInvoice(tenantId: string, id: string) {
    const [inv] = await this.db
      .select()
      .from(billingInvoices)
      .where(and(eq(billingInvoices.id, id), eq(billingInvoices.tenantId, tenantId)));
    if (!inv) throw new NotFoundException('Tagihan tidak ditemukan');
    return inv;
  }

  /** Bayar lewat gerbang pembayaran (VA/QRIS/e-wallet) → kembalikan tautan pembayaran */
  async payOnline(u: AuthUser, id: string) {
    const gw = activeGateway();
    if (!gw)
      throw new BadRequestException('Pembayaran online belum diaktifkan. Silakan transfer manual lalu unggah bukti.');
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status === 'PAID' || inv.status === 'CANCELLED')
      throw new BadRequestException('Tagihan ini sudah tidak bisa dibayar');
    if (inv.gatewayUrl && inv.method === gw) return { url: inv.gatewayUrl };
    const [me] = await this.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, u.sub));
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, inv.planId));
    const input = {
      orderId: inv.number,
      amount: Number(inv.amount),
      description: `Langganan SANSU ${plan?.name ?? ''} ${CYCLE_LABEL[inv.cycle]}`.trim(),
      customer: { name: me.name, email: me.email },
      finishUrl: `${appUrl()}/billing?paid=${encodeURIComponent(inv.number)}`,
    };
    const r = gw === 'MIDTRANS' ? await midtrans.checkout(input) : await xendit.checkout(input);
    await this.db
      .update(billingInvoices)
      .set({ method: gw, gatewayRef: r.ref, gatewayUrl: r.url })
      .where(eq(billingInvoices.id, inv.id));
    return { url: r.url };
  }

  /** Unggah bukti transfer manual */
  async submitProof(u: AuthUser, id: string, dto: ProofDto) {
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status !== 'UNPAID' && inv.status !== 'WAITING')
      throw new BadRequestException('Tagihan ini sudah tidak menunggu pembayaran');
    await this.db
      .update(billingInvoices)
      .set({ status: 'WAITING', method: 'MANUAL', proof: dto.proof, proofNote: dto.note ?? null, rejectReason: null })
      .where(eq(billingInvoices.id, inv.id));
    const [t] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, u.tenantId));
    for (const to of platformAdminEmails()) {
      await this.mail.send({
        to,
        subject: `Bukti transfer masuk: ${inv.number}`,
        heading: 'Ada bukti transfer yang perlu dikonfirmasi',
        paragraphs: [
          `${t?.name ?? 'Pelanggan'} mengirim bukti transfer untuk ${inv.number} sebesar ${rupiah(inv.amount)}.`,
          dto.note ? `Catatan: ${dto.note}` : '',
        ].filter(Boolean),
        action: { label: 'Buka panel admin', url: `${appUrl()}/platform?tab=payments` },
      });
    }
    return { ok: true };
  }

  async cancelInvoice(u: AuthUser, id: string) {
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status !== 'UNPAID') throw new BadRequestException('Hanya tagihan yang belum dibayar yang bisa dibatalkan');
    await this.db.update(billingInvoices).set({ status: 'CANCELLED' }).where(eq(billingInvoices.id, inv.id));
    return { ok: true };
  }

  /**
   * Tandai lunas & perpanjang langganan. Idempoten: tagihan yang sudah lunas tidak diproses dua kali.
   * Masa aktif baru dimulai dari akhir masa aktif/trial sekarang (bila masih berjalan), atau dari hari ini.
   */
  async markPaid(invoiceId: string, by: string, ref?: string | null) {
    const done = await this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(billingInvoices).where(eq(billingInvoices.id, invoiceId)).for('update');
      if (!inv) throw new NotFoundException('Tagihan tidak ditemukan');
      if (inv.status === 'PAID') return null;
      if (inv.status === 'CANCELLED' && by !== 'gateway') throw new BadRequestException('Tagihan sudah dibatalkan');
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, inv.tenantId)).for('update');
      const now = new Date();
      let start = now;
      if (sub?.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) start = sub.currentPeriodEnd;
      if (sub?.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt > now) start = sub.trialEndsAt;
      const end = addMonths(start, inv.cycle === 'YEARLY' ? 12 : 1);
      await tx
        .update(billingInvoices)
        .set({
          status: 'PAID',
          paidAt: now,
          confirmedBy: by,
          gatewayRef: ref ?? inv.gatewayRef,
          periodStart: start,
          periodEnd: end,
        })
        .where(eq(billingInvoices.id, inv.id));
      const values = {
        planId: inv.planId,
        status: 'ACTIVE' as const,
        cycle: inv.cycle,
        currentPeriodEnd: end,
        reminders: {},
        updatedAt: now,
      };
      if (sub) await tx.update(subscriptions).set(values).where(eq(subscriptions.tenantId, inv.tenantId));
      else await tx.insert(subscriptions).values({ tenantId: inv.tenantId, ...values });
      await this.audit.log(tx, {
        tenantId: inv.tenantId,
        action: 'PAID',
        entity: 'Langganan',
        entityId: inv.id,
        data: { number: inv.number, amount: inv.amount, by, periodEnd: end },
      });
      return { inv, end };
    });
    this.subs.invalidate();
    if (done) {
      const [plan] = await this.db.select({ name: plans.name }).from(plans).where(eq(plans.id, done.inv.planId));
      await this.notifyOwners(
        done.inv.tenantId,
        `Pembayaran diterima — ${done.inv.number}`,
        'Terima kasih, pembayaran sudah diterima',
        [
          `Pembayaran ${rupiah(done.inv.amount)} untuk tagihan ${done.inv.number} sudah kami terima.`,
          `Paket ${plan?.name ?? ''} aktif sampai ${tgl(done.end)}.`,
        ],
      );
    }
    return { ok: true, alreadyPaid: !done };
  }

  /** Notifikasi dari gerbang pembayaran */
  async handleNotice(n: PaymentNotice | null) {
    if (!n) throw new ForbiddenException('Tanda tangan notifikasi tidak valid');
    const [inv] = await this.db.select().from(billingInvoices).where(eq(billingInvoices.number, n.orderId));
    if (!inv) return { ok: true, ignored: 'tagihan tidak dikenal' };
    if (n.paid) {
      if (n.amount != null && Math.round(n.amount) !== Math.round(Number(inv.amount))) {
        this.logger.warn(
          `Jumlah bayar ${n.amount} tidak sama dengan tagihan ${inv.number} (${inv.amount}) — tidak diproses otomatis`,
        );
        return { ok: true, ignored: 'jumlah berbeda' };
      }
      return this.markPaid(inv.id, 'gateway', n.ref);
    }
    if (n.failed && inv.status === 'UNPAID')
      await this.db.update(billingInvoices).set({ gatewayUrl: null }).where(eq(billingInvoices.id, inv.id));
    return { ok: true };
  }

  /** Data invoice langganan untuk dicetak (penjual = pemilik SANSU, pembeli = perusahaan pelanggan) */
  async invoiceDoc(id: string, tenantId?: string) {
    const [r] = await this.db
      .select({ inv: billingInvoices, plan: plans.name, tenant: tenants })
      .from(billingInvoices)
      .innerJoin(plans, eq(plans.id, billingInvoices.planId))
      .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .where(and(eq(billingInvoices.id, id), tenantId ? eq(billingInvoices.tenantId, tenantId) : undefined));
    if (!r) throw new NotFoundException('Tagihan tidak ditemukan');
    const s = await this.subs.settings();
    const { proof: _p, ...inv } = r.inv;
    void _p;
    return {
      ...inv,
      planName: r.plan,
      seller: {
        name: s.sellerName,
        npwp: s.sellerNpwp,
        address: s.sellerAddress,
        bank: s.bankAccount ? { name: s.bankName, account: s.bankAccount, holder: s.bankHolder } : null,
      },
      buyer: { name: r.tenant.name, npwp: r.tenant.npwp, address: r.tenant.address },
    };
  }

  /** Rekap PPN keluaran langganan per bulan (tagihan lunas) — bahan faktur pajak di Coretax */
  async vatReport(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Bulan tidak valid (format YYYY-MM)');
    const r = await this.db.execute<Record<string, unknown>>(sql`
      SELECT b.id, b.number, b.paid_at AS "paidAt", b.subtotal, b.vat_rate AS "vatRate", b.vat_amount AS "vatAmount", b.amount,
             t.name AS buyer, t.npwp AS "buyerNpwp", t.address AS "buyerAddress", p.name AS plan, b.cycle
      FROM billing_invoices b JOIN tenants t ON t.id = b.tenant_id JOIN plans p ON p.id = b.plan_id
      WHERE b.status = 'PAID' AND to_char(b.paid_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${month}
      ORDER BY b.paid_at`);
    return r.rows;
  }

  // ===== Panel admin pemilik layanan =====
  async platformOverview() {
    const now = new Date();
    const r = await this.db.execute<{
      tenants: number;
      trial: number;
      active: number;
      expired: number;
      suspended: number;
      internal: number;
      mrr: string;
      new30: number;
      paid_month: string;
      waiting: number;
    }>(sql`
      WITH s AS (
        SELECT t.id, t.created_at, sub.status, sub.trial_ends_at, sub.current_period_end, sub.cycle, p.price_monthly, p.price_yearly
        FROM tenants t LEFT JOIN subscriptions sub ON sub.tenant_id = t.id LEFT JOIN plans p ON p.id = sub.plan_id)
      SELECT
        COUNT(*)::int AS tenants,
        COUNT(*) FILTER (WHERE status = 'TRIAL' AND trial_ends_at > ${now})::int AS trial,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND current_period_end > ${now})::int AS active,
        COUNT(*) FILTER (WHERE (status = 'TRIAL' AND trial_ends_at <= ${now}) OR (status = 'ACTIVE' AND current_period_end <= ${now}))::int AS expired,
        COUNT(*) FILTER (WHERE status IN ('SUSPENDED','CANCELLED'))::int AS suspended,
        COUNT(*) FILTER (WHERE status IS NULL OR (status = 'ACTIVE' AND current_period_end IS NULL))::int AS internal,
        COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND current_period_end > ${now} THEN CASE WHEN cycle = 'YEARLY' THEN price_yearly / 12 ELSE price_monthly END END), 0)::numeric(18,2) AS mrr,
        COUNT(*) FILTER (WHERE created_at > ${new Date(now.getTime() - 30 * DAY)})::int AS new30,
        (SELECT COALESCE(SUM(amount), 0) FROM billing_invoices WHERE status = 'PAID' AND paid_at >= date_trunc('month', ${now}::timestamptz))::numeric(18,2) AS paid_month,
        (SELECT COUNT(*) FROM billing_invoices WHERE status = 'WAITING')::int AS waiting
      FROM s`);
    const signups = await this.db.execute<{ month: string; n: number }>(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
      FROM tenants WHERE created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
    const revenue = await this.db.execute<{ month: string; amount: string }>(sql`
      SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount)::numeric(18,2) AS amount
      FROM billing_invoices WHERE status = 'PAID' AND paid_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
    return {
      ...r.rows[0],
      signups: signups.rows,
      revenue: revenue.rows,
      gateway: activeGateway(),
      smtp: this.mail.configured,
      admins: platformAdminEmails(),
    };
  }

  async platformTenants(q?: string) {
    const term = q?.trim();
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.npwp, t.created_at,
        sub.status, sub.cycle, sub.trial_ends_at, sub.current_period_end, sub.notes,
        p.id AS plan_id, p.name AS plan_name, p.code AS plan_code,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active)::int AS users,
        (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login,
        (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1) AS owner_email,
        (SELECT u.name FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1) AS owner_name,
        (SELECT u.email_verified_at IS NOT NULL FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1) AS owner_verified,
        (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id)::int AS sales_invoices,
        (SELECT COUNT(*) FROM billing_invoices b WHERE b.tenant_id = t.id AND b.status = 'WAITING')::int AS waiting
      FROM tenants t
      LEFT JOIN subscriptions sub ON sub.tenant_id = t.id
      LEFT JOIN plans p ON p.id = sub.plan_id
      ${term ? sql`WHERE t.name ILIKE ${`%${term}%`} OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.email ILIKE ${`%${term}%`})` : sql``}
      ORDER BY t.created_at DESC
      LIMIT 500`);
    const settings = await this.subs.settings();
    return rows.rows.map((r) => {
      const state = SubscriptionService.compute(
        r.status
          ? {
              status: String(r.status),
              cycle: String(r.cycle),
              trialEndsAt: r.trial_ends_at ? new Date(String(r.trial_ends_at)) : null,
              currentPeriodEnd: r.current_period_end ? new Date(String(r.current_period_end)) : null,
            }
          : undefined,
        null,
        settings.graceDays,
      );
      return { ...r, state: state.status, endsAt: state.endsAt, daysLeft: state.daysLeft };
    });
  }

  async platformTenant(id: string) {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, id));
    if (!t) throw new NotFoundException('Perusahaan tidak ditemukan');
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.tenantId, id));
    const people = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, id))
      .orderBy(asc(users.createdAt));
    const invs = await this.db
      .select({
        id: billingInvoices.id,
        number: billingInvoices.number,
        amount: billingInvoices.amount,
        status: billingInvoices.status,
        method: billingInvoices.method,
        cycle: billingInvoices.cycle,
        planName: plans.name,
        paidAt: billingInvoices.paidAt,
        createdAt: billingInvoices.createdAt,
      })
      .from(billingInvoices)
      .innerJoin(plans, eq(plans.id, billingInvoices.planId))
      .where(eq(billingInvoices.tenantId, id))
      .orderBy(desc(billingInvoices.createdAt));
    return {
      tenant: { id: t.id, name: t.name, npwp: t.npwp, address: t.address, createdAt: t.createdAt },
      subscription: sub ?? null,
      state: await this.subs.state(id, true),
      usage: await this.subs.usage(id),
      users: people,
      invoices: invs,
    };
  }

  async updateSubscription(actor: AuthUser, tenantId: string, dto: UpdateSubscriptionDto) {
    const [t] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new NotFoundException('Perusahaan tidak ditemukan');
    if (dto.planId) {
      const [p] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.id, dto.planId));
      if (!p) throw new BadRequestException('Paket tidak ditemukan');
    }
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    const patch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date() };
    if (dto.planId) patch.planId = dto.planId;
    if (dto.status) patch.status = dto.status;
    if (dto.cycle) patch.cycle = dto.cycle;
    if (dto.trialEndsAt) patch.trialEndsAt = new Date(dto.trialEndsAt);
    if (dto.currentPeriodEnd !== undefined)
      patch.currentPeriodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.extendDays) {
      const status = dto.status ?? sub?.status ?? 'ACTIVE';
      const now = new Date();
      if (status === 'TRIAL') {
        const base = sub?.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
        patch.trialEndsAt = new Date(base.getTime() + dto.extendDays * DAY);
      } else {
        const cur = patch.currentPeriodEnd ?? sub?.currentPeriodEnd ?? null;
        const base = cur && cur > now ? cur : now;
        patch.currentPeriodEnd = new Date(base.getTime() + dto.extendDays * DAY);
      }
    }
    if (patch.trialEndsAt || patch.currentPeriodEnd) patch.reminders = {};
    if (sub) await this.db.update(subscriptions).set(patch).where(eq(subscriptions.tenantId, tenantId));
    else {
      const planId =
        dto.planId ??
        (await this.db.select({ id: plans.id }).from(plans).orderBy(asc(plans.sortOrder)).limit(1))[0]?.id;
      if (!planId) throw new BadRequestException('Belum ada paket');
      await this.db.insert(subscriptions).values({ tenantId, planId, status: dto.status ?? 'ACTIVE', ...patch });
    }
    await this.audit.log(this.db, {
      tenantId,
      userId: undefined,
      action: 'UPDATE',
      entity: 'Langganan',
      entityId: tenantId,
      data: { ...dto, by: actor.email },
    });
    this.subs.invalidate(tenantId);
    return this.platformTenant(tenantId);
  }

  platformInvoices(status?: string) {
    return this.db
      .select({
        id: billingInvoices.id,
        number: billingInvoices.number,
        tenantId: billingInvoices.tenantId,
        tenantName: tenants.name,
        planName: plans.name,
        cycle: billingInvoices.cycle,
        amount: billingInvoices.amount,
        status: billingInvoices.status,
        method: billingInvoices.method,
        dueDate: billingInvoices.dueDate,
        hasProof: sql<boolean>`${billingInvoices.proof} IS NOT NULL`,
        proofNote: billingInvoices.proofNote,
        rejectReason: billingInvoices.rejectReason,
        paidAt: billingInvoices.paidAt,
        confirmedBy: billingInvoices.confirmedBy,
        createdAt: billingInvoices.createdAt,
      })
      .from(billingInvoices)
      .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .innerJoin(plans, eq(plans.id, billingInvoices.planId))
      .where(status && status !== 'ALL' ? eq(billingInvoices.status, status as 'UNPAID') : undefined)
      .orderBy(desc(billingInvoices.createdAt))
      .limit(500);
  }

  async proof(id: string) {
    const [r] = await this.db
      .select({ proof: billingInvoices.proof })
      .from(billingInvoices)
      .where(eq(billingInvoices.id, id));
    if (!r?.proof) throw new NotFoundException('Bukti transfer tidak ada');
    return { proof: r.proof };
  }

  async reject(actor: AuthUser, id: string, dto: RejectDto) {
    const [inv] = await this.db.select().from(billingInvoices).where(eq(billingInvoices.id, id));
    if (!inv) throw new NotFoundException('Tagihan tidak ditemukan');
    if (inv.status !== 'WAITING')
      throw new BadRequestException('Hanya bukti yang menunggu konfirmasi yang bisa ditolak');
    await this.db
      .update(billingInvoices)
      .set({ status: 'UNPAID', rejectReason: dto.reason, confirmedBy: actor.email })
      .where(eq(billingInvoices.id, id));
    await this.notifyOwners(
      inv.tenantId,
      `Bukti transfer ${inv.number} perlu diperbaiki`,
      'Bukti transfer belum bisa kami terima',
      [`Alasan: ${dto.reason}`, 'Silakan unggah ulang bukti transfer yang benar di menu Langganan.'],
      { label: 'Buka Langganan', url: `${appUrl()}/billing` },
    );
    return { ok: true };
  }

  plansAll() {
    return this.db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.priceMonthly));
  }

  async createPlan(dto: PlanDto) {
    if (!dto.code || !dto.name || !dto.priceMonthly || !dto.priceYearly)
      throw new BadRequestException('Kode, nama, harga bulanan & tahunan wajib diisi');
    const [p] = await this.db
      .insert(plans)
      .values({
        code: dto.code,
        name: dto.name,
        description: dto.description ?? '',
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        maxUsers: dto.maxUsers ?? null,
        maxWarehouses: dto.maxWarehouses ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();
    return p;
  }

  async updatePlan(id: string, dto: PlanDto) {
    const [p] = await this.db.update(plans).set(dto).where(eq(plans.id, id)).returning();
    if (!p) throw new NotFoundException('Paket tidak ditemukan');
    this.subs.invalidate();
    return p;
  }

  // ===== Tugas terjadwal: pengingat & tagihan perpanjangan otomatis =====
  async runReminders(now = new Date()) {
    const s = await this.subs.settings();
    const rows = await this.db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(ne(subscriptions.status, 'CANCELLED'));
    let sent = 0;
    for (const { sub, plan } of rows) {
      const mark = async (key: string) => {
        await this.db
          .update(subscriptions)
          .set({ reminders: { ...sub.reminders, [key]: now.toISOString().slice(0, 10) } })
          .where(eq(subscriptions.tenantId, sub.tenantId));
        sub.reminders = { ...sub.reminders, [key]: now.toISOString().slice(0, 10) };
        sent++;
      };
      const url = { label: 'Pilih paket & bayar', url: `${appUrl()}/billing` };
      if (sub.status === 'TRIAL' && sub.trialEndsAt) {
        const left = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY);
        if (left <= 3 && left > 0 && !sub.reminders['trial-3']) {
          await this.notifyOwners(
            sub.tenantId,
            `Masa uji coba SANSU berakhir ${left} hari lagi`,
            'Masa uji coba hampir berakhir',
            [
              `Masa uji coba Anda berakhir pada ${tgl(sub.trialEndsAt)}.`,
              'Pilih paket sekarang agar tetap bisa mencatat transaksi tanpa jeda. Semua data selama uji coba tetap tersimpan.',
            ],
            url,
          );
          await mark('trial-3');
        } else if (left <= 0 && !sub.reminders['trial-end']) {
          await this.notifyOwners(
            sub.tenantId,
            'Masa uji coba SANSU sudah berakhir',
            'Masa uji coba sudah berakhir',
            [
              'Data Anda tetap aman dan masih bisa dilihat & diekspor.',
              'Untuk kembali mencatat transaksi, pilih paket dan lakukan pembayaran.',
            ],
            url,
          );
          await mark('trial-end');
        }
      }
      if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
        const left = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY);
        const key = `renew-${sub.currentPeriodEnd.toISOString().slice(0, 10)}`;
        if (left <= s.renewalNoticeDays && left > -s.graceDays && !sub.reminders[key]) {
          // tagihan perpanjangan otomatis (paket & siklus yang sama) bila belum ada tagihan terbuka
          const [open] = await this.db
            .select({ id: billingInvoices.id })
            .from(billingInvoices)
            .where(
              and(eq(billingInvoices.tenantId, sub.tenantId), inArray(billingInvoices.status, ['UNPAID', 'WAITING'])),
            );
          if (!open && plan.isActive) {
            const [owner] = await this.db
              .select()
              .from(users)
              .where(and(eq(users.tenantId, sub.tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)))
              .limit(1);
            if (owner)
              await this.createInvoice(
                { sub: owner.id, tenantId: sub.tenantId, role: 'OWNER', email: owner.email },
                { planId: plan.id, cycle: sub.cycle },
                { auto: true },
              );
          }
          await mark(key);
        }
      }
    }
    return { checked: rows.length, sent };
  }
}

@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Langganan');
  constructor(private readonly svc: BillingService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.svc.runReminders().catch((e) => this.logger.error(e));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

// ---------- Controller pelanggan ----------
@ApiTags('Langganan')
@ApiBearerAuth()
@AllowWhenLocked()
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get()
  @Roles('ADMIN')
  overview(@CurrentUser() u: AuthUser) {
    return this.svc.overview(u);
  }
  @Get('support')
  support() {
    return this.svc.support();
  }
  @Get('invoices/:id')
  @Roles('ADMIN')
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoiceDoc(id, u.tenantId);
  }
  @Roles('ADMIN')
  @Post('invoices')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBillingInvoiceDto) {
    return this.svc.createInvoice(u, dto);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.payOnline(u, id);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/proof')
  proof(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProofDto) {
    return this.svc.submitProof(u, id, dto);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelInvoice(u, id);
  }
}

// ---------- Webhook gerbang pembayaran (tanpa login, diverifikasi tanda tangan) ----------
@ApiTags('Langganan')
@Public()
@SkipThrottle()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly svc: BillingService) {}

  @HttpCode(200)
  @Post('midtrans')
  midtrans(@Body() body: Record<string, string>) {
    return this.svc.handleNotice(midtrans.verify(body));
  }
  @HttpCode(200)
  @Post('xendit')
  xendit(@Headers('x-callback-token') token: string | undefined, @Body() body: Record<string, unknown>) {
    return this.svc.handleNotice(xendit.verify(token, body));
  }
}

// ---------- Panel admin pemilik layanan ----------
@ApiTags('Panel Admin SANSU')
@ApiBearerAuth()
@AllowWhenLocked()
@UseGuards(PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly svc: BillingService,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
  ) {}

  @Get('overview')
  overview() {
    return this.svc.platformOverview();
  }
  @Get('tenants')
  tenants(@Query('q') q?: string) {
    return this.svc.platformTenants(q);
  }
  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.platformTenant(id);
  }
  @Patch('tenants/:id/subscription')
  updateSub(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.svc.updateSubscription(u, id, dto);
  }
  @Get('invoices')
  invoices(@Query('status') status?: string) {
    return this.svc.platformInvoices(status);
  }
  @Get('invoices/:id')
  invoiceDoc(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoiceDoc(id);
  }
  @Get('vat-report')
  vatReport(@Query('month') month: string) {
    return this.svc.vatReport(month);
  }
  @Get('invoices/:id/proof')
  proof(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.proof(id);
  }
  @HttpCode(200)
  @Post('invoices/:id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markPaid(id, u.email);
  }
  @HttpCode(200)
  @Post('invoices/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.svc.reject(u, id, dto);
  }
  @Get('plans')
  plans() {
    return this.svc.plansAll();
  }
  @Post('plans')
  createPlan(@Body() dto: PlanDto) {
    return this.svc.createPlan(dto);
  }
  @Patch('plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.svc.updatePlan(id, dto);
  }
  @Get('settings')
  async settings() {
    return {
      ...(await this.subs.settings()),
      smtp: { configured: this.mail.configured, from: this.mail.from },
      gateway: activeGateway(),
      admins: platformAdminEmails(),
    };
  }
  @Put('settings')
  saveSettings(@Body() dto: BillingSettingsDto) {
    return this.subs.saveSettings(dto as Partial<BillingSettings>);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('test-email')
  async testEmail(@Body() dto: TestEmailDto) {
    await this.mail.send(
      {
        to: dto.to,
        subject: 'Email uji dari SANSU',
        heading: 'Email berhasil terkirim',
        paragraphs: [
          'Pengaturan SMTP SANSU sudah benar. Email reset sandi, verifikasi, dan tagihan akan terkirim seperti ini.',
        ],
      },
      true,
    );
    return { ok: true };
  }
  @Get('system')
  system() {
    return systemStatus(this.svc.database);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('test-alert')
  async testAlert() {
    const ok = await telegram('✅ Uji peringatan SANSU: notifikasi Telegram sudah tersambung.');
    if (!ok)
      throw new BadRequestException(
        'Telegram belum diatur atau token/chat ID salah (TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID di file .env server).',
      );
    return { ok };
  }
  @HttpCode(200)
  @Post('run-reminders')
  runReminders() {
    return this.svc.runReminders();
  }
}

@Module({
  controllers: [BillingController, BillingWebhookController, PlatformAdminController],
  providers: [BillingService, BillingScheduler, PlatformAdminGuard],
  exports: [BillingService],
})
export class BillingModule {}
