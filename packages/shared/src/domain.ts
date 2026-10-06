/**
 * Enum domain SANSU — satu sumber kebenaran untuk backend (enum PostgreSQL, validasi DTO)
 * dan frontend (pilihan dropdown, label status).
 */

export const ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'CASHIER', 'HR'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Pemilik',
  ADMIN: 'Admin',
  FINANCE: 'Keuangan',
  SALES: 'Sales',
  WAREHOUSE: 'Gudang',
  CASHIER: 'Kasir',
  HR: 'SDM / HRD',
};

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Aset',
  LIABILITY: 'Liabilitas',
  EQUITY: 'Ekuitas',
  REVENUE: 'Pendapatan',
  EXPENSE: 'Beban',
};

export const SALES_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Dikonfirmasi',
  INVOICED: 'Difakturkan',
  CANCELLED: 'Batal',
};

export const INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: 'Belum bayar',
  PARTIAL: 'Bayar sebagian',
  PAID: 'Lunas',
};

export const STOCK_MOVE_TYPES = [
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE',
  'PURCHASE_RETURN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'REVALUATION',
  'PRODUCTION_ISSUE',
  'PRODUCTION_OUTPUT',
  'PRODUCTION_RETURN',
] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPES)[number];
export const STOCK_MOVE_LABELS: Record<StockMoveType, string> = {
  ADJUSTMENT_IN: 'Penyesuaian +',
  ADJUSTMENT_OUT: 'Penyesuaian −',
  SALE: 'Penjualan',
  SALE_RETURN: 'Retur jual',
  PURCHASE: 'Pembelian',
  PURCHASE_RETURN: 'Retur beli',
  TRANSFER_IN: 'Transfer masuk',
  TRANSFER_OUT: 'Transfer keluar',
  REVALUATION: 'Penurunan nilai',
  PRODUCTION_ISSUE: 'Bahan ke produksi',
  PRODUCTION_OUTPUT: 'Hasil produksi',
  PRODUCTION_RETURN: 'Bahan kembali (produksi batal)',
};

export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'GIRO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Tunai (Kas)',
  TRANSFER: 'Transfer (Bank)',
  GIRO: 'Giro (Bank)',
};

export const ADJUSTMENT_REASONS = ['OPENING', 'STOCK_OPNAME', 'DAMAGED', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  OPENING: 'Saldo awal',
  STOCK_OPNAME: 'Hasil stock opname',
  DAMAGED: 'Barang rusak / kedaluwarsa',
  OTHER: 'Lainnya',
};

export const JOURNAL_SOURCES = [
  'MANUAL',
  'OPENING',
  'INVOICE',
  'PAYMENT',
  'SALES_RETURN',
  'PURCHASE_INVOICE',
  'SUPPLIER_PAYMENT',
  'PURCHASE_RETURN',
  'CASH_IN',
  'CASH_OUT',
  'TRANSFER',
  'STOCK_ADJUSTMENT',
  'REVERSAL',
  'CLOSING',
  'POS',
  'POS_CLOSE',
  'PAYROLL',
  'PAYROLL_PAYMENT',
  'ADJUSTMENT',
  'RECURRING',
  'ASSET_ACQUISITION',
  'DEPRECIATION',
  'ASSET_DISPOSAL',
  'INCOME_TAX',
  'TAX_PAYMENT',
  'BANK',
  'STOCK_TRANSFER',
  'CASH_COUNT',
  'INVENTORY_WRITEDOWN',
  'CUSTOMER_DEPOSIT',
  'DEPOSIT_APPLICATION',
  'PROJECT_PROGRESS',
  'PRODUCTION',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];
