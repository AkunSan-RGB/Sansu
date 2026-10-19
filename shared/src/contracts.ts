import type { FiscalTreatment, ReportGroup, ReportingFramework, TaxPaymentType } from './accounting.js';
import type { AppKey, BusinessModel } from './apps.js';
import type { TaxFeatures } from './tax-features.js';
/**
 * Kontrak respons API SANSU (dipakai frontend; backend menghasilkan bentuk ini).
 * Angka uang/kuantitas dikirim sebagai string agar presisi tidak hilang.
 */
import type {
  CashCountStatus,
  CashDenominationKey,
  AccountType,
  ActivityType,
  AttendanceStatus,
  LeadStatus,
  LeaveStatus,
  LeaveType,
  PayrollStatus,
  OnlineChannel,
  PosOrderType,
  PosPaymentMethod,
  PosSessionStatus,
  QuotationStatus,
  CashTxType,
  InvoiceStatus,
  JournalSource,
  PurchaseOrderStatus,
  Role,
  SalesOrderStatus,
  ProductionStatus,
  StockMoveType,
} from './domain.js';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Nama peran khusus (peran dasar dikurangi hak tertentu); null = peran bawaan */
  roleLabel?: string | null;
  tenantId: string;
  tenantName: string;
  ppnRate: string;
  /** Status PKP & cara harga kasir */
  taxProfile: TaxProfile;
  /** Aplikasi yang aktif di perusahaan */
  apps: AppKey[];
  /** Fitur pajak yang relevan menurut jenis usaha, status PKP, dan skema PPh (menu pajak mengikuti ini) */
  taxFeatures: TaxFeatures;
  /** Model bisnis perusahaan (Dagang, Ritel, Jasa, FMCG, Manufaktur, F&B) */
  businessModel: BusinessModel;
  /** Perusahaan punya cabang usaha (fitur cabang tampil); mati = menu & isian cabang disembunyikan */
  multiBranch?: boolean;
  /** Sebutan perusahaan untuk "Resep" (BOM) */
  recipeTerm?: string;
  /** Perusahaan contoh dari tombol Lihat Demo (dihapus otomatis); null = perusahaan biasa */
  demo?: { expiresAt: string } | null;
  /** Perusahaan sudah membuat anggaran (menu Anggaran vs realisasi tampil) */
  hasBudget?: boolean;
  /** Standar pelaporan: SAK EMKM tidak mengenal penurunan nilai persediaan dan pengakuan pendapatan berdasarkan persentase penyelesaian */
  framework: ReportingFramework;
  emailVerified: boolean;
  /** Server mewajibkan verifikasi email sebelum mengubah data */
  verificationRequired: boolean;
  /** Pemilik layanan SANSU (akses panel admin) */
  isPlatformAdmin: boolean;
  subscription: SubscriptionState;
  /** Gudang yang boleh diakses; null = semua */
  warehouseIds: string[] | null;
  branchIds?: string[] | null;
  /** Verifikasi 2 langkah: aktif di akun ini / diwajibkan perusahaan */
  twoFactor: { enabled: boolean; required: boolean };
}

export type TwoFactorRequirement = 'NONE' | 'ADMINS' | 'ALL';
export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesLeft: number;
  required: boolean;
}
/** Jawaban login: token langsung, atau perlu kode verifikasi 2 langkah */
export type LoginResponse =
  | { accessToken: string; twoFactorRequired?: undefined }
  | { twoFactorRequired: true; challenge: string; accessToken?: undefined };

// ---------- Langganan SANSU ----------
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'OVERDUE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIAL: 'Uji coba',
  ACTIVE: 'Aktif',
  OVERDUE: 'Masa tenggang',
  EXPIRED: 'Kedaluwarsa',
  SUSPENDED: 'Ditangguhkan',
  CANCELLED: 'Dihentikan',
};
export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  maxUsers: number | null;
  maxWarehouses: number | null;
  isActive: boolean;
  sortOrder: number;
}
export interface SubscriptionState {
  /** false = fitur langganan dimatikan (tahap uji): tanpa trial, batas paket, atau mode baca saja */
  enabled?: boolean;
  status: SubscriptionStatus;
  readOnly: boolean;
  plan: Pick<Plan, 'id' | 'code' | 'name' | 'maxUsers' | 'maxWarehouses' | 'priceMonthly' | 'priceYearly'> | null;
  cycle: 'MONTHLY' | 'YEARLY';
  endsAt: string | null;
  daysLeft: number | null;
  graceUntil: string | null;
}
export type BillingInvoiceStatus = 'UNPAID' | 'WAITING' | 'PAID' | 'CANCELLED';
export const BILLING_STATUS_LABELS: Record<BillingInvoiceStatus, string> = {
  UNPAID: 'Belum dibayar',
  WAITING: 'Menunggu konfirmasi',
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
};
export interface BillingInvoice {
  id: string;
  number: string;
  planId: string;
  planName: string;
  cycle: 'MONTHLY' | 'YEARLY';
  /** DPP (sebelum PPN) */
  subtotal: string;
  /** Tarif PPN (%) — null bila tidak dikenai PPN */
  vatRate: string | null;
  vatAmount: string;
  /** Total tagihan (DPP + PPN) */
  amount: string;
  status: BillingInvoiceStatus;
  method: 'MANUAL' | 'MIDTRANS' | 'XENDIT';
  dueDate: string;
  hasProof: boolean;
  proofNote: string | null;
  rejectReason: string | null;
  gatewayUrl: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}
export interface BillingOverview {
  subscription: SubscriptionState;
  usage: { users: number; warehouses: number };
  plans: Plan[];
  invoices: BillingInvoice[];
  payment: {
    gateway: 'MIDTRANS' | 'XENDIT' | null;
    bank: { name: string; account: string; holder: string } | null;
    supportWhatsapp: string;
  };
}

/** Dokumen invoice langganan (cetak) */
export interface BillingInvoiceDoc extends Omit<BillingInvoice, 'hasProof'> {
  seller: {
    name: string;
    npwp: string;
    address: string;
    bank: { name: string; account: string; holder: string } | null;
  };
  buyer: { name: string; npwp: string | null; address: string | null };
}
export interface VatReportRow {
  id: string;
  number: string;
  paidAt: string;
  buyer: string;
  buyerNpwp: string | null;
  buyerAddress: string | null;
  plan: string;
  cycle: 'MONTHLY' | 'YEARLY';
  subtotal: string;
  vatRate: string | null;
  vatAmount: string;
  amount: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
  /** MAIN = gudang biasa; CONSIGNMENT = titipan di outlet; VAN = stok mobil sales kanvas */
  kind?: 'MAIN' | 'CONSIGNMENT' | 'VAN';
  vanUserId?: string | null;
}

