import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users, plans, billingInvoices, tenants, subscriptions } from '../../db/schema';
import { and, eq, inArray, asc, sql, ne, desc } from 'drizzle-orm';

/** Akses data untuk Billing: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BillingRepository {
  /** Dipakai oleh BillingService.ownerEmails */
  listUsersByIsActiveAndRoleAndCreatedAt(db: DbOrTx, tenantId: string) {
    return db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])))
      .orderBy(asc(users.createdAt));
  }

  /** Dipakai oleh BillingService.nextNumber */
  queryNextNumber(db: DbOrTx) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(727002)`);
  }

  /** Dipakai oleh BillingService.createInvoice */
  findPlansByIdAndIsActive(db: DbOrTx, planId: string) {
    return db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.isActive, true)));
  }

  /** Dipakai oleh BillingService.createInvoice */
  updateBillingInvoicesByStatus(db: DbOrTx, tenantId: string) {
    return db
      .update(billingInvoices)
      .set({ status: 'CANCELLED' })
      .where(and(eq(billingInvoices.tenantId, tenantId), eq(billingInvoices.status, 'UNPAID')));
  }

  /** Dipakai oleh BillingService.payOnline */
  findUsersById(db: DbOrTx, sub: string) {
    return db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, sub));
  }

  /** Dipakai oleh BillingService.payOnline */
  findPlansById(db: DbOrTx, planId: string) {
    return db.select().from(plans).where(eq(plans.id, planId));
  }

  /** Dipakai oleh BillingService.submitProof */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh BillingService.markPaid */
  findBillingInvoicesById(db: DbOrTx, invoiceId: string) {
    return db.select().from(billingInvoices).where(eq(billingInvoices.id, invoiceId)).for('update');
  }

  /** Dipakai oleh BillingService.markPaid */
  findSubscriptions(db: DbOrTx, tenantId: string) {
    return db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).for('update');
  }

  /** Dipakai oleh BillingService.markPaid */
  updateSubscriptions(
    db: DbOrTx,
    values: {
      planId: string;
      status: 'ACTIVE';
      cycle: 'MONTHLY' | 'YEARLY';
      currentPeriodEnd: Date;
      reminders: {};
      updatedAt: Date;
    },
    tenantId: string,
  ) {
    return db.update(subscriptions).set(values).where(eq(subscriptions.tenantId, tenantId));
  }

  /** Dipakai oleh BillingService.markPaid */
  insertSubscriptions(
    db: DbOrTx,
    tenantId: string,
    values: {
      planId: string;
      status: 'ACTIVE';
      cycle: 'MONTHLY' | 'YEARLY';
      currentPeriodEnd: Date;
      reminders: {};
      updatedAt: Date;
    },
  ) {
    return db.insert(subscriptions).values({ tenantId: tenantId, ...values });
  }

  /** Dipakai oleh BillingService.markPaid */
  findPlansByIdForMarkPaid(db: DbOrTx, planId: string) {
    return db.select({ name: plans.name }).from(plans).where(eq(plans.id, planId));
  }

  /** Dipakai oleh BillingService.handleNotice */
  findBillingInvoicesByNumber(db: DbOrTx, orderId: string) {
    return db.select().from(billingInvoices).where(eq(billingInvoices.number, orderId));
  }

  /** Dipakai oleh BillingService.invoiceDoc */
  findBillingInvoicesWithPlansAndTenantsById(db: DbOrTx, id: string, tenantId: string | undefined) {
    return db
      .select({ inv: billingInvoices, plan: plans.name, tenant: tenants })
      .from(billingInvoices)
      .innerJoin(plans, eq(plans.id, billingInvoices.planId))
      .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
      .where(and(eq(billingInvoices.id, id), tenantId ? eq(billingInvoices.tenantId, tenantId) : undefined));
  }

  /** Dipakai oleh BillingService.vatReport */
  queryBillingInvoice(db: DbOrTx, month: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT b.id, b.number, b.paid_at AS "paidAt", b.subtotal, b.vat_rate AS "vatRate", b.vat_amount AS "vatAmount", b.amount,
             t.name AS buyer, t.npwp AS "buyerNpwp", t.address AS "buyerAddress", p.name AS plan, b.cycle
      FROM billing_invoices b JOIN tenants t ON t.id = b.tenant_id JOIN plans p ON p.id = b.plan_id
      WHERE b.status = 'PAID' AND to_char(b.paid_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${month}
      ORDER BY b.paid_at`);
  }

  /** Dipakai oleh BillingService.runReminders */
  listSubscriptionsWithPlansByStatus(db: DbOrTx) {
    return db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(ne(subscriptions.status, 'CANCELLED'));
  }

  /** Dipakai oleh BillingService.runReminders */
  updateSubscriptionsForRunReminders(
    db: DbOrTx,
    reminders: Record<string, string>,
    key: string,
    now: Date,
    tenantId: string,
  ) {
    return db
      .update(subscriptions)
      .set({ reminders: { ...reminders, [key]: now.toISOString().slice(0, 10) } })
      .where(eq(subscriptions.tenantId, tenantId));
  }

  /** Dipakai oleh BillingService.runReminders */
  findBillingInvoicesByStatus(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: billingInvoices.id })
      .from(billingInvoices)
      .where(and(eq(billingInvoices.tenantId, tenantId), inArray(billingInvoices.status, ['UNPAID', 'WAITING'])));
  }

  /** Dipakai oleh BillingService.runReminders */
  findUsersByRoleAndIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)))
      .limit(1);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh BillingService.nextNumber */
  countBillingInvoicesByNumber(db: DbOrTx, prefix: string) {
    return db
      .select({ n: sql<number>`count(*)::int` })
      .from(billingInvoices)
      .where(sql`${billingInvoices.number} LIKE ${`${prefix}%`}`);
  }

  /** Dipakai oleh BillingService.overview */
  listPlansByIsActiveAndSortOrderAndPriceMonthly(db: DbOrTx) {
    return db
      .select()
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly));
  }

  /** Dipakai oleh BillingService.overview */
  listBillingInvoicesWithPlansByCreatedAt(
    db: DbOrTx,
    tenantId: NonNullable<(typeof billingInvoices.$inferSelect)['tenantId']>,
  ) {
    return db
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
      .where(eq(billingInvoices.tenantId, tenantId))
      .orderBy(desc(billingInvoices.createdAt))
      .limit(50);
  }
}
