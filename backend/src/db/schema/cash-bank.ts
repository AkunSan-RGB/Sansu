// Skema database — cash-bank
import { relations } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { tenantId, users } from './tenancy';
import { cashTxTypeEnum } from './enums';
import { accounts, journalLines } from './accounting';

export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    type: cashTxTypeEnum('type').notNull(),
    /** Akun kas/bank sumber (OUT, TRANSFER) atau tujuan (IN) */
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    /** Hanya TRANSFER: rekening tujuan */
    toCashAccountId: uuid('to_cash_account_id').references(() => accounts.id),
    amount: money('amount').notNull(),
    /** Transaksi valas: mata uang rekening valas dan jumlahnya (amount = nilai Rupiah) */
    currency: text('currency'),
    amountForeign: money('amount_foreign'),
    description: text('description').notNull(),
    reference: text('reference'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    /** Cabang transaksi kas/biaya (kosong = pusat) */
    branchId: uuid('branch_id'),
    /** POSTED | VOID (dibatalkan dengan jurnal pembalik; transaksi tidak pernah dihapus) */
    status: text('status').$type<'POSTED' | 'VOID'>().notNull().default('POSTED'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id'),
    voidReason: text('void_reason'),
    voidJournalId: uuid('void_journal_id'),
  },
  (t) => [
    uniqueIndex('cash_transactions_number_uq').on(t.tenantId, t.number),
    index('cash_transactions_date_idx').on(t.tenantId, t.date),
  ],
);

/**
 * Kas kecil dengan sistem dana tetap (imprest): dana ditetapkan sebesar plafon; pengeluaran dicatat dengan bukti kas kecil
 * (langsung dibebankan), lalu pengisian kembali mengembalikan dana ke plafon. Kas kecil + bukti belum diganti = plafon.
 */