export interface ProductUom {
  id: string;
  uom: string;
  factor: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  baseUom: string;
  sellPrice: string;
  barcode: string | null;
  /** GENERATED = dibuat sistem (tetap); MANUFACTURER = barcode pabrikan hasil scan */
  barcodeSource?: 'GENERATED' | 'MANUFACTURER' | null;
  /** SEMI = barang setengah jadi (akun persediaan tersendiri) */
  inventoryKind?: 'GOODS' | 'SEMI';
  /** Menu dibuat saat dipesan: kasir memotong bahan sesuai resep (stok = porsi yang bisa dibuat) */
  madeToOrder?: boolean;
  /** Umur simpan (hari) untuk hasil produksi; kosong = kedaluwarsa tidak dipantau */
  shelfLifeDays?: number | null;
  /** Peran dalam produksi (otomatis dari resep): bahan baku, setengah jadi, produk jadi, atau barang dagang */
  role?: 'RAW' | 'SEMI' | 'FINISHED' | 'TRADING';
  isActive: boolean;
  uoms: ProductUom[];
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  /** Alamat email untuk pengingat tagihan otomatis */
  email?: string | null;
  address: string | null;
  creditLimit: string;
  paymentTermDays: number;
  isActive: boolean;
  /** Daftar harga pelanggan (segmen); kosong = harga jual master */
  priceListId?: string | null;
  requirePo?: boolean;
  geoLat?: string | null;
  geoLng?: string | null;
  outstanding?: string;
}

export type ReminderLevel = 'error' | 'warning' | 'info';
export interface ReminderItem {
  key: string;
  category: 'PIUTANG' | 'UTANG' | 'STOK' | 'PEMBELIAN' | 'PENJUALAN' | 'PAJAK' | 'PERSETUJUAN' | 'SDM' | 'LANGGANAN';
  level: ReminderLevel;
  title: string;
  detail: string;
  link: string;
  count?: number;
  snoozedUntil?: string;
}
export interface RemindersResponse {
  items: ReminderItem[];
  snoozed?: ReminderItem[];
  snoozedCount: number;
  counts: Record<ReminderLevel, number>;
}
export interface ReminderSettings {
  enabled: boolean;
  arLeadDays: number;
  apLeadDays: number;
  grniDays: number;
  poDays: number;
  deliveryDays: number;
  taxLeadDays: number;
  payrollDay: number;
  emailDigest: boolean;
  customerReminders: boolean;
  customerLeadDays: number;
  customerRepeatDays: number;
  customerMaxOverdue: number;
}

export interface StockBalance {
  productId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  baseUom: string;
  warehouseCode: string;
  qty: string;
  avgCost: string;
  value: string;
}

export interface StockMove {
  id: string;
  date: string;
  type: StockMoveType;
  qty: string;
  unitCost: string;
  balanceAfter: string;
  refNumber: string | null;
  product: { sku: string; name: string };
  warehouse: { code: string };
}

export interface SalesOrderLine {
  id: string;
  productId: string;
  uom: string;
  priceForeign?: string | null;
  qty: string;
  /** Sudah dikirim (pengiriman bertahap) */
  deliveredQty?: string;
  price: string;
  discountPct: string;
  lineTotal: string;
  /** Harga termasuk PPN seperti diinput (dokumen harga termasuk PPN) */
  priceInclVat?: string | null;
  product: { sku: string; name: string; baseUom: string };
}

export interface SalesOrder {
  /** Mata uang dokumen (ISO); kosong/IDR = Rupiah. Nilai rupiah lain memakai kurs `fxRate` */
  currency?: string;
  fxRate?: string;
  totalForeign?: string | null;
  id: string;
  number: string;
  date: string;
  status: SalesOrderStatus;
  subtotal: string;
  taxAmount: string;
  total: string;
  /** Harga diinput termasuk PPN; baris disimpan sebagai DPP */
  pricesIncludeVat?: boolean;
  notes: string | null;
  customer: { id?: string; code: string; name: string };
  warehouse?: { id: string; code: string; name: string };
  lines?: SalesOrderLine[];
  invoice: { id: string; number: string } | null;
  /** Pengiriman buta aktif untuk Gudang: jumlah pesanan disembunyikan */
  blindDelivery?: boolean;
}

export interface Invoice {
  returnedForeign?: string;
  /** Mata uang dokumen (ISO); kosong/IDR = Rupiah. Nilai rupiah lain memakai kurs `fxRate` */
  currency?: string;
  fxRate?: string;
  totalForeign?: string | null;
  paidForeign?: string;
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: InvoiceStatus;
  /** Faktur saldo awal dari sistem lama (impor) — tanpa rincian barang & PPN */
  isOpening?: boolean;
  subtotal: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  returnedAmount: string;
  cogsAmount: string;
  /** GOODS = dari sales order (barang) · SERVICE = faktur jasa */
  kind?: InvoiceKind;
  description?: string | null;
  projectId?: string | null;
  termLabel?: string | null;
  /** PPh yang dipotong pelanggan (sudah termasuk di paidAmount) */
  withholdingType?: CustomerWithholdingType | null;
  withholdingRate?: string | null;
  withholdingBase?: string;
  withholdingAmount?: string;
  withholdingSlipNo?: string | null;
  withholdingSlipDate?: string | null;
  /** Uang muka pelanggan yang dipakai (sudah termasuk di paidAmount) */
  depositApplied?: string;
  customer: { code: string; name: string };
}

export interface ServiceInvoiceLine {
  id: string;
  description: string;
  qty: string;
  unit: string;
  price: string;
  lineTotal: string;
  accountId: string;
  account?: { code: string; name: string };
}

export interface InvoiceDetail extends Invoice {
  serviceLines?: ServiceInvoiceLine[];
  project?: { id: string; code: string; name: string } | null;
  lines: {
    id: string;
    productId: string;
    uom: string;
    qty: string;
    price: string;
    discountPct: string;
    lineTotal: string;
    returnedQty: string;
    priceForeign?: string | null;
    product: { sku: string; name: string };
  }[];
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isPostable: boolean;
  systemKey: string | null;
  isCashAccount: boolean;
  reportGroup: ReportGroup | null;
  fiscalTreatment: FiscalTreatment;
  description: string | null;
  isActive: boolean;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  description: string;
  sourceType: JournalSource;
  reference: string | null;
  reversalOfId: string | null;
  /** Halaman dokumen asal jurnal (faktur, surat jalan, dst.); null bila tidak ada */
  docRoute?: string | null;
  /** Tanggal jurnal balik otomatis yang masih menunggu (akrual); null bila tidak dijadwalkan */
  scheduledReversal?: string | null;
  lines: { id: string; debit: string; credit: string; account: { code: string; name: string } }[];
}

export interface BalanceRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
  balance: string;
}

/** Angka yang tidak boleh dilihat peran pembaca dikirim null (bukan 0, agar tidak terbaca sebagai nilai nol) */
export interface Dashboard {
  salesMonth: string | null;
  grossProfitMonth: string | null;
  grossMarginPct: string | null;
  invoicesMonth: number | null;
  arOutstanding: string | null;
  arOverdue: string | null;
  overdueCount: number | null;
  stockValue: string | null;
  apOutstanding: string | null;
  cashBalance: string | null;
  ordersPending: number | null;
  recentInvoices: (Invoice & { customer: { name: string } })[];
}

// ---------- Pembelian ----------
export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  npwp: string | null;
  paymentTermDays: number;
  isActive: boolean;
  /** Supplier favorit: persetujuan otomatis sampai `autoApproveLimit` */
  isPreferred?: boolean;
  autoApproveLimit?: string;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  outstanding?: string;
}

export interface DocLine {
  id: string;
  productId: string;
  uom: string;
  qty: string;
  price: string;
  discountPct: string;
  lineTotal: string;
  /** Dokumen valas: harga per satuan dalam mata uang dokumen */
  priceForeign?: string | null;
  product: { sku: string; name: string; baseUom?: string };
}

