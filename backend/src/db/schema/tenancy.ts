// Skema database — tenancy
import { sql } from 'drizzle-orm';
import { bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './columns';
import { roleEnum } from './enums';

export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

// ---------- Sistem ----------
export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  npwp: text('npwp'),
  address: text('address'),
  ppnRate: numeric('ppn_rate', { precision: 5, scale: 2 }).notNull().default('11'),
  /** Tutup buku: transaksi bertanggal <= tanggal ini ditolak */
  lockedUntil: date('locked_until'),
  /** Pengaturan lain (penggajian, POS, ...) — lihat TenantSettings */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Aplikasi yang diaktifkan per perusahaan */
export const tenantApps = pgTable(
  'tenant_apps',
  {
    tenantId: tenantId(),
    appKey: text('app_key').notNull(),
    enabledAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.appKey] })],
);

/** Peran khusus: peran dasar dikurangi daftar hak tulis (kunci rute "POST /purchase-orders") yang dicabut; hanya mempersempit */
export const customRoles = pgTable(
  'custom_roles',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    baseRole: roleEnum('base_role').notNull(),
    denied: text('denied').array().notNull().default(sql`'{}'`),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('custom_roles_name_uq').on(t.tenantId, sql`lower(${t.name})`)],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('ADMIN'),
    /** Peran khusus (peran dasar dikurangi hak tulis tertentu); null = peran bawaan */
    customRoleId: uuid('custom_role_id'),
    isActive: boolean('is_active').notNull().default(true),
    /** Naik setiap kali sesi harus dicabut (ganti sandi, nonaktif, ganti peran, keluar dari semua perangkat) */
    tokenVersion: integer('token_version').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** null = email belum diverifikasi */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Gudang yang boleh diakses; null/kosong = semua gudang */
    warehouseIds: uuid('warehouse_ids').array(),
    /** Pengguna hanya melihat laporan & transaksi cabang-cabang ini (kosong = semua cabang) */
    branchIds: uuid('branch_ids').array(),
    /** Verifikasi 2 langkah (TOTP): rahasia terenkripsi, aktif sejak, hash kode cadangan */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
    /** Notifikasi Telegram: chat pribadi yang sudah dihubungkan; kode tautan sekali pakai (kedaluwarsa singkat) */
    telegramChatId: text('telegram_chat_id'),
    telegramLinkCode: text('telegram_link_code'),
    telegramLinkExpires: timestamp('telegram_link_expires', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_tenant_idx').on(t.tenantId)],
);

/** Penomoran dokumen tanpa celah per tenant / jenis / periode (mis. INV/2026/10/0001) */
export const documentSequences = pgTable(
  'document_sequences',
  {
    tenantId: tenantId(),
    docType: text('doc_type').notNull(),
    period: text('period').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.docType, t.period] })],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.tenantId, t.entity, t.entityId)],
);

/** Cabang / unit usaha dalam satu perusahaan (satu pembukuan; label cabang pada baris jurnal) */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('branches_code_uq').on(t.tenantId, t.code)],
);

/** Token sekali pakai untuk mengunduh ekspor seluruh data perusahaan: hanya hash yang disimpan, berlaku singkat, sekali pakai */
export const dataExportTokens = pgTable(
  'data_export_tokens',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('data_export_tokens_hash_uq').on(t.tokenHash)],
);

