import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, asc, desc } from 'drizzle-orm';
import { DAY } from './billing.shared';
import { tenants, subscriptions, users, billingInvoices, plans } from '../../db/schema';
import { PlanDto } from './billing.dto';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** Akses data untuk PlatformBilling: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PlatformBillingRepository {
  /** Dipakai oleh PlatformBillingService.platformOverview */
  queryS(db: DbOrTx, now: Date) {
    return db.execute<{
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
  }

  /** Dipakai oleh PlatformBillingService.platformOverview */
  queryTenant(db: DbOrTx) {
    return db.execute<{ month: string; n: number }>(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
      FROM tenants WHERE created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
  }

  /** Dipakai oleh PlatformBillingService.platformOverview */
  queryBillingInvoice(db: DbOrTx) {
    return db.execute<{ month: string; amount: string }>(sql`
      SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount)::numeric(18,2) AS amount
      FROM billing_invoices WHERE status = 'PAID' AND paid_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
  }

  /** Dipakai oleh PlatformBillingService.platformTenants */
  queryTenantForPlatformTenants(db: DbOrTx, term: string | undefined) {
    return db.execute<Record<string, unknown>>(sql`
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
  }

  /** Dipakai oleh PlatformBillingService.platformTenant */
  findTenantsById(db: DbOrTx, id: string) {
    return db.select().from(tenants).where(eq(tenants.id, id));
  }

  /** Dipakai oleh PlatformBillingService.platformTenant */
  findSubscriptions(db: DbOrTx, id: string) {
    return db.select().from(subscriptions).where(eq(subscriptions.tenantId, id));
  }

  /** Dipakai oleh PlatformBillingService.platformTenant */
  listUsersByCreatedAt(db: DbOrTx, id: string) {
    return db
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
  }

  /** Dipakai oleh PlatformBillingService.platformTenant */
  listBillingInvoicesWithPlansByCreatedAt(db: DbOrTx, id: string) {
    return db
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
  }

  /** Dipakai oleh PlatformBillingService.updateSubscription */
  findTenantsByIdForUpdateSubscription(db: DbOrTx, tenantId: string) {
    return db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh PlatformBillingService.updateSubscription */
  findPlansById(db: DbOrTx, planId: string) {
    return db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId));
  }

  /** Dipakai oleh PlatformBillingService.updateSubscription */
  findSubscriptionsForUpdateSubscription(db: DbOrTx, tenantId: string) {
    return db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  }

  /** Dipakai oleh PlatformBillingService.updateSubscription */
  findPlans(db: DbOrTx) {
    return db.select({ id: plans.id }).from(plans).orderBy(asc(plans.sortOrder)).limit(1);
  }

  /** Dipakai oleh PlatformBillingService.proof */
  findBillingInvoicesById(db: DbOrTx, id: string) {
    return db.select({ proof: billingInvoices.proof }).from(billingInvoices).where(eq(billingInvoices.id, id));
  }

  /** Dipakai oleh PlatformBillingService.reject */
  findBillingInvoicesByIdForReject(db: DbOrTx, id: string) {
    return db.select().from(billingInvoices).where(eq(billingInvoices.id, id));
  }

  /** Dipakai oleh PlatformBillingService.updatePlan */
  updatePlansById(db: DbOrTx, dto: PlanDto, id: string) {
    return db.update(plans).set(dto).where(eq(plans.id, id)).returning();
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PlatformBillingService.updateSubscription */
  updateSubscriptions(
    db: DbOrTx,
    patch: PgUpdateSetSource<typeof subscriptions>,
    tenantId: NonNullable<(typeof subscriptions.$inferSelect)['tenantId']>,
  ) {
    return db.update(subscriptions).set(patch).where(eq(subscriptions.tenantId, tenantId));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PlatformBillingService.platformInvoices */
  listBillingInvoicesWithTenantsAndPlansByStatusAndCreatedAt(db: DbOrTx, status: string | undefined) {
    return db
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

  /** Dipakai oleh PlatformBillingService.plansAll */
  listPlans(db: DbOrTx) {
    return db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.priceMonthly));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PlatformBillingService.updateSubscription */
  insertSubscriptions(db: DbOrTx, values: typeof subscriptions.$inferInsert) {
    return db.insert(subscriptions).values(values);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PlatformBillingService.platformPulse */
  queryPlatformPulse(db: DbOrTx) {
    return db.execute<{
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
  }

  /** Dipakai oleh PlatformBillingService.platformPulse */
  queryPlatformPulseForPlatformPulse(db: DbOrTx) {
    return db.execute<{ label: string; n7: number; total: number }>(sql`
      SELECT label, n7::int, total::int FROM (
        SELECT 'Sales order' AS label, COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS n7, COUNT(*) AS total FROM sales_orders
        UNION ALL SELECT 'Faktur penjualan', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM invoices
        UNION ALL SELECT 'Purchase order', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM purchase_orders
        UNION ALL SELECT 'Faktur pembelian', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM purchase_invoices
        UNION ALL SELECT 'Pembayaran diterima', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM payments
        UNION ALL SELECT 'Jurnal', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM journal_entries
        UNION ALL SELECT 'Perintah produksi', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'), COUNT(*) FROM production_orders
      ) x`);
  }

  /** Dipakai oleh PlatformBillingService.platformPulse */
  queryAuditLog(db: DbOrTx) {
    return db.execute<{ day: string; n: number; users: number }>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users
      FROM audit_logs WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`);
  }

  /** Dipakai oleh PlatformBillingService.platformPulse */
  queryAuditLogForPlatformPulse(db: DbOrTx) {
    return db.execute<{ id: string; name: string; events: number; users: number; last: string | null }>(sql`
      SELECT t.id, t.name, COUNT(a.id)::int AS events, COUNT(DISTINCT a.user_id)::int AS users, MAX(a.created_at)::text AS last
      FROM audit_logs a JOIN tenants t ON t.id = a.tenant_id WHERE a.created_at > now() - interval '7 days'
      GROUP BY t.id, t.name ORDER BY events DESC LIMIT 10`);
  }

  /** Dipakai oleh PlatformBillingService.platformPulse */
  queryAuditLogForPlatformPulse2(db: DbOrTx) {
    return db.execute<{
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
  }
}
