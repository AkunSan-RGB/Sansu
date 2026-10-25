// Skema database — billing
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { tenantId, tenants, users } from './tenancy';

/** Paket langganan yang dijual */
export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  priceMonthly: money('price_monthly').notNull(),
  priceYearly: money('price_yearly').notNull(),
  /** null = tanpa batas */
  maxUsers: integer('max_users'),
  maxWarehouses: integer('max_warehouses'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

/** Langganan per perusahaan (satu baris per tenant) */
export const subscriptions = pgTable('subscriptions', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  /** TRIAL · ACTIVE · SUSPENDED · CANCELLED (kedaluwarsa dihitung dari tanggal) */
  status: text('status').$type<'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'>().notNull(),
  cycle: text('cycle').$type<'MONTHLY' | 'YEARLY'>().notNull().default('MONTHLY'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  /** Akhir masa aktif berbayar. null pada status ACTIVE = tanpa batas (akun internal / gratis) */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  notes: text('notes').notNull().default(''),
  /** Pengingat yang sudah dikirim, mis. { "trial-3": "2026-10-01" } */
  reminders: jsonb('reminders').$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** Tagihan langganan dari SANSU ke pelanggan */
export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull().unique(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    cycle: text('cycle').$type<'MONTHLY' | 'YEARLY'>().notNull(),
    /** Harga paket (DPP) sebelum PPN */
    subtotal: money('subtotal').notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    vatAmount: money('vat_amount').notNull().default('0'),
    /** Total dibayar = subtotal + PPN */
    amount: money('amount').notNull(),
    /** UNPAID · WAITING (bukti transfer dikirim) · PAID · CANCELLED */
    status: text('status').$type<'UNPAID' | 'WAITING' | 'PAID' | 'CANCELLED'>().notNull().default('UNPAID'),
    method: text('method').$type<'MANUAL' | 'MIDTRANS' | 'XENDIT'>().notNull().default('MANUAL'),
    dueDate: date('due_date').notNull(),
    proof: text('proof'),
    proofNote: text('proof_note'),
    rejectReason: text('reject_reason'),
    gatewayRef: text('gateway_ref'),
    gatewayUrl: text('gateway_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    confirmedBy: text('confirmed_by'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('billing_invoices_tenant_idx').on(t.tenantId, t.createdAt), index('billing_invoices_status_idx').on(t.status)],
);
