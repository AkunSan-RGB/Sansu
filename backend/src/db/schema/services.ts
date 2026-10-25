// Skema database — services
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { invoices } from './sales';
import { accounts } from './accounting';
import { tenantId } from './tenancy';
import { customers } from './master-data';
import { employees } from './hr';

/** Baris faktur jasa (tanpa barang/stok): uraian + akun pendapatan */
export const serviceInvoiceLines = pgTable('service_invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  qty: qty('qty').notNull(),
  unit: text('unit').notNull().default('Paket'),
  price: money('price').notNull(),
  lineTotal: money('line_total').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
});

/** Proyek / kontrak jasa: nilai kontrak dan penagihan per termin */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Nilai kontrak (DPP, belum PPN) */
    contractValue: money('contract_value').notNull().default('0'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status').$type<'ACTIVE' | 'DONE' | 'CANCELLED'>().notNull().default('ACTIVE'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_code_uq').on(t.tenantId, t.code)],
);

/** Uang muka (DP) dari pelanggan: dicatat sebagai liabilitas sampai dipakai melunasi faktur */
export const customerDeposits = pgTable(
  'customer_deposits',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    projectId: uuid('project_id').references(() => projects.id),
    method: text('method').notNull().default('TRANSFER'),
    cashAccountId: uuid('cash_account_id'),
    /** Diterima (bruto, termasuk PPN uang muka bila PKP) */
    amount: money('amount').notNull(),
    dpp: money('dpp').notNull(),
    taxAmount: money('tax_amount').notNull().default('0'),
    appliedAmount: money('applied_amount').notNull().default('0'),
    description: text('description'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customer_deposits_number_uq').on(t.tenantId, t.number), index('customer_deposits_customer_idx').on(t.tenantId, t.customerId)],
);

export const depositApplications = pgTable('deposit_applications', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  depositId: uuid('deposit_id')
    .notNull()
    .references(() => customerDeposits.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  date: date('date').notNull(),
  amount: money('amount').notNull(),
  dpp: money('dpp').notNull(),
  taxAmount: money('tax_amount').notNull().default('0'),
  journalId: uuid('journal_id'),
  createdAt: createdAt(),
});

export const serviceInvoiceLinesRelations = relations(serviceInvoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [serviceInvoiceLines.invoiceId], references: [invoices.id] }),
  account: one(accounts, { fields: [serviceInvoiceLines.accountId], references: [accounts.id] }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
}));

/**
 * Kemajuan pekerjaan proyek (SAK EP Bab 23 — metode persentase penyelesaian).
 * Pendapatan yang sudah dihasilkan = nilai kontrak × % selesai. Selisih terhadap yang sudah ditagih dicatat sebagai
 * Pendapatan Belum Ditagih (aset kontrak) atau Pendapatan Diterima Dimuka (liabilitas kontrak).
 */
export const projectProgress = pgTable(
  'project_progress',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    date: date('date').notNull(),
    percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
    earned: money('earned').notNull(),
    billed: money('billed').notNull(),
    /** + aset kontrak / − liabilitas kontrak, sebelum & sesudah pencatatan ini */
    accrualBefore: money('accrual_before').notNull(),
    accrualAfter: money('accrual_after').notNull(),
    adjustment: money('adjustment').notNull(),
    revenueAccountId: uuid('revenue_account_id').references(() => accounts.id),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('project_progress_project_idx').on(t.projectId, t.date)],
);

/** Tarif tagih per jam: paling spesifik menang (proyek+karyawan > proyek > karyawan > umum), berlaku sejak tanggal tertentu */
export const billingRates = pgTable(
  'billing_rates',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').references(() => employees.id),
    projectId: uuid('project_id').references(() => projects.id),
    rate: money('rate').notNull(),
    validFrom: date('valid_from').notNull(),
    note: text('note'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('billing_rates_lookup_idx').on(t.tenantId, t.projectId, t.employeeId, t.validFrom)],
);

/** Catatan waktu yang dapat ditagih: DRAFT → SUBMITTED → APPROVED → BILLED (atau REJECTED / WRITTEN_OFF) */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    projectId: uuid('project_id').references(() => projects.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    workDate: date('work_date').notNull(),
    hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
    description: text('description').notNull(),
    billable: boolean('billable').notNull().default(true),
    rate: money('rate'),
    rateNote: text('rate_note'),
    status: text('status').$type<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'BILLED' | 'REJECTED' | 'WRITTEN_OFF'>().notNull().default('DRAFT'),
    createdById: uuid('created_by_id').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    bookingId: uuid('booking_id'),
    createdAt: createdAt(),
  },
  (t) => [index('time_entries_emp_date_idx').on(t.tenantId, t.employeeId, t.workDate), index('time_entries_status_idx').on(t.tenantId, t.status, t.customerId)],
);

/** Sumber daya yang dijadwalkan: orang (opsional terkait karyawan), ruang, atau peralatan */
export const schedulingResources = pgTable(
  'scheduling_resources',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    kind: text('kind').$type<'PERSON' | 'ROOM' | 'EQUIPMENT'>().notNull(),
    employeeId: uuid('employee_id').references(() => employees.id),
    note: text('note'),
    isActive: boolean('is_active').notNull().default(true),
    /** Jam kerja (WIB) dan hari kerja (1 = Senin … 7 = Minggu, dipisah koma) */
    workStart: integer('work_start').notNull().default(8),
    workEnd: integer('work_end').notNull().default(17),
    workDays: text('work_days').notNull().default('1,2,3,4,5,6'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('scheduling_resources_name_uq').on(t.tenantId, sql`lower(${t.name})`)],
);

export const resourceBookings = pgTable(
  'resource_bookings',
  {
    id: id(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schedulingResources.id),
    projectId: uuid('project_id').references(() => projects.id),
    customerId: uuid('customer_id').references(() => customers.id),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').$type<'BOOKED' | 'DONE' | 'CANCELLED'>().notNull().default('BOOKED'),
    note: text('note'),
    cancelReason: text('cancel_reason'),
    /** Pemesanan berulang: satu seri berbagi series_id */
    seriesId: uuid('series_id'),
    /** Di luar jam/hari kerja sumber daya (hanya Admin/Pemilik yang boleh) */
    offHours: boolean('off_hours').notNull().default(false),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('resource_bookings_range_idx').on(t.tenantId, t.resourceId, t.startsAt)],
);

/** Timer jam kerja: satu timer berjalan per karyawan; saat dihentikan menjadi draf catatan waktu */
export const timeTimers = pgTable(
  'time_timers',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    projectId: uuid('project_id').references(() => projects.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    description: text('description').notNull(),
    billable: boolean('billable').notNull().default(true),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid('created_by_id').notNull(),
  },
  (t) => [uniqueIndex('time_timers_emp_uq').on(t.tenantId, t.employeeId)],
);

/** Retainer: biaya tetap bulanan per pelanggan; satu faktur per periode */
export const serviceRetainers = pgTable('service_retainers', {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  projectId: uuid('project_id').references(() => projects.id),
  title: text('title').notNull(),
  monthlyFee: money('monthly_fee').notNull(),
  withVat: boolean('with_vat'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: uuid('created_by_id').notNull(),
  createdAt: createdAt(),
});

export const serviceRetainerInvoices = pgTable(
  'service_retainer_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => serviceRetainers.id),
    period: text('period').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('service_retainer_invoices_uq').on(t.retainerId, t.period)],
);