export interface PurchaseOrder {
  /** Mata uang dokumen (ISO); kosong/IDR = Rupiah. Nilai rupiah lain memakai kurs `fxRate` */
  currency?: string;
  fxRate?: string;
  totalForeign?: string | null;
  id: string;
  number: string;
  date: string;
  status: PurchaseOrderStatus;
  subtotal: string;
  taxAmount: string;
  total: string;
  /** Harga dari penawaran supplier (pembelian cepat); final mengikuti faktur */
  priceEstimate?: boolean;
  notes: string | null;
  supplier: {
    id?: string;
    code: string;
    name: string;
    address?: string | null;
    phone?: string | null;
    npwp?: string | null;
  };
  warehouse?: { id: string; code: string; name: string; address?: string | null };
  lines?: (DocLine & { receivedQty?: string; billedQty?: string })[];
  /** Faktur pertama (tampilan lama); semua faktur bertahap ada di `invoices` */
  invoice: { id: string; number: string } | null;
  invoices?: { id: string; number: string; supplierInvoiceNo: string; date: string; total: string; status: InvoiceStatus }[];
  receipts?: { id: string; number: string; date: string; status: 'RECEIVED' | 'CANCELLED'; value: string; supplierDeliveryNo: string | null; autoInvoiceId: string | null }[];
  /** Kemajuan penerimaan barang dan penagihan: NONE / PARTIAL / FULL */
  /** Penerimaan buta aktif untuk Gudang: jumlah pesanan disembunyikan */
  blindReceiving?: boolean;
  receiptStatus?: 'NONE' | 'PARTIAL' | 'FULL';
  billingStatus?: 'NONE' | 'PARTIAL' | 'FULL';
}

export interface GoodsReceipt {
  id: string;
  number: string;
  date: string;
  status: 'RECEIVED' | 'CANCELLED';
  value: string;
  vatCapitalized: boolean;
  supplierDeliveryNo: string | null;
  autoInvoiceId: string | null;
  notes: string | null;
  supplier: { id?: string; code: string; name: string; address?: string | null; phone?: string | null };
  order: { id?: string; number: string };
  warehouse?: { id?: string; name: string };
  lines?: { id: string; orderLineId: string; qty: string; uom: string; unitCost: string; value: string; billedQty: string; billedValue: string; product: { sku: string; name: string } }[];
}

export interface PurchaseInvoice {
  returnedForeign?: string;
  /** Mata uang dokumen (ISO); kosong/IDR = Rupiah. Nilai rupiah lain memakai kurs `fxRate` */
  currency?: string;
  fxRate?: string;
  totalForeign?: string | null;
  paidForeign?: string;
  id: string;
  number: string;
  supplierInvoiceNo: string;
  date: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotal: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  returnedAmount: string;
  /** GOODS = barang dagang dari PO; BILL = tagihan biaya / aset; OPENING = utang saldo awal (impor) */
  kind?: 'GOODS' | 'BILL' | 'OPENING';
  description?: string | null;
  withholdingType?: 'PPH23' | 'PPH4_2' | null;
  withholdingAmount?: string;
  /** Selisih DPP faktur terhadap harga PO (+ faktur lebih mahal) */
  priceVariance?: string;
  /** PPN tidak dapat dikreditkan (perusahaan non-PKP) → masuk harga perolehan */
  vatCapitalized?: boolean;
  supplier: { code: string; name: string };
}

export interface PurchaseInvoiceDetail extends PurchaseInvoice {
  lines: (DocLine & {
    returnedQty: string;
    lineType?: 'PRODUCT' | 'EXPENSE' | 'ASSET';
    description?: string | null;
    account?: { code: string; name: string } | null;
    assetCategory?: { name: string } | null;
    asset?: { id: string; code: string; name: string } | null;
  })[];
}

// ---------- Kas & bank ----------
export interface CashAccount {
  id: string;
  code: string;
  name: string;
  balance: string;
}

export interface CashTransaction {
  id: string;
  number: string;
  date: string;
  type: CashTxType;
  amount: string;
  description: string;
  reference: string | null;
  /** POSTED | VOID (dibatalkan dengan jurnal pembalik) */
  status?: 'POSTED' | 'VOID';
  voidReason?: string | null;
  voidedAt?: string | null;
  cashAccount: { code: string; name: string };
  toCashAccount: { code: string; name: string } | null;
  lines: { id: string; amount: string; memo: string | null; account: { code: string; name: string } }[];
  journalNumber?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  /** Kartu aset tetap yang lahir dari transaksi ini (pembelian tunai aset) */
  assets?: { id: string; code: string; name: string }[];
}

// ---------- Retur ----------
export interface ReturnDoc {
  id: string;
  number: string;
  date: string;
  reason: string | null;
  subtotal: string;
  taxAmount: string;
  total: string;
  invoice: { number: string; supplierInvoiceNo?: string };
  customer?: { code: string; name: string };
  supplier?: { code: string; name: string };
  lines: { id: string; uom: string; qty: string; lineTotal: string; product: { sku: string; name: string } }[];
}

