import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { plans, subscriptions, users, warehouses } from '../../db/schema';
import { eq, asc, sql, and } from 'drizzle-orm';

export const DAY = 86_400_000;

/** Akses data untuk Subscription: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SubscriptionRepository {
  /** Dipakai oleh SubscriptionService.startTrial */
  listPlansByCode(db: DbOrTx, trialPlanCode: string) {
    return db.select().from(plans).where(eq(plans.code, trialPlanCode));
  }

  /** Dipakai oleh SubscriptionService.startTrial */
  listPlansByIsActiveAndSortOrder(db: DbOrTx) {
    return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
  }

  /** Dipakai oleh SubscriptionService.state */
  findSubscriptionsWithPlans(db: DbOrTx, tenantId: string) {
    return db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantId));
  }

  /** Dipakai oleh SubscriptionService.usage */
  countUsersByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
  }

  /** Dipakai oleh SubscriptionService.usage */
  countWarehousesByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ n: sql<number>`count(*)::int` })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SubscriptionService.startTrial */
  insertSubscriptions(db: DbOrTx, tenantId: string, id: string, trialDays: number) {
    return db
      .insert(subscriptions)
      .values({ tenantId: tenantId, planId: id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + trialDays * DAY) })
      .onConflictDoNothing();
  }
}
