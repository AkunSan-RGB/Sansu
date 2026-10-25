// Skema database — assets
import { relations, sql } from 'drizzle-orm';
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { branches, tenantId } from './tenancy';
import { accounts } from './accounting';

export const assetCategories = pgTable(
  'asset_categories',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => accounts.id),
    accumulatedAccountId: uuid('accumulated_account_id').references(() => accounts.id),
    expenseAccountId: uuid('expense_account_id').references(() => accounts.id),
    /** STRAIGHT_LINE | DECLINING_BALANCE | NONE */
    method: text('method').notNull().default('STRAIGHT_LINE'),
    usefulLifeMonths: integer('useful_life_months').notNull().default(48),
    /** Kelompok harta fiskal (Pasal 11 UU PPh) */
    fiscalGroup: text('fiscal_group').notNull().default('GROUP_1'),
    /** Metode penyusutan fiskal: STRAIGHT_LINE | DECLINING_BALANCE */
    fiscalMethod: text('fiscal_method').notNull().default('STRAIGHT_LINE'),
  },
  (t) => [uniqueIndex('asset_categories_name_uq').on(t.tenantId, t.name)],
);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id),
    acquisitionDate: date('acquisition_date').notNull(),
    /** Bulan pertama disusutkan (YYYY-MM-01) */
    depreciationStart: date('depreciation_start').notNull(),
    cost: money('cost').notNull(),
    residualValue: money('residual_value').notNull().default('0'),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    method: text('method').notNull(),
    /** Riwayat perubahan metode (berlaku ke depan): from = bulan berlaku, accumulatedAt = akumulasi tepat sebelum bulan itu */
    methodChanges: jsonb('method_changes').$type<{ from: string; method: string; prevMethod: string; accumulatedAt: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** Metode unit produksi: kapasitas total (mis. 200000 km) dan satuannya */
    totalUnits: numeric('total_units', { precision: 18, scale: 4 }),
    unitLabel: text('unit_label'),
    /** Akumulasi penyusutan sebelum memakai SANSU (aset lama) */
    openingAccumulated: money('opening_accumulated').notNull().default('0'),
    /** Akumulasi penyusutan fiskal sebelum memakai SANSU */
    openingFiscalAccumulated: money('opening_fiscal_accumulated').notNull().default('0'),
    location: text('location'),
    /** Penanggung jawab aset (orang/divisi yang memegang) */
    custodian: text('custodian'),
    /** Pemeriksaan fisik terakhir: FOUND (ada) | DAMAGED (rusak) | MISSING (tidak ditemukan) */
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    verificationStatus: text('verification_status').$type<'FOUND' | 'DAMAGED' | 'MISSING'>(),
    verificationNote: text('verification_note'),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),
    acquisitionJournalId: uuid('acquisition_journal_id'),
    /** Dibeli lewat faktur supplier */
    purchaseInvoiceId: uuid('purchase_invoice_id'),
    disposalDate: date('disposal_date'),
    disposalPrice: money('disposal_price'),
    disposalJournalId: uuid('disposal_journal_id'),
    createdAt: createdAt(),
    /** Cabang pemilik aset: penyusutan otomatis berlabel cabang ini */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
  },
  (t) => [uniqueIndex('fixed_assets_code_uq').on(t.tenantId, t.code)],
);

export const assetDepreciations = pgTable(
  'asset_depreciations',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id),
    /** YYYY-MM */
    period: text('period').notNull(),
    amount: money('amount').notNull(),
    journalId: uuid('journal_id'),
  },
  (t) => [uniqueIndex('asset_depreciations_uq').on(t.assetId, t.period), index('asset_depreciations_tenant_idx').on(t.tenantId, t.period)],
);

export const assetCategoriesRelations = relations(assetCategories, ({ one, many }) => ({
  assetAccount: one(accounts, { fields: [assetCategories.assetAccountId], references: [accounts.id], relationName: 'catAsset' }),
  accumulatedAccount: one(accounts, { fields: [assetCategories.accumulatedAccountId], references: [accounts.id], relationName: 'catAccum' }),
  expenseAccount: one(accounts, { fields: [assetCategories.expenseAccountId], references: [accounts.id], relationName: 'catExpense' }),
  assets: many(fixedAssets),
}));

export const fixedAssetsRelations = relations(fixedAssets, ({ one, many }) => ({
  category: one(assetCategories, { fields: [fixedAssets.categoryId], references: [assetCategories.id] }),
  depreciations: many(assetDepreciations),
}));

export const assetDepreciationsRelations = relations(assetDepreciations, ({ one }) => ({
  asset: one(fixedAssets, { fields: [assetDepreciations.assetId], references: [fixedAssets.id] }),
}));

/** Pemakaian aset per bulan (metode unit produksi): dasar penyusutan bulan itu */
export const assetUsage = pgTable(
  'asset_usage',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    units: numeric('units', { precision: 18, scale: 4 }).notNull(),
    note: text('note'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('asset_usage_asset_period_uq').on(t.assetId, t.period)],
);