// ---------- Laporan ----------
export interface LedgerReport {
  account: { id: string; code: string; name: string; type: AccountType };
  opening: string;
  closing: string;
  totalDebit: string;
  totalCredit: string;
  /** true = baris dipotong batas tampilan; total & saldo akhir tetap lengkap */
  truncated?: boolean;
  totalRows?: number;
  rows: {
    journalId: string;
    number: string;
    date: string;
    description: string;
    sourceType: JournalSource;
    docRoute?: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

export interface CashFlowSection {
  items: { label: string; amount: string }[];
  total: string;
}

export interface CashFlowReport {
  opening: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: string;
  closing: string;
}

export interface VatReport {
  vatOut: string;
  vatIn: string;
  net: string;
  status: 'KURANG_BAYAR' | 'LEBIH_BAYAR' | 'NIHIL';
  documents: {
    kind: string;
    number: string;
    ref: string | null;
    date: string;
    party: string;
    npwp: string | null;
    dpp: string;
    ppn: string;
  }[];
}

export interface PeriodStatus {
  lockedUntil: string | null;
  closings: { year: string; number: string; date: string }[];
}

export interface AgingRow {
  total: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  customer?: { id: string; code: string; name: string };
  supplier?: { id: string; code: string; name: string };
}

// ---------- Platform ----------
export interface PayrollSettings {
  /** 5 = Senin–Jumat, 6 = Senin–Sabtu */
  workDaysPerWeek: 5 | 6;
  /** Batas upah iuran BPJS Kesehatan */
  bpjsKesCap: number;
  /** Batas upah iuran Jaminan Pensiun (berubah tiap tahun) */
  jpCap: number;
  /** Tarif JKK (%) sesuai kelompok risiko */
  jkkRate: number;
  /** Tarif JKM (%) */
  jkmRate: number;
  /** Pembagi upah per jam lembur (UU: 1/173) */
  overtimeDivisor: number;
}

export interface ReportingSettings {
  framework: ReportingFramework;
  legalForm: string;
  businessActivity: string;
  establishedYear: number | null;
  city: string;
  directorName: string;
  directorTitle: string;
  taxScheme: 'GENERAL' | 'FINAL_UMKM';
  /** Tahun mulai terdaftar sebagai WP (untuk batas waktu PPh final) */
  taxRegisteredYear: number | null;
  /**
   * Batas kapitalisasi aset tetap (Rp per unit). Pengeluaran per unit di bawah batas langsung dibebankan,
   * bukan dicatat sebagai aset. 0 = semua pembelian aset dikapitalisasi.
   */
  capitalizationThreshold: number;
}

/**
 * Profil PPN perusahaan.
 *  - pkp=false (belum Pengusaha Kena Pajak): tidak memungut PPN keluaran; PPN dari supplier
 *    tidak bisa dikreditkan sehingga menjadi bagian harga perolehan barang/biaya/aset.
 *  - posPricesIncludeVat: harga jual di kasir sudah termasuk PPN (harga rak); DPP & PPN dihitung mundur.
 */
export interface TaxProfile {
  pkp: boolean;
  posPricesIncludeVat: boolean;
  /** Bawaan isian "harga termasuk PPN" di penawaran & pesanan penjualan */
  salesPricesIncludeVat: boolean;
  /** Hari libur nasional dan cuti bersama (YYYY-MM-DD) yang menggeser tenggat pajak ke hari kerja berikutnya; diisi pengguna tiap tahun */
  holidays?: string[];
  /** Pembulatan PPN dokumen ke rupiah penuh: NONE = dua desimal apa adanya, DOWN = ke bawah, NEAREST = ke terdekat */
  vatRounding?: VatRounding;
  /**
   * Pajak restoran daerah (PB1 / PBJT makanan dan minuman): bila aktif, penjualan kasir dikenai pajak daerah ini (bukan PPN) dan
   * dicatat di akun Utang Pajak Restoran. Tarif ditetapkan peraturan daerah (maksimal 10%).
   */
  localTaxEnabled?: boolean;
  localTaxRate?: string;
}
export const VAT_ROUNDINGS = ['NONE', 'DOWN', 'NEAREST'] as const;
export type VatRounding = (typeof VAT_ROUNDINGS)[number];

export interface CompanySettings {
  name: string;
  npwp: string | null;
  address: string | null;
  ppnRate: string;
  taxProfile: TaxProfile;
  payroll: PayrollSettings;
  reporting: ReportingSettings;
}

export interface AppItem {
  key: string;
  name: string;
  category: string;
  description: string;
  color: string;
  core?: boolean;
  depends?: string[];
  roles: string[];
  home: string;
  enabled: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  /** Gudang yang boleh diakses; null = semua */
  warehouseIds: string[] | null;
  branchIds?: string[] | null;
  /** Verifikasi 2 langkah aktif */
  twoFactor: boolean;
  createdAt: string;
  customRoleId?: string | null;
  customRoleName?: string | null;
}

/** Peran khusus: peran dasar dikurangi hak tulis yang dicabut (hanya mempersempit; dikelola Pemilik) */
export interface CustomRole {
  id: string;
  name: string;
  baseRole: Role;
  denied: string[];
  users: number;
  createdAt: string;
}
export interface RolePermissionItem {
  key: string;
  group: string;
  label: string;
}

// ---------- POS ----------
export interface PosProduct extends Product {
  stock: string;
}

export interface PosSession {
  id: string;
  number: string;
  status: PosSessionStatus;
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
  notes: string | null;
  warehouse: { id?: string; code?: string; name: string };
  cashAccount?: { id: string; code: string; name: string };
  bankAccount?: { id: string; code: string; name: string };
  user?: { name: string };
  orderCount?: number;
  totalSales?: string;
  summary?: PosSessionSummary;
}

export interface PosSessionSummary {
  orderCount: number;
  totalSales: string;
  byMethod: Record<PosPaymentMethod, string>;
  expectedCash: string;
}

// ---------- Meja, pesanan terbuka, dapur ----------
export type PosTabStatus = 'OPEN' | 'PAID' | 'CANCELLED';
/** DRAFT belum dikirim · NEW antre di dapur · PREPARING dimasak · READY siap diantar · SERVED disajikan · VOID dibatalkan */
export type PosTabLineStatus = 'DRAFT' | 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'VOID';
export interface PosTableRow {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  code: string;
  name: string;
  seats: number | null;
  isActive: boolean;
  openTab: { id: string; number: string; since: string; items: number; amount: string } | null;
}
export interface PosTabLine {
  id: string;
  productId: string;
  qty: string;
  notes: string | null;
  status: PosTabLineStatus;
  sentAt: string | null;
  paidOrderId: string | null;
  voidReason: string | null;
  voidFromStatus: string | null;
  product: { sku: string; name: string; sellPrice: string; madeToOrder: boolean; baseUom: string };
}
export interface PosTabDetail {
  id: string;
  number: string;
  status: PosTabStatus;
  warehouseId: string;
  tableId: string | null;
  tableLabel: string | null;
  /** Pesanan online: kanal dan nomor pesanan di platform */
  channel: OnlineChannel | null;
  externalRef: string | null;
  orderType: PosOrderType;
  guestName: string | null;
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
  cancelReason: string | null;
  lines: PosTabLine[];
  /** Perkiraan sebelum pajak; nilai pasti dihitung saat dibayar */
  unpaidSubtotal: string;
  paidSubtotal: string;
  draftCount: number;
  warehouse?: { code: string; name: string };
}
export interface PosTabSummary {
  id: string;
  number: string;
  status: PosTabStatus;
  warehouseId: string;
  tableLabel: string | null;
  channel?: OnlineChannel | null;
  orderType: PosOrderType;
  guestName: string | null;
  createdAt: string;
  items: number;
  unpaidSubtotal: string;
  pending: number;
}
export interface KitchenTicket {
  tabId: string;
  number: string;
  tableLabel: string | null;
  channel: OnlineChannel | null;
  orderType: PosOrderType;
  guestName: string | null;
  since: string;
  waitingMinutes: number;
  items: { id: string; product: string; sku: string; qty: string; notes: string | null; status: PosTabLineStatus; paid: boolean }[];
}
/** Pesanan online yang sudah dibayar platform tetapi dananya belum dicairkan */
export interface UnsettledOnlineOrder {
  id: string;
  number: string;
  date: string;
  channel: OnlineChannel;
  externalRef: string | null;
  total: string;
  platformFee: string;
  net: string;
}
export interface PlatformSettlement {
  id: string;
  number: string;
  channel: OnlineChannel;
  date: string;
  orderCount: number;
  expected: string;
  received: string;
  difference: string;
  notes: string | null;
  status: 'POSTED' | 'CANCELLED';
}
export interface OnlineApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  warehouseId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface KitchenBoard {
  tickets: KitchenTicket[];
  summary: { NEW: number; PREPARING: number; READY: number };
}

/** Status lot menurut sisa hari sampai kedaluwarsa */
export type StockLotStatus = 'EXPIRED' | 'SOON' | 'WARNING' | 'OK' | 'NO_EXPIRY';
export interface StockLotRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  baseUom: string;
  warehouseId: string;
  warehouseCode: string;
  lotNo: string | null;
  expiryDate: string | null;
  receivedDate: string;
  qtyRemaining: string;
  daysLeft: number | null;
  status: StockLotStatus;
  /** Perkiraan nilai sisa lot (sisa × biaya rata-rata saat ini) */
  value: string;
}
export interface StockLotList {
  today: string;
  soonDays: number;
  warningDays: number;
  summary: { expired: number; expiredValue: string; soon: number; soonValue: string; warning: number; tracked: number };
  items: StockLotRow[];
}

export interface PosOrder {
  id: string;
  number: string;
  date: string;
  createdAt: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  tendered: string;
  change: string;
  /** Harga di struk sudah termasuk PPN */
  pricesIncludeVat?: boolean;
  /** Jenis pesanan dan label meja/pemesan (opsional) */
  orderType?: PosOrderType | null;
  tableLabel?: string | null;
  /** VAT = pajak di struk adalah PPN; LOCAL = pajak restoran daerah (PB1/PBJT) */
  taxKind?: 'VAT' | 'LOCAL';
  customer: { code?: string; name: string } | null;
  payments: { id: string; method: PosPaymentMethod; amount: string }[];
  lines?: {
    id: string;
    uom: string;
    qty: string;
    price: string;
    discountPct: string;
    lineTotal: string;
    /** Sudah diretur (satuan baris) */
    returnedQty?: string;
    product: { sku: string; name: string };
  }[];
  session?: { number: string; user: { name: string }; warehouse: { name: string; address: string | null } };
}

// ---------- CRM ----------
export interface CrmStage {
  id: string;
  name: string;
  sequence: number;
  probability: number;
}

export interface CrmActivity {
  id: string;
  leadId: string;
  type: ActivityType;
  summary: string;
  dueDate: string;
  done: boolean;
  result: string | null;
  user?: { name: string } | null;
  lead?: { id: string; title: string; contactName: string | null; phone: string | null };
}

export interface Lead {
  id: string;
  title: string;
  customerId: string | null;
  contactName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  expectedRevenue: string;
  probability: number;
  stageId: string;
  ownerId: string | null;
  status: LeadStatus;
  lostReason: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
  createdAt: string;
  customer?: { id?: string; code: string; name: string } | null;
  owner?: { id?: string; name: string } | null;
  stage?: { name: string } | CrmStage;
  activities?: CrmActivity[];
  quotations?: { id: string; number: string; date: string; status: QuotationStatus; total: string }[];
}

export interface Quotation {
  id: string;
  number: string;
  date: string;
  validUntil: string;
  status: QuotationStatus;
  subtotal: string;
  taxAmount: string;
  total: string;
  pricesIncludeVat?: boolean;
  notes: string | null;
  terms: string | null;
  customerId: string;
  warehouseId: string;
  leadId: string | null;
  customer: {
    id?: string;
    code: string;
    name: string;
    address?: string | null;
    phone?: string | null;
    npwp?: string | null;
  };
  salesOrder: { id: string; number: string } | null;
  lead?: { id: string; title: string } | null;
  warehouse?: { id: string; name: string };
  lines?: (DocLine & { priceInclVat?: string | null })[];
  company?: { name: string; address: string | null; npwp: string | null };
}

// ---------- SDM ----------
export interface Employee {
  id: string;
  /** Cabang tempat karyawan bekerja (gaji dibebankan ke cabang ini); kosong = Pusat */
  branchId?: string | null;
  code: string;
  name: string;
  /** Tenaga kerja langsung produksi */
  isProduction?: boolean;
  /** Proyek tempat karyawan ditempatkan (gaji = biaya langsung proyek) */
  projectId?: string | null;
  nik: string | null;
  npwp: string | null;
  ptkp: string;
  jobTitle: string | null;
  department: string | null;
  joinDate: string;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  baseSalary: string;
  fixedAllowance: string;
  dailyAllowance: string;
  bpjsKes: boolean;
  bpjsTk: boolean;
  bpjsJp: boolean;
  annualLeave: number;
  isActive: boolean;
  resignDate: string | null;
  /** Usaha jasa: TETAP · KONTRAK · HARIAN · TENAGA_LEPAS · MAGANG · MITRA */
  employmentType?: 'TETAP' | 'KONTRAK' | 'HARIAN' | 'TENAGA_LEPAS' | 'MAGANG' | 'MITRA';
  contractStart?: string | null;
  contractEnd?: string | null;
  dailyWage?: string;
  /** Usaha jasa: karyawan baru ikut penggajian setelah diverifikasi orang lain */
  verified?: boolean;
  /** Ada bila perubahan data sensitif menunggu persetujuan (respons simpan) */
  pendingChange?: { id: string; fields: string[] } | null;
  leave?: { year: number; quota: number; used: number; remaining: number };
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  overtimeHours: string;
  notes: string | null;
}

export interface AttendanceDay {
  date: string;
  isWorkDay: boolean;
  rows: {
    employee: { id: string; code: string; name: string; jobTitle: string | null };
    record: AttendanceRecord | null;
  }[];
}

export interface AttendanceMonth {
  period: string;
  workDays: number;
  rows: {
    employee: { id: string; code: string; name: string };
    counts: Record<AttendanceStatus, number>;
    overtimeHours: number;
    recorded: number;
  }[];
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
  employee: { id: string; code: string; name: string };
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  workDays: number;
  presentDays: number;
  absentDays: number;
  overtimeHours: string;
  baseSalary: string;
  fixedAllowance: string;
  dailyAllowance: string;
  overtimePay: string;
  otherIncome: string;
  /** Upah jasa (jam, sesi, borongan, komisi faktur) dari catatan kerja yang disetujui — khusus usaha jasa */
  serviceIncome: string;
  absenceDeduction: string;
  grossPay: string;
  bpjsKesEmployee: string;
  jhtEmployee: string;
  jpEmployee: string;
  bpjsKesCompany: string;
  jhtCompany: string;
  jpCompany: string;
  jkkCompany: string;
  jkmCompany: string;
  taxableGross: string;
  terCategory: string;
  terRate: string;
  pph21: string;
  otherDeduction: string;
  netPay: string;
  notes: string | null;
  employee: Partial<Employee> & { id: string; code: string; name: string };
  run?: PayrollRun;
  company?: { name: string; address: string | null; npwp: string | null };
}

export interface PayrollRun {
  id: string;
  number: string;
  period: string;
  payDate: string;
  status: PayrollStatus;
  totalGross: string;
  totalEmployerCost: string;
  totalPph21: string;
  totalNet: string;
  payslips?: Payslip[];
  cashAccount?: { code: string; name: string } | null;
}

// ---------- Laporan keuangan SAK EP / EMKM ----------
export interface AccountAmount {
  id: string;
  code: string;
  name: string;
  amount: string;
  compare: string;
}
export interface StatementLine {
  key: string;
  label: string;
  kind: 'group' | 'subtotal' | 'total';
  /** Untuk subtotal/total: key baris-baris yang dijumlahkan */
  parts?: string[];
  amount: string;
  compare: string;
  accounts?: AccountAmount[];
}
export interface FinancialPosition {
  asOf: string;
  compareAsOf: string;
  sections: { key: string; label: string; lines: StatementLine[]; total: string; compareTotal: string }[];
  totals: Record<'assets' | 'liabilities' | 'equity' | 'liabilitiesEquity', { amount: string; compare: string }>;
  balanced: boolean;
}
export interface IncomeStatement {
  framework: ReportingFramework;
  period: { from: string; to: string };
  comparePeriod: { from: string; to: string };
  lines: StatementLine[];
  netProfit: string;
  compareNetProfit: string;
}
export interface EquityStatementPart {
  period: { from: string; to: string };
  rows: { key: string; label: string; kind: 'balance' | 'movement'; values: Record<string, string> }[];
}
export interface EquityStatement {
  period: { from: string; to: string };
  comparePeriod: { from: string; to: string };
  columns: { key: string; label: string }[];
  current: EquityStatementPart;
  previous: EquityStatementPart;
}
export interface CashFlowPart {
  opening: string;
  operating: { items: { label: string; amount: string }[]; total: string };
  investing: { items: { label: string; amount: string }[]; total: string };
  financing: { items: { label: string; amount: string }[]; total: string };
  netChange: string;
  closing: string;
  actualClosing: string;
  difference: string;
}
export interface CashFlowStatement {
  method: 'indirect' | 'direct';
  period: { from: string; to: string };
  comparePeriod: { from: string; to: string };
  current: CashFlowPart;
  previous: CashFlowPart;
}
type DC = { debit: string; credit: string };
export interface FullTrialBalance {
  period: { from: string; to: string };
  rows: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    reportGroup: string;
    opening: DC;
    movement: DC;
    closing: DC;
  }[];
  totals: { opening: DC; movement: DC; closing: DC };
  balanced: boolean;
}
export interface Worksheet {
  period: { from: string; to: string };
  rows: {
    id: string;
    code: string;
    name: string;
    isPL?: boolean;
    trial: DC;
    adjustment: DC;
    adjusted: DC;
    incomeStatement: DC;
    balanceSheet: DC;
  }[];
  totals: { trial: DC; adjustment: DC; adjusted: DC; incomeStatement: DC; balanceSheet: DC };
  netProfit: string;
  balanced: boolean;
}

