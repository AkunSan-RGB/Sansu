import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
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
import { insertOne, patchById } from '../../db/owned';
import { PlatformBillingRepository } from './platform-billing.repository';

@Injectable()
export class PlatformBillingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly repo: PlatformBillingRepository,
  ) {}

  // ===== Panel admin pemilik layanan =====
  async platformOverview() {
    const now = new Date();
    const r = await this.repo.queryS(this.db, now);
    const signups = await this.repo.queryTenant(this.db);
    const revenue = await this.repo.queryBillingInvoice(this.db);
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
    const rows = await this.repo.queryTenantForPlatformTenants(this.db, term);
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
    const [t] = await this.repo.findTenantsById(this.db, id);
    if (!t) throw new NotFoundException('Perusahaan tidak ditemukan');
    const [sub] = await this.repo.findSubscriptions(this.db, id);
    const people = await this.repo.listUsersByCreatedAt(this.db, id);
    const invs = await this.repo.listBillingInvoicesWithPlansByCreatedAt(this.db, id);
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
    const [t] = await this.repo.findTenantsByIdForUpdateSubscription(this.db, tenantId);
    if (!t) throw new NotFoundException('Perusahaan tidak ditemukan');
    if (dto.planId) {
      const [p] = await this.repo.findPlansById(this.db, dto.planId);
      if (!p) throw new BadRequestException('Paket tidak ditemukan');
    }
    const [sub] = await this.repo.findSubscriptionsForUpdateSubscription(this.db, tenantId);
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
    if (sub) await this.repo.updateSubscriptions(this.db, patch, tenantId);
    else {
      const planId =
        dto.planId ??
        (await this.repo.findPlans(this.db))[0]?.id;
      if (!planId) throw new BadRequestException('Belum ada paket');
      await this.repo.insertSubscriptions(this.db, { tenantId, planId, status: dto.status ?? 'ACTIVE', ...patch });
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
    return this.repo.listBillingInvoicesWithTenantsAndPlansByStatusAndCreatedAt(this.db, status);
  }

  async proof(id: string) {
    const [r] = await this.repo.findBillingInvoicesById(this.db, id);
    if (!r?.proof) throw new NotFoundException('Bukti transfer tidak ada');
    return { proof: r.proof };
  }

  async reject(actor: AuthUser, id: string, dto: RejectDto) {
    const [inv] = await this.repo.findBillingInvoicesByIdForReject(this.db, id);
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
    return this.repo.listPlans(this.db);
  }

  async createPlan(dto: PlanDto) {
    if (!dto.code || !dto.name || !dto.priceMonthly || !dto.priceYearly)
      throw new BadRequestException('Kode, nama, harga bulanan & tahunan wajib diisi');
    const p = await insertOne(this.db, plans, {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? '',
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        maxUsers: dto.maxUsers ?? null,
        maxWarehouses: dto.maxWarehouses ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
    return p;
  }

  async updatePlan(id: string, dto: PlanDto) {
    const [p] = await this.repo.updatePlansById(this.db, dto, id);
    if (!p) throw new NotFoundException('Paket tidak ditemukan');
    this.subs.invalidate();
    return p;
  }
}