/** Permintaan penghapusan seluruh data perusahaan oleh pemilik: dijadwalkan dengan masa tenggang, dapat dibatalkan atau ditahan sebelum dieksekusi */
export const dataDeletionRequests = pgTable(
  'data_deletion_requests',
  {
    id: id(),
    tenantId: tenantId(),
    requestedById: uuid('requested_by_id').notNull(),
    requestedByEmail: text('requested_by_email').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    scheduledFor: date('scheduled_for').notNull(),
    status: text('status').$type<'SCHEDULED' | 'ON_HOLD' | 'CANCELLED' | 'EXECUTED'>().notNull().default('SCHEDULED'),
    reason: text('reason'),
    /** Pemilik menyatakan memahami kewajiban menyimpan pembukuan/dokumen pajak dan menanggung penyimpanannya sendiri */
    ackRetention: boolean('ack_retention').notNull().default(false),
    /** true = pemilik memilih menghapus tanpa mengunduh ekspor; false = penghapusan menunggu ekspor diunduh */
    exportWaived: boolean('export_waived').notNull().default(false),
    holdReason: text('hold_reason'),
    heldBy: text('held_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('data_deletion_active_uq').on(t.tenantId).where(sql`status IN ('SCHEDULED', 'ON_HOLD')`)],
);

/**
 * Bukti penghapusan data perusahaan (akuntabilitas): sengaja TANPA foreign key dan tanpa isi data bisnis,
 * hanya identitas perusahaan, kapan, siapa yang meminta, dan jumlah baris yang dihapus per tabel.
 */
export const dataErasureLog = pgTable('data_erasure_log', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  companyName: text('company_name').notNull(),
  requestedByEmail: text('requested_by_email').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  exportWaived: boolean('export_waived').notNull(),
  rowsDeleted: integer('rows_deleted').notNull(),
  tablesTouched: integer('tables_touched').notNull(),
  detail: jsonb('detail').$type<Record<string, number>>().notNull(),
});

/** Permintaan persetujuan atas transaksi bernilai besar (pesanan pembelian, jurnal manual) dari peran yang tidak berwenang */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').$type<'PURCHASE_ORDER' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE_PRICE' | 'ASSET_DISPOSAL' | 'CASH_TX' | 'PETTY_REPLENISH' | 'STOCK_ADJUSTMENT' | 'SUPPLIER_PAYMENT' | 'SUPPLIER_ADVANCE' | 'BILL' | 'SUPPLIER_BANK' | 'SALES_ORDER' | 'SALES_RETURN' | 'CUSTOMER_TERMS' | 'CUSTOMER_PAYMENT' | 'STOCK_COUNT' | 'AR_WRITE_OFF' | 'ASSET_METHOD' | 'BIN_MOVE'>().notNull(),
    /** Dokumen yang dimintakan persetujuan (PO); kosong untuk jurnal manual yang baru diposting setelah disetujui */
    refId: text('ref_id'),
    title: text('title').notNull(),
    amount: money('amount').notNull(),
    /** Isi permintaan yang dijalankan saat disetujui (jurnal manual) */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    requestedById: uuid('requested_by_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Penyetuju yang dipilih pemohon (harus berwenang); kosong = semua penyetuju boleh memutuskan */
    assignedToId: uuid('assigned_to_id').references(() => users.id),
    /** Nomor dokumen hasil persetujuan (mis. nomor jurnal) */
    resultRef: text('result_ref'),
  },
  (t) => [
    index('approval_requests_status_idx').on(t.tenantId, t.status, t.requestedAt),
    uniqueIndex('approval_requests_pending_uq').on(t.tenantId, t.kind, t.refId).where(sql`status IN ('PENDING', 'APPROVED') AND ref_id IS NOT NULL`),
  ],
);

// =============================================================
//  Layanan SaaS: verifikasi email, langganan, penagihan, sinkron marketplace
// =============================================================

/** Token sekali pakai (reset sandi / verifikasi email). Yang disimpan hanya hash SHA-256-nya. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<'RESET' | 'VERIFY'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId, t.purpose)],
);

/** Pengaturan milik pemilik layanan (rekening transfer, masa trial, dsb.) — satu baris kunci/nilai */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Catatan error server (5xx) untuk pemantauan pemilik layanan */
export const errorLogs = pgTable(
  'error_logs',
  {
    id: id(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    status: integer('status').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    tenantId: uuid('tenant_id'),
    userId: uuid('user_id'),
  },
  (t) => [index('error_logs_at_idx').on(t.at)],
);