export interface NoteTable {
  title?: string;
  columns: string[];
  align: ('left' | 'right')[];
  rows: (string | number | null)[][];
  total?: (string | number | null)[];
}
export interface NoteSection {
  key: string;
  number: string;
  title: string;
  paragraphs: string[];
  subsections?: { title: string; paragraphs: string[]; table?: NoteTable }[];
  tables: NoteTable[];
  groups?: string[];
  editable: boolean;
  edited: boolean;
}
export interface FinancialNotes {
  year: number;
  framework: ReportingFramework;
  company: {
    name: string;
    address: string | null;
    npwp: string | null;
    legalForm: string;
    city: string;
    directorName: string;
    directorTitle: string;
  };
  period: { from: string; to: string };
  sections: NoteSection[];
  refs: Record<string, string>;
}

/** Lampiran laporan keuangan: daftar rincian pendukung (umur piutang/utang, aset tetap, persediaan, neraca saldo) */
/** Laporan pendukung per bidang beserta pencocokan dengan buku besar */
export interface SupportReconciliation {
  key: string;
  title: string;
  left: { label: string; value: number };
  right: { label: string; value: number };
  diff: number;
  ok: boolean;
  note?: string;
}
export type SupportFindingLevel = 'ok' | 'info' | 'warning' | 'danger';
export interface SupportFinding {
  level: SupportFindingLevel;
  title: string;
  detail: string;
  /** Saran tindak lanjut */
  action?: string;
}
/** Kesimpulan otomatis dari angka yang tersaji pada laporan */
export interface SupportConclusion {
  status: SupportFindingLevel;
  summary: string;
  findings: SupportFinding[];
}
export interface SupportReport {
  kind: 'sales' | 'purchases' | 'inventory' | 'cash' | 'other' | 'pos' | 'fnb' | 'fmcg' | 'mfg' | 'jasa' | 'utility';
  title: string;
  summary: string;
  period: { from: string; to: string };
  generatedAt: string;
  reconciliation: SupportReconciliation[];
  conclusion: SupportConclusion;
  sections: { key: string; number: string; title: string; paragraphs: string[]; tables: NoteTable[] }[];
}

