// Skema database — accounting
import { relations } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { branches, tenantId } from './tenancy';
import { accountTypeEnum } from './enums';

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    tenantId: tenantId(),
    currency: text('currency').notNull(),
    date: date('date').notNull(),
    /** Rupiah per 1 satuan mata uang asing */
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exchange_rates_uq').on(t.tenantId, t.currency, t.date)],
);

// ---------- Akuntansi ----------
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id),
    isPostable: boolean('is_postable').notNull().default(true),
    /** Kunci akun sistem untuk jurnal otomatis (CASH, AR, INVENTORY, SALES, ...) */
    systemKey: text('system_key'),
    /** Akun kas / rekening bank (muncul di modul Kas & Bank) */
    isCashAccount: boolean('is_cash_account').notNull().default(false),
    /** Mata uang rekening kas/bank: IDR (bawaan) atau kode valas; akun valas menyimpan jumlah valas di tiap baris jurnalnya */
    currency: text('currency').notNull().default('IDR'),
    /** Kelompok penyajian laporan keuangan SAK EP (lihat REPORT_GROUPS di @sansu/shared) */
    reportGroup: text('report_group'),
    /** Perlakuan fiskal untuk rekonsiliasi PPh Badan */
    fiscalTreatment: text('fiscal_treatment').notNull().default('NORMAL'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    /** Rekening kas/bank milik cabang: transaksi lewat rekening ini otomatis berlabel cabang */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
  },
  (t) => [uniqueIndex('accounts_code_uq').on(t.tenantId, t.code), uniqueIndex('accounts_system_key_uq').on(t.tenantId, t.systemKey)],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    description: text('description').notNull(),
    /** MANUAL | INVOICE | PAYMENT | STOCK_ADJUSTMENT | REVERSAL */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    reversalOfId: uuid('reversal_of_id').references((): AnyPgColumn => journalEntries.id),
    /** Nomor bukti transaksi (kuitansi, nota, faktur pihak lain) */
    reference: text('reference'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_number_uq').on(t.tenantId, t.number),
    uniqueIndex('journal_entries_reversal_uq').on(t.reversalOfId),
    index('journal_entries_date_idx').on(t.tenantId, t.date),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    debit: money('debit').notNull().default('0'),
    credit: money('credit').notNull().default('0'),
    /** Jumlah dalam valas (selalu positif; arahnya mengikuti sisi debit/kredit) — hanya untuk akun bermata uang asing */
    foreignAmount: money('foreign_amount'),
    memo: text('memo'),
    /** Jurnal umum: biaya/pendapatan untuk proyek tertentu (usaha jasa) */
    projectId: uuid('project_id'),
    /** Cabang (diturunkan otomatis dari gudang/kas bila tidak diisi); kosong = pusat / belum ditentukan */
    branchId: uuid('branch_id'),
  },
  (t) => [index('journal_lines_account_idx').on(t.accountId), index('journal_lines_journal_idx').on(t.journalId)],
);

/** Jurnal balik terjadwal (akrual yang dibalik otomatis di awal periode berikutnya) */
export const scheduledReversals = pgTable(
  'scheduled_reversals',
  {
    id: id(),
    tenantId: tenantId(),
    journalId: uuid('journal_id').notNull().references(() => journalEntries.id),
    reverseOn: date('reverse_on').notNull(),
    /** PENDING · DONE · SKIPPED (sudah dibalik manual) · CANCELLED */
    status: text('status').$type<'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELLED'>().notNull().default('PENDING'),
    reversalJournalId: uuid('reversal_journal_id'),
    lastError: text('last_error'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('scheduled_reversals_journal_uq').on(t.journalId), index('scheduled_reversals_due_idx').on(t.tenantId, t.status, t.reverseOn)],
);

// ---------- Jurnal berulang ----------
export const recurringJournals = pgTable('recurring_journals', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** MONTHLY | QUARTERLY | YEARLY */
  frequency: text('frequency').notNull().default('MONTHLY'),
  nextDate: date('next_date').notNull(),
  endDate: date('end_date'),
  /** Batasi jumlah kejadian (mis. amortisasi sewa 12 bulan) */
  remaining: integer('remaining'),
  isAdjustment: boolean('is_adjustment').notNull().default(true),
  lines: jsonb('lines').$type<{ accountId: string; debit?: string; credit?: string; memo?: string }[]>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Fiskal & CALK ----------
export const fiscalAdjustments = pgTable('fiscal_adjustments', {
  id: id(),
  tenantId: tenantId(),
  year: integer('year').notNull(),
  description: text('description').notNull(),
  /** POSITIVE (menambah laba fiskal) | NEGATIVE */
  kind: text('kind').notNull(),
  amount: money('amount').notNull(),
});

export const fiscalYears = pgTable(
  'fiscal_years',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    /** Kompensasi kerugian fiskal tahun sebelumnya */
    lossCarryforward: money('loss_carryforward').notNull().default('0'),
    /** Peredaran bruto (bila diisi manual, menggantikan hitungan otomatis) */
    grossRevenueOverride: money('gross_revenue_override'),
    /** Biaya untuk penghasilan PPh final (bila diisi manual, menggantikan hitungan otomatis) */
    finalCostOverride: money('final_cost_override'),
    taxJournalId: uuid('tax_journal_id'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

/** Teks CALK yang diubah pengguna (menggantikan teks otomatis untuk bagian tertentu) */
export const reportNotes = pgTable(
  'report_notes',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    key: text('key').notNull(),
    content: text('content').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year, t.key] })],
);

