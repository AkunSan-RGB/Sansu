import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { plans, platformSettings, subscriptions, users, warehouses } from '../../db/schema';

export type SubStatus = 'TRIAL' | 'ACTIVE' | 'OVERDUE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';
export interface SubState {
  status: SubStatus;
  /** Boleh melihat data, tetapi tidak boleh menambah/mengubah */
  readOnly: boolean;
  plan: { id: string; code: string; name: string; maxUsers: number | null; maxWarehouses: number | null; priceMonthly: string; priceYearly: string } | null;
  cycle: 'MONTHLY' | 'YEARLY';
  /** Akhir trial / masa aktif; null = tanpa batas */
  endsAt: string | null;
  daysLeft: number | null;
  /** Batas toleransi setelah masa aktif habis */
  graceUntil: string | null;
}

export interface BillingSettings {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  trialDays: number;
  graceDays: number;
  trialPlanCode: string;
  supportWhatsapp: string;
  /** Hari sebelum masa aktif berakhir saat tagihan perpanjangan dibuat otomatis */
  renewalNoticeDays: number;
  /** Penjual (PT pemilik SANSU) — tampil di invoice langganan */
  sellerName: string;
  sellerNpwp: string;
  sellerAddress: string;
  /** PKP: tagihan langganan dikenai PPN */
  vatEnabled: boolean;
  /** Tarif PPN efektif (%) — 12% × DPP nilai lain 11/12 = 11% */
  vatRate: number;
}
export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  bankName: '',
  bankAccount: '',
  bankHolder: '',
  trialDays: 14,
  graceDays: 3,
  trialPlanCode: 'BISNIS',
  supportWhatsapp: '',
  renewalNoticeDays: 7,
  sellerName: 'PT SANSU GLOBAL INTI',
  sellerNpwp: '',
  sellerAddress: '',
  vatEnabled: false,
  vatRate: 11,
};

const DAY = 86_400_000;

/** Status langganan & batas paket per perusahaan */
@Injectable()
export class SubscriptionService {
  /** Cache singkat status per tenant (dicek di setiap permintaan tulis) */
  private cache = new Map<string, { at: number; state: SubState }>();

  constructor(@InjectDb() private readonly db: Db) {}

  async settings(db: DbOrTx = this.db): Promise<BillingSettings> {
    const [r] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'billing'));
    return { ...DEFAULT_BILLING_SETTINGS, ...((r?.value as Partial<BillingSettings>) ?? {}) };
  }

  async saveSettings(patch: Partial<BillingSettings>) {
    const value = { ...(await this.settings()), ...patch };
    await this.db
      .insert(platformSettings)
      .values({ key: 'billing', value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
    this.cache.clear();
    return value;
  }

  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  /** Mulai masa uji coba untuk perusahaan baru */
  async startTrial(tx: DbOrTx, tenantId: string) {
    const s = await this.settings(tx);
    const [plan] = (await tx.select().from(plans).where(eq(plans.code, s.trialPlanCode))).concat(
      await tx.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder)),
    );
    if (!plan) return; // belum ada paket (mis. basis data lama) → tanpa batas
    await tx
      .insert(subscriptions)
      .values({ tenantId, planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + s.trialDays * DAY) })
      .onConflictDoNothing();
  }

  /** Hitung status dari baris langganan */
  static compute(
    row: { status: string; cycle: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null } | undefined,
    plan: SubState['plan'],
    graceDays: number,
    now = new Date(),
  ): SubState {
    if (!row) return { status: 'ACTIVE', readOnly: false, plan, cycle: 'MONTHLY', endsAt: null, daysLeft: null, graceUntil: null };
    const cycle = row.cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / DAY);
    if (row.status === 'SUSPENDED' || row.status === 'CANCELLED') {
      return { status: row.status, readOnly: true, plan, cycle, endsAt: row.currentPeriodEnd?.toISOString() ?? null, daysLeft: null, graceUntil: null };
    }
    if (row.status === 'TRIAL') {
      const end = row.trialEndsAt ?? now;
      const expired = end.getTime() <= now.getTime();
      return { status: expired ? 'EXPIRED' : 'TRIAL', readOnly: expired, plan, cycle, endsAt: end.toISOString(), daysLeft: Math.max(0, days(end)), graceUntil: null };
    }
    // ACTIVE
    if (!row.currentPeriodEnd) return { status: 'ACTIVE', readOnly: false, plan, cycle, endsAt: null, daysLeft: null, graceUntil: null };
    const end = row.currentPeriodEnd;
    const grace = new Date(end.getTime() + graceDays * DAY);
    if (end.getTime() > now.getTime()) return { status: 'ACTIVE', readOnly: false, plan, cycle, endsAt: end.toISOString(), daysLeft: days(end), graceUntil: grace.toISOString() };
    if (grace.getTime() > now.getTime()) return { status: 'OVERDUE', readOnly: false, plan, cycle, endsAt: end.toISOString(), daysLeft: 0, graceUntil: grace.toISOString() };
    return { status: 'EXPIRED', readOnly: true, plan, cycle, endsAt: end.toISOString(), daysLeft: 0, graceUntil: grace.toISOString() };
  }

  async state(tenantId: string, fresh = false): Promise<SubState> {
    const hit = this.cache.get(tenantId);
    if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.state;
    const [row] = await this.db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantId));
    const s = await this.settings();
    const plan = row
      ? { id: row.plan.id, code: row.plan.code, name: row.plan.name, maxUsers: row.plan.maxUsers, maxWarehouses: row.plan.maxWarehouses, priceMonthly: row.plan.priceMonthly, priceYearly: row.plan.priceYearly }
      : null;
    const state = SubscriptionService.compute(row?.sub, plan, s.graceDays);
    this.cache.set(tenantId, { at: Date.now(), state });
    return state;
  }

  async usage(tenantId: string, db: DbOrTx = this.db) {
    const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const [w] = await db.select({ n: sql<number>`count(*)::int` }).from(warehouses).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true)));
    return { users: u.n, warehouses: w.n };
  }

  /** Tolak penambahan pengguna/gudang di atas batas paket */
  async assertCanAdd(tenantId: string, what: 'users' | 'warehouses', db: DbOrTx = this.db) {
    const st = await this.state(tenantId, true);
    const max = what === 'users' ? st.plan?.maxUsers : st.plan?.maxWarehouses;
    if (max == null) return;
    const used = (await this.usage(tenantId, db))[what];
    if (used >= max) {
      const label = what === 'users' ? 'pengguna aktif' : 'gudang';
      throw new ForbiddenException(`Paket ${st.plan!.name} dibatasi ${max} ${label}. Tingkatkan paket di menu Langganan untuk menambah.`);
    }
  }
}