export interface FinancialAppendix {
  year: number;
  framework: ReportingFramework;
  company: { name: string; address: string | null; npwp: string | null; city: string; directorName: string; directorTitle: string };
  period: { from: string; to: string };
  sections: { key: string; number: string; title: string; paragraphs: string[]; tables: NoteTable[] }[];
}

export interface RecurringJournal {
  id: string;
  name: string;
  description: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  nextDate: string;
  endDate: string | null;
  remaining: number | null;
  isAdjustment: boolean;
  isActive: boolean;
  lines: { accountId: string; debit?: string; credit?: string; memo?: string; projectId?: string }[];
  lastRunAt: string | null;
}

// ---------- Aset tetap ----------
export interface AssetCategory {
  id: string;
  name: string;
  assetAccountId: string;
  accumulatedAccountId: string | null;
  expenseAccountId: string | null;
  method: string;
  usefulLifeMonths: number;
  fiscalGroup: string;
  fiscalMethod: string;
  assetAccount?: { id: string; code: string; name: string };
  accumulatedAccount?: { id: string; code: string; name: string } | null;
  expenseAccount?: { id: string; code: string; name: string } | null;
}
export interface FixedAsset {
  id: string;
  /** Cabang pemilik aset (penyusutan dibebankan ke cabang ini); kosong = Pusat */
  branchId?: string | null;
  code: string;
  name: string;
  categoryId: string;
  acquisitionDate: string;
  depreciationStart: string;
  cost: string;
  residualValue: string;
  usefulLifeMonths: number;
  method: string;
  /** Metode unit produksi: kapasitas total dan satuannya */
  totalUnits?: string | null;
  unitLabel?: string | null;
  openingAccumulated: string;
  location: string | null;
  /** Penanggung jawab aset */
  custodian?: string | null;
  /** Pemeriksaan fisik terakhir */
  lastVerifiedAt?: string | null;
  verificationStatus?: 'FOUND' | 'DAMAGED' | 'MISSING' | null;
  verificationNote?: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'DISPOSED';
  disposalDate: string | null;
  disposalPrice: string | null;
  category: { id: string; name: string; fiscalGroup?: string };
  accumulated?: string;
  bookValue?: string;
  lastDepreciation?: string | null;
  monthlyEstimate?: string;
  schedule?: { period: string; amount: string; accumulated: string; bookValue: string; posted: boolean }[];
}

// ---------- Kesehatan & fiskal ----------
export type HealthStatus = 'OK' | 'WARN' | 'ERROR' | 'INFO';
export interface HealthReport {
  asOf: string;
  score: number;
  grade: string;
  summary: { ok: number; warn: number; error: number };
  checks: {
    key: string;
    category: string;
    title: string;
    status: HealthStatus;
    message: string;
    detail?: { label: string; value: string }[];
    link?: string;
  }[];
  ratios: {
    key: string;
    group: string;
    label: string;
    value: number | null;
    unit: 'x' | '%' | 'hari';
    status: HealthStatus;
    explanation: string;
  }[];
}
export interface FiscalItem {
  source: 'ACCOUNT' | 'DEPRECIATION' | 'INVENTORY' | 'FINAL_COST' | 'MANUAL';
  id?: string;
  label: string;
  amount: string;
}
export interface FiscalReconciliation {
  year: number;
  scheme: 'GENERAL' | 'FINAL_UMKM';
  framework: ReportingFramework;
  legalForm: string;
  profitBeforeTax: string;
  positive: FiscalItem[];
  negative: FiscalItem[];
  totalPositive: string;
  totalNegative: string;
  fiscalProfit: string;
  lossCarryforward: string;
  pkp: string;
  grossRevenue: string;
  grossRevenueAuto: string;
  grossRevenueOverridden: boolean;
  /** Biaya untuk memperoleh penghasilan PPh final (tidak dapat dikurangkan) */
  finalCost: {
    finalRevenue: string;
    totalRevenue: string;
    ratio: number;
    direct: string;
    common: string;
    auto: string;
    override: string | null;
    applied: string;
  } | null;
  facilitatedPkp: string;
  method: string;
  taxDue: string;
  credits: string;
  pph29: string;
  /** PPh 21/22/23/24 yang dipotong pihak lain pada tahun itu (pengurang dasar angsuran PPh 25) */
  withheldCredits: string;
  installment25: string;
  deferred: { temporaryDifference: string; target: string; current: string; adjustment: string } | null;
  depreciation: {
    id: string;
    code: string;
    name: string;
    category: string;
    fiscalGroup: string;
    cost: string;
    commercial: string;
    fiscal: string;
    difference: string;
    commercialBookValue: string;
    fiscalBookValue: string;
  }[];
  warnings: string[];
  journal: { id: string; number: string; date: string } | null;
}