export const pettyCashFunds = pgTable(
  'petty_cash_funds',
  {
    id: id(),
    tenantId: tenantId(),
    /** Akun kas kecil di bagan akun (mis. 1-1110) */
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    /** Sumber pengisian: kas besar / bank */
    fundingAccountId: uuid('funding_account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    custodianName: text('custodian_name').notNull(),
    imprestAmount: money('imprest_amount').notNull(),
    /** Batas nilai per bukti kas kecil */
    maxVoucher: money('max_voucher').notNull(),
    status: text('status').$type<'ACTIVE' | 'CLOSED'>().notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_funds_account_uq').on(t.tenantId, t.accountId)],
);

export const pettyCashVouchers = pgTable(
  'petty_cash_vouchers',
  {
    id: id(),
    tenantId: tenantId(),
    fundId: uuid('fund_id').notNull().references(() => pettyCashFunds.id),
    number: text('number').notNull(),
    date: date('date').notNull(),
    payee: text('payee').notNull(),
    description: text('description').notNull(),
    expenseAccountId: uuid('expense_account_id').notNull().references(() => accounts.id),
    amount: money('amount').notNull(),
    /** Nomor nota/kuitansi (wajib) */
    receiptRef: text('receipt_ref').notNull(),
    /** OPEN = belum diganti · REPLENISHED = sudah diganti lewat pengisian kembali · VOID = dibatalkan */
    status: text('status').$type<'OPEN' | 'REPLENISHED' | 'VOID'>().notNull().default('OPEN'),
    cashTransactionId: uuid('cash_transaction_id'),
    replenishmentId: uuid('replenishment_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_vouchers_number_uq').on(t.tenantId, t.number), index('petty_cash_vouchers_fund_idx').on(t.fundId, t.status)],
);

export const pettyCashReplenishments = pgTable(
  'petty_cash_replenishments',
  {
    id: id(),
    tenantId: tenantId(),
    fundId: uuid('fund_id').notNull().references(() => pettyCashFunds.id),
    number: text('number').notNull(),
    date: date('date').notNull(),
    total: money('total').notNull(),
    voucherCount: integer('voucher_count').notNull(),
    cashTransactionId: uuid('cash_transaction_id'),
    requestedById: uuid('requested_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_replenishments_number_uq').on(t.tenantId, t.number)],
);

/** Lawan akun kas masuk/keluar (mis. Beban Listrik, Modal) */
export const cashTransactionLines = pgTable('cash_transaction_lines', {
  id: id(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => cashTransactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  amount: money('amount').notNull(),
  memo: text('memo'),
  /** Biaya langsung proyek (usaha jasa) */
  projectId: uuid('project_id'),
  /** Kas masuk non-penjualan: sumber dalam bahasa kegiatan usaha (akun ditentukan sistem) */
  sourceKey: text('source_key'),
});

export const cashTransactionsRelations = relations(cashTransactions, ({ one, many }) => ({
  cashAccount: one(accounts, { fields: [cashTransactions.cashAccountId], references: [accounts.id], relationName: 'cashFrom' }),
  toCashAccount: one(accounts, { fields: [cashTransactions.toCashAccountId], references: [accounts.id], relationName: 'cashTo' }),
  lines: many(cashTransactionLines),
}));

export const cashTransactionLinesRelations = relations(cashTransactionLines, ({ one }) => ({
  transaction: one(cashTransactions, { fields: [cashTransactionLines.transactionId], references: [cashTransactions.id] }),
  account: one(accounts, { fields: [cashTransactionLines.accountId], references: [accounts.id] }),
}));

// ---------- Rekonsiliasi bank ----------
export const bankStatements = pgTable('bank_statements', {
  id: id(),
  tenantId: tenantId(),
  cashAccountId: uuid('cash_account_id')
    .notNull()
    .references(() => accounts.id),
  fileName: text('file_name'),
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  openingBalance: money('opening_balance'),
  closingBalance: money('closing_balance'),
  status: text('status').notNull().default('OPEN'),
  /** Pengimpor — pengesahan rekonsiliasi harus orang lain (pemisahan tugas) */
  importedById: uuid('imported_by_id'),
  createdAt: createdAt(),
});

export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    id: id(),
    tenantId: tenantId(),
    statementId: uuid('statement_id')
      .notNull()
      .references(() => bankStatements.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    date: date('date').notNull(),
    description: text('description').notNull(),
    /** + uang masuk (kredit di rekening koran), − uang keluar */
    amount: money('amount').notNull(),
    balance: money('balance'),
    /** UNMATCHED · MATCHED (cocok dengan baris buku) · CREATED (jurnal dibuat dari sini) · IGNORED */
    status: text('status').notNull().default('UNMATCHED'),
    journalLineId: uuid('journal_line_id').references(() => journalLines.id, { onDelete: 'set null' }),
    journalId: uuid('journal_id'),
    matchedBy: text('matched_by'),
    /** Alasan diabaikan / catatan */
    note: text('note'),
  },
  (t) => [index('bank_lines_statement_idx').on(t.statementId), uniqueIndex('bank_lines_journal_line_uq').on(t.journalLineId)],
);

/** Baris buku tambahan untuk satu mutasi bank (pencocokan satu-ke-banyak); baris buku pertama tetap di bank_statement_lines.journal_line_id */
export const bankLineExtraMatches = pgTable(
  'bank_line_extra_matches',
  {
    id: id(),
    tenantId: tenantId(),
    lineId: uuid('line_id')
      .notNull()
      .references(() => bankStatementLines.id, { onDelete: 'cascade' }),
    journalLineId: uuid('journal_line_id')
      .notNull()
      .references(() => journalLines.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('bank_extra_matches_jl_uq').on(t.journalLineId), index('bank_extra_matches_line_idx').on(t.lineId)],
);

export const bankStatementsRelations = relations(bankStatements, ({ one, many }) => ({
  cashAccount: one(accounts, { fields: [bankStatements.cashAccountId], references: [accounts.id] }),
  lines: many(bankStatementLines),
}));

export const bankStatementLinesRelations = relations(bankStatementLines, ({ one }) => ({
  statement: one(bankStatements, { fields: [bankStatementLines.statementId], references: [bankStatements.id] }),
}));

/** Opname kas: hitung fisik uang per pecahan → selisih terhadap saldo buku dibukukan ke Selisih Kas */
export const cashCounts = pgTable(
  'cash_counts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    /** DRAFT · WAITING_APPROVAL (selisih besar, menunggu Pemilik) · POSTED · CANCELLED */
    status: text('status').$type<'DRAFT' | 'WAITING_APPROVAL' | 'POSTED' | 'CANCELLED'>().notNull().default('DRAFT'),
    denominations: jsonb('denominations').$type<Record<string, number>>().notNull().default({}),
    items: jsonb('items').$type<{ type: 'ADD' | 'LESS'; description: string; amount: string }[]>().notNull().default([]),
    bookBalance: money('book_balance').notNull().default('0'),
    countedTotal: money('counted_total').notNull().default('0'),
    itemsTotal: money('items_total').notNull().default('0'),
    difference: money('difference').notNull().default('0'),
    custodianName: text('custodian_name'),
    notes: text('notes'),
    /** Penjelasan selisih (wajib bila ada selisih) */
    reason: text('reason'),
    rejectReason: text('reject_reason'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id').references(() => users.id),
    approvedById: uuid('approved_by_id').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cash_counts_number_uq').on(t.tenantId, t.number), index('cash_counts_account_idx').on(t.accountId, t.date)],
);

/** Aturan kategori otomatis mutasi bank (mis. 'BIAYA ADMIN' → Beban Administrasi Bank) */
export const bankRules = pgTable('bank_rules', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  keyword: text('keyword').notNull(),
  direction: text('direction').$type<'IN' | 'OUT' | 'ANY'>().notNull().default('ANY'),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  /** Di atas nilai ini mutasi tetap diproses manual */
  maxAmount: money('max_amount').notNull().default('5000000'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

/** Pengesahan rekonsiliasi bank akhir bulan */
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: id(),
    tenantId: tenantId(),
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    period: text('period').notNull(),
    bookBalance: money('book_balance').notNull(),
    signedById: uuid('signed_by_id').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('bank_reconciliations_uq').on(t.cashAccountId, t.period)],
);
