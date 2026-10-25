import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { platformAdminEmails } from '../../common/auth/platform-admin';
import { AuditService } from '../../common/audit/audit.service';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { billingInvoices, plans, subscriptions, tenants, users } from '../../db/schema';
import { activeGateway } from './gateways';
import { UpdateSubscriptionDto, RejectDto, PlanDto } from './billing.dto';
import { BillingService, DAY } from './billing.service';
import { patchById } from '../../db/owned';

@Injectable()
export class PlatformBillingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

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
      billingEnabled: (await this.subs.settings()).enabled,
      signups: signups.rows,
      revenue: revenue.rows,
      gateway: activeGateway(),
      smtp: this.mail.configured,
      admins: platformAdminEmails(),
    };
  }

  /**
   * Pantauan penggunaan (tahap uji): siapa yang aktif, dokumen apa yang dibuat, perusahaan yang paling sering memakai, dan
   * jejak aktivitas terbaru lintas perusahaan. Dihitung dari login pengguna dan jejak audit.
   */
  async platformPulse() {
    const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
      (await this.db.execute<T>(q)).rows;
    const [k] = await one<{
      users: number;
      d1: number;
      d7: number;
      d30: number;
      tenants: number;
      tenants7: number;
      selling: number;
      events24: number;
      events7: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_active)::int AS users,
        (SELECT COUNT(*) FROM users u WHERE u.last_login_at > now() - interval '1 day' OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.user_id = u.id AND a.created_at > now() - interval '1 day'))::int AS d1,
        (SELECT COUNT(*) FROM users u WHERE u.last_login_at > now() - interval '7 days' OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.user_id = u.id AND a.created_at > now() - interval '7 days'))::int AS d7,
        (SELECT COUNT(*) FROM users u WHERE u.last_login_at > now() - interval '30 days' OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.user_id = u.id AND a.created_at > now() - interval '30 days'))::int AS d30,
        (SELECT COUNT(*) FROM tenants)::int AS tenants,
        (SELECT COUNT(DISTINCT x.tenant_id) FROM (SELECT tenant_id FROM users WHERE last_login_at > now() - interval '7 days' UNION SELECT tenant_id FROM audit_logs WHERE created_at > now() - interval '7 days') x)::int AS tenants7,
        (SELECT COUNT(*) FROM tenants t WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t.id)
            OR EXISTS (SELECT 1 FROM purchase_invoices p WHERE p.tenant_id = t.id) OR EXISTS (SELECT 1 FROM pos_orders o WHERE o.tenant_id = t.id))::int AS selling,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at > now() - interval '1 day')::int AS events24,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at > now() - interval '7 days')::int AS events7`);
    const docs = await one<{ label: string; n7: number; total: number }>(sql`
      SELECT label, n7::int, total::int FROM (
        SELECT 'Sales order' AS label, COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS n7, COUNT(*) AS total FROM sales_orders
        UNION ALL SELECT 'Faktur penjualan', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM invoices
        UNION ALL SELECT 'Purchase order', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM purchase_orders
        UNION ALL SELECT 'Faktur pembelian', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM purchase_invoices
        UNION ALL SELECT 'Pembayaran diterima', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM payments
        UNION ALL SELECT 'Jurnal', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM journal_entries
        UNION ALL SELECT 'Perintah produksi', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM production_orders
      ) x`);
    const daily = await one<{ day: string; n: number; users: number }>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users
      FROM audit_logs WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`);
    const top = await one<{ id: string; name: string; events: number; users: number; last: string | null }>(sql`
      SELECT t.id, t.name, COUNT(a.id)::int AS events, COUNT(DISTINCT a.user_id)::int AS users, MAX(a.created_at)::text AS last
      FROM audit_logs a JOIN tenants t ON t.id = a.tenant_id WHERE a.created_at > now() - interval '7 days'
      GROUP BY t.id, t.name ORDER BY events DESC LIMIT 10`);
    const recent = await one<{
      id: number;
      at: string;
      tenant: string;
      user: string | null;
      action: string;
      entity: string;
    }>(sql`
      SELECT a.id, a.created_at::text AS at, t.name AS tenant, u.name AS user, a.action, a.entity
      FROM audit_logs a JOIN tenants t ON t.id = a.tenant_id LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 60`);
    return { ...k, docs, daily, top, recent };
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
    await patchById(this.db, billingInvoices, id, { status: 'UNPAID', rejectReason: dto.reason, confirmedBy: actor.email });
    await this.billing.notifyOwners(
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
}