export const JOURNAL_SOURCE_LABELS: Record<JournalSource, string> = {
  MANUAL: 'Manual',
  OPENING: 'Saldo awal',
  INVOICE: 'Faktur jual',
  PAYMENT: 'Terima piutang',
  SALES_RETURN: 'Retur jual',
  PURCHASE_INVOICE: 'Faktur beli',
  SUPPLIER_PAYMENT: 'Bayar hutang',
  PURCHASE_RETURN: 'Retur beli',
  CASH_IN: 'Kas masuk',
  CASH_OUT: 'Kas keluar',
  TRANSFER: 'Transfer kas',
  STOCK_ADJUSTMENT: 'Stok',
  REVERSAL: 'Pembalikan',
  CLOSING: 'Tutup buku',
  POS: 'Penjualan kasir',
  POS_CLOSE: 'Tutup kasir',
  PAYROLL: 'Penggajian',
  PAYROLL_PAYMENT: 'Bayar gaji',
  ADJUSTMENT: 'Penyesuaian',
  RECURRING: 'Jurnal berulang',
  ASSET_ACQUISITION: 'Perolehan aset',
  DEPRECIATION: 'Penyusutan',
  ASSET_DISPOSAL: 'Pelepasan aset',
  INCOME_TAX: 'Pajak penghasilan',
  TAX_PAYMENT: 'Setor pajak',
  BANK: 'Mutasi bank',
  STOCK_TRANSFER: 'Transfer gudang',
  CASH_COUNT: 'Opname kas',
  INVENTORY_WRITEDOWN: 'Penurunan nilai persediaan',
  CUSTOMER_DEPOSIT: 'Uang muka pelanggan',
  DEPOSIT_APPLICATION: 'Pemakaian uang muka',
  PROJECT_PROGRESS: 'Kemajuan proyek',
  PRODUCTION: 'Produksi',
};

/**
 * Tarif PPh yang dipotong pelanggan atas tagihan jasa (PMK 141/2015 untuk PPh 23; PP 9/2022 untuk jasa
 * konstruksi; PP 34/2017 untuk sewa tanah/bangunan). `account` = akun pendapatan yang disarankan.
 */
export const CUSTOMER_WITHHOLDING_PRESETS = [
  { key: 'PPH23_JASA', type: 'PPH23', rate: 2, account: '4-2000', label: 'PPh 23 — jasa lain / jasa teknik / manajemen (2%)' },
  { key: 'KONSTRUKSI_KECIL', type: 'PPH4_2', rate: 1.75, account: '4-2100', label: 'PPh 4(2) — pelaksana konstruksi, kualifikasi kecil/perseorangan (1,75%)' },
  { key: 'KONSTRUKSI_MENENGAH', type: 'PPH4_2', rate: 2.65, account: '4-2100', label: 'PPh 4(2) — pelaksana konstruksi, kualifikasi menengah/besar (2,65%)' },
  { key: 'KONSTRUKSI_TANPA_SBU', type: 'PPH4_2', rate: 4, account: '4-2100', label: 'PPh 4(2) — pelaksana konstruksi tanpa sertifikat (4%)' },
  { key: 'KONSULTAN_SBU', type: 'PPH4_2', rate: 3.5, account: '4-2100', label: 'PPh 4(2) — konsultansi konstruksi bersertifikat (3,5%)' },
  { key: 'KONSULTAN_TANPA_SBU', type: 'PPH4_2', rate: 6, account: '4-2100', label: 'PPh 4(2) — konsultansi konstruksi tanpa sertifikat (6%)' },
  { key: 'SEWA_BANGUNAN', type: 'PPH4_2', rate: 10, account: '4-2200', label: 'PPh 4(2) — sewa tanah / bangunan (10%)' },
] as const;

export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'BILLED', 'CANCELLED'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Dikirim ke supplier',
  BILLED: 'Sudah difakturkan',
  CANCELLED: 'Batal',
};

export const CASH_TX_TYPES = ['IN', 'OUT', 'TRANSFER'] as const;
export type CashTxType = (typeof CASH_TX_TYPES)[number];
export const CASH_TX_TYPE_LABELS: Record<CashTxType, string> = {
  IN: 'Kas masuk',
  OUT: 'Kas keluar',
  TRANSFER: 'Transfer',
};