// ---------- Rekonsiliasi bank ----------
export interface BankStatementSummary {
  id: string;
  cash_account_id: string;
  account_code: string;
  account_name: string;
  file_name: string | null;
  period_from: string;
  period_to: string;
  closing_balance: string | null;
  lines: number;
  matched: number;
  created_at: string;
}
export type BankLineStatus = 'UNMATCHED' | 'MATCHED' | 'CREATED' | 'IGNORED';
export interface BankStatementLine {
  id: string;
  seq: number;
  date: string;
  description: string;
  amount: string;
  balance: string | null;
  status: BankLineStatus;
  matchedBy: string | null;
  book: { journalId: string; number: string; date: string; description: string; sourceType: string } | null;
}
export interface BankStatement {
  id: string;
  fileName: string | null;
  periodFrom: string;
  periodTo: string;
  closingBalance: string | null;
  cashAccount: { id: string; code: string; name: string };
  lines: BankStatementLine[];
  summary: { totalIn: string; totalOut: string; counts: Record<BankLineStatus, number> };
}
export interface BankCandidate {
  id: string;
  date: string;
  number: string;
  description: string;
  reference: string | null;
  amount: string;
  same: boolean;
  gap: number;
}
export interface BankReconciliation {
  account: { id: string; code: string; name: string };
  asOf: string;
  bankBalance: string | null;
  bankBalanceDate: string | null;
  bookBalance: string;
  depositsInTransit: { date: string; number: string; description: string; amount: string }[];
  outstandingPayments: { date: string; number: string; description: string; amount: string }[];
  unrecorded: { id: string; date: string; description: string; amount: string }[];
  totals: { depositsInTransit: string; outstandingPayments: string; unrecorded: string };
  adjustedBank: string | null;
  adjustedBook: string;
  difference: string | null;
  reconciled: boolean;
}

// ---------- Setoran pajak ----------
export interface TaxObligation {
  type: TaxPaymentType;
  period: string;
  outstanding: string;
  paid: string;
  dueDate: string;
  status: 'NIHIL' | 'BELUM' | 'LUNAS' | 'TERLAMBAT' | 'LEBIH_BAYAR' | 'OPSIONAL';
  detail?: Record<string, string>;
  note?: string;
}
export interface TaxPayment {
  id: string;
  number: string;
  type: TaxPaymentType;
  period: string;
  date: string;
  amount: string;
  vatOut: string;
  vatIn: string;
  billingCode: string | null;
  ntpn: string | null;
  notes: string | null;
  journalId: string | null;
  cashAccount: { code: string; name: string } | null;
}

// ---------- Integrasi ----------
export interface IntegrationSettings {
  coretaxUnits: Record<string, string>;
  marketplaceCustomers: Record<string, string>;
}
export interface CoretaxPreview {
  from: string;
  to: string;
  sellerTin: string;
  ppnRate: string;
  count: number;
  invoices: {
    id: string;
    /** INVOICE = faktur penjualan · DEPOSIT = faktur pajak uang muka */
    kind?: 'INVOICE' | 'DEPOSIT';
    number: string;
    date: string;
    customer: string;
    npwp: string | null;
    buyerType: string;
    subtotal: string;
    taxAmount: string;
    /** DPP uang muka yang sudah dikurangkan (faktur pelunasan) */
    depositDpp?: string;
    total: string;
  }[];
  problems: string[];
  /** Peringatan yang tidak menghalangi ekspor */
  warnings?: string[];
  missingUnits: string[];
  units: string[];
}
export interface MarketplaceOrderRow {
  id: string;
  channel: string;
  orderNo: string;
  date: string;
  total: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  status: InvoiceStatus | null;
  paidAmount: string | null;
}

// ---------- Opname kas ----------
/** Pos rekonsiliasi: ADD = mengurangi kekurangan (mis. bon sementara belum dicatat), LESS = uang fisik yang bukan milik saldo buku (mis. titipan) */
export interface CashCountItem {
  type: 'ADD' | 'LESS';
  description: string;
  amount: string;
}
export interface CashCount {
  id: string;
  number: string;
  date: string;
  accountId: string;
  account: { code: string; name: string };
  status: CashCountStatus;
  /** Jumlah lembar/keping per pecahan */
  denominations: Partial<Record<CashDenominationKey, number>>;
  items: CashCountItem[];
  /** Saldo menurut pembukuan per tanggal opname (dihitung ulang saat diselesaikan) */
  bookBalance: string;
  countedTotal: string;
  itemsTotal: string;
  /** (fisik + pos rekonsiliasi) − saldo buku; negatif = kurang */
  difference: string;
  custodianName: string | null;
  notes: string | null;
  reason: string | null;
  rejectReason: string | null;
  journalNumber: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  createdAt: string;
}
export interface CashCountSettings {
  /** Selisih (absolut) di atas nilai ini butuh persetujuan Pemilik */
  approvalThreshold: number;
}

// ---------- Rekap pajak & BPJS ----------
export type TaxRecapStatus = 'NIHIL' | 'TEPAT' | 'TERLAMBAT' | 'KURANG' | 'KURANG_TERLAMBAT' | 'BELUM' | 'TERLAMBAT_BELUM' | 'LEBIH_BAYAR' | 'BELUM_MASA';
export interface TaxRecapCell {
  period: string;
  /** Terutang masa ini (PPN: keluaran − masukan − kompensasi) */
  payable: string;
  paid: string;
  diff: string;
  dueDate: string;
  paidDate: string | null;
  ntpn: string | null;
  status: TaxRecapStatus;
  detail?: Record<string, string>;
}
export interface AnnualTaxRecap {
  year: number;
  taxScheme: string;
  types: { type: TaxPaymentType; label: string; months: TaxRecapCell[]; total: { payable: string; paid: string; diff: string } }[];
  corporate: {
    profitBeforeTax: string;
    fiscalProfit: string;
    pkp: string;
    taxDue: string;
    credits: string;
    pph29: string;
    installment25Next: string;
    method: string;
    journalPosted: boolean;
    paid29: string;
    dueDate: string;
  } | null;
}
export interface WithholdingRow {
  id: string;
  number: string;
  supplierInvoiceNo: string;
  date: string;
  description: string | null;
  type: 'PPH23' | 'PPH4_2';
  base: string;
  rate: string | null;
  amount: string;
  supplierCode: string;
  supplierName: string;
  supplierNpwp: string | null;
  supplierAddress: string | null;
}
export interface WithholdingRecap {
  period: string;
  rows: WithholdingRow[];
  summary: { type: 'PPH23' | 'PPH4_2'; label: string; count: number; base: string; amount: string; ledger: string; unexplained: string; dueDate: string | null; reportDue: string | null }[];
  bySupplier: { supplierName: string; supplierNpwp: string | null; type: string; base: string; amount: string; count: number }[];
  missingNpwp: string[];
}
export interface BpjsRecapRow {
  id: string;
  code: string;
  name: string;
  nik: string | null;
  joinDate: string;
  resignDate: string | null;
  wage: string;
  kesCompany: string;
  kesEmployee: string;
  jhtCompany: string;
  jhtEmployee: string;
  jkkCompany: string;
  jkmCompany: string;
  jpCompany: string;
  jpEmployee: string;
}
export interface BpjsRecap {
  period: string;
  run: { number: string; status: string } | null;
  rows: BpjsRecapRow[];
  totals: Pick<BpjsRecapRow, 'kesCompany' | 'kesEmployee' | 'jhtCompany' | 'jhtEmployee' | 'jkkCompany' | 'jkmCompany' | 'jpCompany' | 'jpEmployee'>;
  kesehatan: string;
  ketenagakerjaan: string;
  total: string;
  dueKesehatan: string;
  dueKetenagakerjaan: string;
  paid: { amount: string; date: string | null; ntpn: string | null };
  changes: { code: string; name: string; kind: 'MASUK' | 'KELUAR'; date: string }[];
  caps: { kesehatan: number; jp: number; jkkRate: number; jkmRate: number };
}

