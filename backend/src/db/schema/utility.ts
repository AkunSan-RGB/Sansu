// Skema database — utility
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { tenantId, users } from './tenancy';
import { customers } from './master-data';
import { invoices, payments } from './sales';
import { accounts, journalEntries } from './accounting';

export const utilityTariffs = pgTable(
  'utility_tariffs',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    serviceType: text('service_type').$type<'AIR' | 'LISTRIK' | 'INTERNET' | 'GAS' | 'TV_KABEL' | 'KEBERSIHAN'>().notNull(),
    unit: text('unit').notNull(),
    metered: boolean('metered').notNull().default(true),
    fixedFee: money('fixed_fee').notNull().default('0'),
    adminFee: money('admin_fee').notNull().default('0'),
    minUsage: numeric('min_usage', { precision: 18, scale: 4 }).notNull().default('0'),
    blocks: jsonb('blocks').$type<{ upTo: number | null; price: number }[]>().notNull().default([]),
    vatable: boolean('vatable').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_tariffs_name_uq').on(t.tenantId, t.name)],
);

export const utilityConnections = pgTable(
  'utility_connections',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    tariffId: uuid('tariff_id')
      .notNull()
      .references(() => utilityTariffs.id),
    meterNo: text('meter_no'),
    address: text('address').notNull(),
    status: text('status').$type<'ACTIVE' | 'SUSPENDED' | 'DISCONNECTED'>().notNull().default('ACTIVE'),
    installedAt: date('installed_at').notNull(),
    initialReading: numeric('initial_reading', { precision: 18, scale: 4 }).notNull().default('0'),
    statusChangedById: uuid('status_changed_by_id'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    statusNote: text('status_note'),
    /** Zona/wilayah layanan (untuk menghitung kehilangan: pasokan zona − pemakaian pelanggan) */
    zone: text('zone'),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_connections_number_uq').on(t.tenantId, t.number), index('utility_connections_customer_idx').on(t.tenantId, t.customerId)],
);

export const utilityBills = pgTable(
  'utility_bills',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => utilityConnections.id),
    period: text('period').notNull(),
    /** Kosong = penagihan sedang berjalan / tertahan (klaim periode agar tidak tertagih dua kali) */
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    usage: numeric('usage', { precision: 18, scale: 4 }),
    subtotal: money('subtotal').notNull(),
    lateFee: money('late_fee').notNull().default('0'),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_bills_period_uq').on(t.connectionId, t.period), uniqueIndex('utility_bills_invoice_uq').on(t.invoiceId)],
);

export const utilityReadings = pgTable(
  'utility_readings',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => utilityConnections.id),
    period: text('period').notNull(),
    previous: numeric('previous', { precision: 18, scale: 4 }).notNull(),
    current: numeric('current', { precision: 18, scale: 4 }).notNull(),
    usage: numeric('usage', { precision: 18, scale: 4 }).notNull(),
    meterReplaced: boolean('meter_replaced').notNull().default(false),
    flags: text('flags').array().notNull().default(sql`'{}'`),
    status: text('status').$type<'ENTERED' | 'VERIFIED' | 'BILLED' | 'REJECTED'>().notNull().default('ENTERED'),
    note: text('note'),
    enteredById: uuid('entered_by_id').notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedById: uuid('verified_by_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifyNote: text('verify_note'),
    billId: uuid('bill_id').references(() => utilityBills.id),
    source: text('source').$type<'MANUAL' | 'LAPANGAN' | 'IMPORT' | 'API'>().notNull().default('MANUAL'),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    photo: text('photo'),
  },
  (t) => [uniqueIndex('utility_readings_period_uq').on(t.connectionId, t.period).where(sql`status <> 'REJECTED'`), index('utility_readings_status_idx').on(t.tenantId, t.status, t.period)],
);

export const utilityLateFees = pgTable(
  'utility_late_fees',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    billId: uuid('bill_id')
      .notNull()
      .references(() => utilityBills.id),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_late_fees_invoice_uq').on(t.invoiceId)],
);

/** Kunci API untuk alat/gateway meter yang mengirim angka meter; hanya hash yang disimpan */
export const utilityIngestKeys = pgTable(
  'utility_ingest_keys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('utility_ingest_keys_hash_uq').on(t.keyHash)],
);

/** Setoran harian kas loket: petugas menyetor total penerimaan tunainya, dikonfirmasi orang lain */
export const utilityRemittances = pgTable(
  'utility_remittances',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    collectorId: uuid('collector_id').notNull(),
    expected: money('expected').notNull(),
    counted: money('counted').notNull(),
    difference: money('difference').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    status: text('status').$type<'SUBMITTED' | 'CONFIRMED' | 'DISPUTED'>().notNull().default('SUBMITTED'),
    note: text('note'),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    depositAccountId: uuid('deposit_account_id').references(() => accounts.id),
    journalId: uuid('journal_id').references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_remittances_number_uq').on(t.tenantId, t.number)],
);

/** Loket penerimaan pembayaran (beberapa lokasi): nama, lokasi, dan rekening bank penerima untuk pembayaran non-tunai */
export const utilityCounters = pgTable(
  'utility_counters',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    location: text('location'),
    bankAccountId: uuid('bank_account_id').references(() => accounts.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_counters_code_uq').on(t.tenantId, t.code)],
);

/** Konfirmasi rekap harian satu loket oleh orang yang bukan penerimanya (dicocokkan dengan mutasi bank) */
export const utilityCounterClosings = pgTable(
  'utility_counter_closings',
  {
    id: id(),
    tenantId: tenantId(),
    counterId: uuid('counter_id')
      .notNull()
      .references(() => utilityCounters.id),
    date: date('date').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    total: money('total').notNull(),
    status: text('status').$type<'CONFIRMED' | 'DISPUTED'>().notNull().default('CONFIRMED'),
    decidedById: uuid('decided_by_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (t) => [uniqueIndex('utility_counter_closings_day_uq').on(t.counterId, t.date)],
);

/** Katalog layanan non-air yang ditagihkan ke pelanggan (sambung baru, sambung kembali, penggantian meter, dan seterusnya) */
export const utilityCharges = pgTable(
  'utility_charges',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    defaultPrice: money('default_price').notNull().default('0'),
    /** Kunci akun pendapatan non-air (UTILITY_ADMIN_REVENUE, UTILITY_CONNECTION_REVENUE, ...) */
    revenueKey: text('revenue_key').notNull(),
    vatable: boolean('vatable').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_charges_name_uq').on(t.tenantId, t.name)],
);

/** Pembayaran tagihan utilitas yang diterima di loket (menunggu disetor) */
export const utilityCounterReceipts = pgTable(
  'utility_counter_receipts',
  {
    id: id(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    collectorId: uuid('collector_id').notNull(),
    amount: money('amount').notNull(),
    /** CASH ikut setoran harian; TRANSFER/QRIS langsung masuk bank sehingga tidak disetor */
    method: text('method').$type<'CASH' | 'TRANSFER'>().notNull().default('CASH'),
    /** Loket tempat pembayaran diterima (kosong = data lama) dan kanal non-tunai: TRANSFER, QRIS, VA, EDC, EWALLET */
    counterId: uuid('counter_id').references(() => utilityCounters.id),
    channel: text('channel'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    remittanceId: uuid('remittance_id').references(() => utilityRemittances.id),
  },
  (t) => [uniqueIndex('utility_counter_receipts_payment_uq').on(t.paymentId)],
);