// ---------- POS ----------
export const POS_PAYMENT_METHODS = ['CASH', 'QRIS', 'DEBIT', 'TRANSFER'] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];
export const POS_PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  CASH: 'Tunai',
  QRIS: 'QRIS',
  DEBIT: 'Kartu debit',
  TRANSFER: 'Transfer',
};

export const POS_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type PosSessionStatus = (typeof POS_SESSION_STATUSES)[number];
export const POS_SESSION_STATUS_LABELS: Record<PosSessionStatus, string> = { OPEN: 'Buka', CLOSED: 'Tutup' };

// ---------- CRM ----------
export const LEAD_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = { OPEN: 'Berjalan', WON: 'Menang', LOST: 'Kalah' };

export const ACTIVITY_TYPES = ['CALL', 'WHATSAPP', 'MEETING', 'EMAIL', 'TODO'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: 'Telepon',
  WHATSAPP: 'WhatsApp',
  MEETING: 'Kunjungan / rapat',
  EMAIL: 'Email',
  TODO: 'Tugas',
};

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Terkirim',
  ACCEPTED: 'Diterima → SO',
  REJECTED: 'Ditolak',
  CANCELLED: 'Batal',
};

// ---------- SDM & penggajian ----------
export const PTKP_STATUSES = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'] as const;
export type PtkpStatus = (typeof PTKP_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['HADIR', 'IZIN', 'SAKIT', 'CUTI', 'ALPA', 'LIBUR'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  HADIR: 'Hadir',
  IZIN: 'Izin (tidak dibayar)',
  SAKIT: 'Sakit',
  CUTI: 'Cuti',
  ALPA: 'Alpa',
  LIBUR: 'Libur',
};

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: 'Cuti tahunan',
  SICK: 'Sakit (surat dokter)',
  UNPAID: 'Cuti tidak dibayar',
  OTHER: 'Cuti khusus (menikah, duka, dll.)',
};

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = { PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

export const PAYROLL_STATUSES = ['DRAFT', 'POSTED', 'PAID'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];
export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = { DRAFT: 'Draft', POSTED: 'Diposting', PAID: 'Dibayar' };

/** Ubah peta label menjadi opsi dropdown { value, label } */
export const toOptions = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

// ---------- Opname kas ----------
/** Pecahan rupiah yang dihitung saat opname kas / tutup kasir */
export const CASH_DENOMINATIONS = [
  { key: 'K100000', value: 100000, kind: 'Kertas' },
  { key: 'K50000', value: 50000, kind: 'Kertas' },
  { key: 'K20000', value: 20000, kind: 'Kertas' },
  { key: 'K10000', value: 10000, kind: 'Kertas' },
  { key: 'K5000', value: 5000, kind: 'Kertas' },
  { key: 'K2000', value: 2000, kind: 'Kertas' },
  { key: 'K1000', value: 1000, kind: 'Kertas' },
  { key: 'L1000', value: 1000, kind: 'Logam' },
  { key: 'L500', value: 500, kind: 'Logam' },
  { key: 'L200', value: 200, kind: 'Logam' },
  { key: 'L100', value: 100, kind: 'Logam' },
] as const;
export type CashDenominationKey = (typeof CASH_DENOMINATIONS)[number]['key'];
export const CASH_COUNT_STATUS = ['DRAFT', 'WAITING_APPROVAL', 'POSTED', 'CANCELLED'] as const;
export type CashCountStatus = (typeof CASH_COUNT_STATUS)[number];
export const CASH_COUNT_STATUS_LABELS: Record<CashCountStatus, string> = {
  DRAFT: 'Sedang dihitung',
  WAITING_APPROVAL: 'Menunggu persetujuan',
  POSTED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const PRODUCTION_STATUSES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  DRAFT: 'Rencana',
  IN_PROGRESS: 'Sedang diproduksi',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};