/** Barang yang terindikasi turun nilai: harga jual (− taksiran biaya menjual) < biaya rata-rata */
export interface WritedownCandidate {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  qty: string;
  avgCost: string;
  sellPrice: string;
  /** Nilai realisasi neto per satuan dasar */
  nrv: string;
  loss: string;
}

/** Barang yang punya sisa penurunan nilai dan bisa dipulihkan bila harganya naik lagi */
export interface WritedownRecoverable {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  qty: string;
  avgCost: string;
  /** Batas pemulihan per satuan = biaya sebelum diturunkan */
  maxCost: string;
  sellPrice: string;
  nrv: string;
  /** min(NRV, batas) — null bila NRV belum di atas nilai buku */
  suggestedCost: string | null;
  gain: string;
}

export interface InventoryWritedown {
  id: string;
  number: string;
  kind: 'WRITEDOWN' | 'REVERSAL';
  date: string;
  warehouseId: string;
  warehouseName: string;
  reason: string;
  lines: { productId: string; sku: string; name: string; unit: string; qty: string; oldCost: string; newCost: string; amount: string }[];
  total: string;
  journalId: string | null;
  createdByName: string | null;
  createdAt: string;
}


// ---------- Usaha jasa ----------
export type InvoiceKind = 'GOODS' | 'SERVICE';
/** PPh yang dipotong pelanggan atas tagihan jasa */
export type CustomerWithholdingType = 'PPH23' | 'PPH4_2';

export interface Project {
  id: string;
  code: string;
  name: string;
  customerId: string;
  customer: { code: string; name: string };
  /** Nilai kontrak (DPP, belum PPN) */
  contractValue: string;
  startDate: string | null;
  endDate: string | null;
  status: 'ACTIVE' | 'DONE' | 'CANCELLED';
  notes: string | null;
  /** DPP yang sudah ditagih lewat faktur jasa */
  billed: string;
  /** Persentase penagihan terhadap nilai kontrak */
  billedPct: number;
  /** Uang muka diterima (bruto) dan sisanya */
  deposits: string;
  depositsRemaining: string;
  /** Piutang yang belum dibayar */
  outstanding: string;
  /** Kemajuan pekerjaan terakhir (%) dan tanggalnya */
  progressPct: number | null;
  progressDate: string | null;
  /** Posisi akrual: + pendapatan belum ditagih (aset kontrak), − pendapatan diterima dimuka */
  accrual: string;
  /** Biaya langsung proyek dari tagihan biaya */
  directCost: string;
  invoices?: Invoice[];
}

/** Biaya langsung proyek dari tagihan biaya, kas keluar, dan gaji */
export interface ProjectCost {
  source: 'BILL' | 'CASH' | 'PAYROLL' | 'JOURNAL';
  docId: string;
  number: string;
  date: string;
  description: string | null;
  account: string;
  amount: string;
}

export interface ProjectProgress {
  id: string;
  number: string;
  projectId: string;
  date: string;
  percent: string;
  earned: string;
  billed: string;
  accrualBefore: string;
  accrualAfter: string;
  adjustment: string;
  notes: string | null;
  journalId: string | null;
}

export interface CustomerDeposit {
  id: string;
  number: string;
  date: string;
  customerId: string;
  customer: { code: string; name: string };
  projectId: string | null;
  project?: { code: string; name: string } | null;
  method: string;
  /** Jumlah diterima (termasuk PPN bila ada) */
  amount: string;
  dpp: string;
  taxAmount: string;
  appliedAmount: string;
  remaining: string;
  description: string | null;
  applications?: { id: string; date: string; amount: string; invoice: { id: string; number: string } }[];
}

/** Bukti potong PPh dari pelanggan (kredit pajak) */
export interface WithheldByCustomerRow {
  invoiceId: string;
  number: string;
  date: string;
  customer: string;
  customerNpwp: string | null;
  type: CustomerWithholdingType;
  rate: string;
  base: string;
  amount: string;
  slipNo: string | null;
  slipDate: string | null;
}
export interface WithheldByCustomerReport {
  period: string;
  rows: WithheldByCustomerRow[];
  totals: { type: CustomerWithholdingType; base: string; amount: string; missingSlips: number }[];
}

// ---------- Produksi ----------
export interface Bom {
  id: string;
  code: string;
  name: string;
  productId: string;
  product: { sku: string; name: string; unit: string };
  /** Hasil per batch (satuan dasar) */
  outputQty: string;
  laborCost: string;
  overheadCost: string;
  notes: string | null;
  isActive: boolean;
  lines: { id: string; productId: string; sku: string; name: string; unit: string; qty: string; unitCost: string }[];
  /** Taksiran dari biaya rata-rata bahan saat ini */
  estimate: { material: string; batchCost: string; unitCost: string };
}

export interface ProductionOrder {
  id: string;
  number: string;
  date: string;
  status: ProductionStatus;
  /** Perintah berjenjang: induk yang memakai hasilnya, jumlah perintah anak (barang setengah jadi), dan nomor rencana */
  parentOrderId?: string | null;
  parentNumber?: string | null;
  childCount?: number;
  planNo?: string | null;
  bom: { id: string; code: string; name: string };
  product: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; name: string };
  batches: string;
  plannedQty: string;
  outputQty: string;
  startedDate: string | null;
  completedDate: string | null;
  materialCost: string;
  laborCost: string;
  overheadCost: string;
  totalCost: string;
  unitCost: string;
  notes: string | null;
  lines: { id: string; productId: string; sku: string; name: string; unit: string; plannedQty: string; issuedQty: string; unitCost: string; value: string }[];
}

/** Laporan harga pokok produksi */
export interface ProductionReport {
  period: string;
  from: string;
  to: string;
  wipStart: string;
  materialUsed: string;
  laborApplied: string;
  overheadApplied: string;
  wipEnd: string;
  costOfGoodsManufactured: string;
  /** Harus 0: WIP awal + bahan + upah + overhead − WIP akhir − HPP produksi */
  check: string;
  laborActual: string;
  overheadActual: string;
  /** + kurang dibebankan / − lebih dibebankan (tetap di beban pokok penjualan) */
  variance: string;
  byProduct: { productId: string; sku: string; name: string; unit: string; orders: number; qty: string; material: string; conversion: string; total: string; unitCost: string }[];
}

/** Kurs harian mata uang asing terhadap Rupiah (Rp per 1 satuan valas) */
export interface ExchangeRate {
  id: string;
  currency: string;
  date: string;
  rate: string;
  note: string | null;
}