/** Snapshot laporan keuangan yang dibekukan saat ditandatangani (tidak dapat diubah/dihapus; versi baru = rekaman baru) */
export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: id(),
    tenantId: tenantId(),
    year: integer('year').notNull(),
    version: integer('version').notNull(),
    signedById: uuid('signed_by_id').notNull(),
    signedByName: text('signed_by_name').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    contentHash: text('content_hash').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [uniqueIndex('report_snapshots_version_uq').on(t.tenantId, t.year, t.version)],
);

/** Kontrak pembiayaan (data induk): pinjaman, sewa pembiayaan, biaya dibayar di muka; jadwalnya dihitung dari syarat kontrak */
export const financingContracts = pgTable(
  'financing_contracts',
  {
    id: id(),
    tenantId: tenantId(),
    /** LOAN | LEASE | PREPAID */
    kind: text('kind').$type<'LOAN' | 'LEASE' | 'PREPAID'>().notNull(),
    name: text('name').notNull(),
    counterparty: text('counterparty'),
    /** Akun neraca tempat saldo kontrak dicatat (utang bank, liabilitas sewa, atau dibayar di muka) */
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    /** Akun beban bunga (pinjaman/sewa) atau beban amortisasi (dibayar di muka) */
    expenseAccountId: uuid('expense_account_id').references(() => accounts.id),
    startDate: date('start_date').notNull(),
    termMonths: integer('term_months').notNull(),
    amount: money('amount').notNull(),
    ratePct: numeric('rate_pct', { precision: 9, scale: 4 }),
    method: text('method').$type<'ANNUITY' | 'STRAIGHT_PRINCIPAL' | 'BULLET' | 'STRAIGHT_LINE'>().notNull(),
    /** ACTIVE | CLOSED */
    status: text('status').$type<'ACTIVE' | 'CLOSED'>().notNull().default('ACTIVE'),
    notes: text('notes'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('financing_contracts_name_uq').on(t.tenantId, t.name), index('financing_contracts_account_idx').on(t.tenantId, t.accountId)],
);

export const journalEntriesRelations = relations(journalEntries, ({ many }) => ({ lines: many(journalLines) }));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  journal: one(journalEntries, { fields: [journalLines.journalId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalLines.accountId], references: [accounts.id] }),
}));

// ---------- Setoran pajak ----------
export const taxPayments = pgTable(
  'tax_payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** PPN · PPH21 · PPH23 · PPH4_2 · PPH25 · PPH29 · PPH_FINAL · BPJS */
    type: text('type').notNull(),
    /** Masa pajak YYYY-MM (tahunan: YYYY-12) */
    period: text('period').notNull(),
    date: date('date').notNull(),
    amount: money('amount').notNull(),
    /** PPN: bagian PPN keluaran & masukan yang dikompensasikan */
    vatOut: money('vat_out').notNull().default('0'),
    vatIn: money('vat_in').notNull().default('0'),
    cashAccountId: uuid('cash_account_id').references(() => accounts.id),
    billingCode: text('billing_code'),
    ntpn: text('ntpn'),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tax_payments_number_uq').on(t.tenantId, t.number), index('tax_payments_period_idx').on(t.tenantId, t.type, t.period)],
);

export const taxPaymentsRelations = relations(taxPayments, ({ one }) => ({
  cashAccount: one(accounts, { fields: [taxPayments.cashAccountId], references: [accounts.id] }),
}));

// ---------- Anggaran ----------
export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    tenantId: tenantId(),
    year: integer('year').notNull(),
    name: text('name').notNull(),
    /** DRAFT (bisa diubah) | APPROVED (terkunci; dibuka kembali hanya Pemilik/Admin dengan alasan) */
    status: text('status').$type<'DRAFT' | 'APPROVED'>().notNull().default('DRAFT'),
    /** Realisasi beban melebihi anggaran sampai tahun-ke-tanggal + persen ini → peringatan */
    tolerancePct: integer('tolerance_pct').notNull().default(10),
    createdById: uuid('created_by_id'),
    approvedById: uuid('approved_by_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budgets_year_uq').on(t.tenantId, t.year)],
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: id(),
    tenantId: tenantId(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    month: integer('month').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('budget_lines_uq').on(t.budgetId, t.accountId, t.month)],
);

export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    id: id(),
    tenantId: tenantId(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    month: integer('month').notNull(),
    level: text('level').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('budget_alerts_uq').on(t.budgetId, t.accountId, t.month, t.level)],
);
