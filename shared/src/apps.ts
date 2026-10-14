import type { Role } from './domain.js';

/**
 * Katalog aplikasi SANSU (mirip layar "Apps" di Odoo).
 * Setiap perusahaan memilih aplikasi yang dipakai; menu & API mengikuti pilihan ini.
 */
export const APP_KEYS = ['sales', 'purchase', 'inventory', 'accounting', 'cash', 'pos', 'crm', 'hr', 'payroll'] as const;
export type AppKey = (typeof APP_KEYS)[number];

export type AppCategory = 'Penjualan' | 'Supply Chain' | 'Keuangan' | 'SDM';

export interface AppInfo {
  key: AppKey;
  name: string;
  category: AppCategory;
  description: string;
  /** Warna latar ikon di layar menu aplikasi */
  color: string;
  /** Aplikasi inti tidak bisa dinonaktifkan */
  core?: boolean;
  /** Aplikasi lain yang ikut diaktifkan */
  depends?: AppKey[];
  /** Peran (selain OWNER & ADMIN) yang melihat aplikasi ini */
  roles: Role[];
  /** Halaman pertama saat ikon diklik */
  home: string;
}

export const APPS: AppInfo[] = [
  {
    key: 'crm',
    name: 'CRM',
    category: 'Penjualan',
    description: 'Prospek, pipeline, follow-up, dan penawaran harga',
    color: '#E05A47',
    depends: ['sales'],
    roles: ['SALES'],
    home: '/crm',
  },
  {
    key: 'sales',
    name: 'Penjualan',
    category: 'Penjualan',
    description: 'Sales order, faktur, piutang, retur penjualan',
    color: '#0F766E',
    depends: ['inventory', 'accounting'],
    roles: ['SALES', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'],
    home: '/sales-orders',
  },
  {
    key: 'pos',
    name: 'Kasir (POS)',
    category: 'Penjualan',
    description: 'Jualan tunai di toko: scan barcode, struk, tutup kasir',
    color: '#F59E0B',
    depends: ['inventory', 'accounting'],
    roles: ['CASHIER', 'SALES', 'FINANCE'],
    home: '/pos',
  },
  {
    key: 'purchase',
    name: 'Pembelian',
    category: 'Supply Chain',
    description: 'Purchase order, faktur supplier, hutang, retur pembelian',
    color: '#7C3AED',
    depends: ['inventory', 'accounting'],
    roles: ['FINANCE', 'ACCOUNTANT', 'WAREHOUSE'],
    home: '/purchase-orders',
  },
  {
    key: 'inventory',
    name: 'Inventori',
    category: 'Supply Chain',
    description: 'Produk, multi satuan, stok per gudang, kartu stok, opname',
    color: '#2563EB',
    roles: ['WAREHOUSE', 'SALES', 'FINANCE', 'ACCOUNTANT'],
    home: '/inventory',
  },
  {
    key: 'accounting',
    name: 'Akuntansi',
    category: 'Keuangan',
    description: 'Jurnal, buku besar, laporan keuangan, PPN, tutup buku',
    color: '#0B1F2A',
    core: true,
    roles: ['FINANCE', 'ACCOUNTANT'],
    home: '/reports',
  },
  {
    key: 'cash',
    name: 'Kas & Bank',
    category: 'Keuangan',
    description: 'Saldo kas & rekening, kas masuk/keluar, transfer',
    color: '#059669',
    depends: ['accounting'],
    roles: ['FINANCE', 'ACCOUNTANT'],
    home: '/cash',
  },
  {
    key: 'hr',
    name: 'Karyawan',
    category: 'SDM',
    description: 'Data karyawan, absensi, dan cuti',
    color: '#DB2777',
    roles: ['HR'],
    home: '/employees',
  },
  {
    key: 'payroll',
    name: 'Penggajian',
    category: 'SDM',
    description: 'Slip gaji, BPJS, PPh 21 TER, jurnal & pembayaran gaji',
    color: '#9333EA',
    depends: ['hr', 'accounting'],
    roles: ['HR', 'FINANCE', 'ACCOUNTANT'],
    home: '/payroll',
  },
];

export const APP_BY_KEY = Object.fromEntries(APPS.map((a) => [a.key, a])) as Record<AppKey, AppInfo>;

/** Aplikasi bawaan perusahaan baru */
export const DEFAULT_APPS: AppKey[] = ['sales', 'purchase', 'inventory', 'accounting', 'cash'];

/** Semua dependensi (rekursif) sebuah aplikasi, termasuk dirinya */
export function withDependencies(key: AppKey): AppKey[] {
  const out = new Set<AppKey>();
  const walk = (k: AppKey) => {
    if (out.has(k)) return;
    out.add(k);
    APP_BY_KEY[k].depends?.forEach(walk);
  };
  walk(key);
  return [...out];
}

/** Apakah peran boleh membuka aplikasi */
export const canUseApp = (role: Role, app: AppKey) => role === 'OWNER' || role === 'ADMIN' || APP_BY_KEY[app].roles.includes(role);

// ---------- Model bisnis ----------
export const BUSINESS_MODEL_KEYS = ['DAGANG', 'RITEL', 'JASA', 'PRODUKSI', 'MANUFAKTUR', 'FNB'] as const;
export type BusinessModel = (typeof BUSINESS_MODEL_KEYS)[number];
/** Model yang mengolah bahan menjadi barang jadi atau menu (resep, perintah produksi, biaya pabrik/dapur) */
export const isProductionModel = (m: BusinessModel | string | null | undefined): boolean => m === 'PRODUKSI' || m === 'MANUFAKTUR' || m === 'FNB';
export interface BusinessModelInfo {
  key: BusinessModel;
  name: string;
  /** Cara usaha ini menghasilkan uang (satu kalimat) */
  summary: string;
  examples: string;
  /** Alur kerja yang dihubungkan SANSU, dari awal sampai laporan */
  flow: string[];
  /** Aplikasi yang dinyalakan otomatis saat mendaftar */
  apps: AppKey[];
  /** false = fitur khusus model ini masih disiapkan (aplikasi inti tetap bisa dipakai) */
  ready: boolean;
  note?: string;
}
/**
 * Enam model bisnis. Satu sistem untuk semuanya — model hanya menentukan aplikasi bawaan,
 * langkah panduan mulai, dan istilah; aplikasi lain tetap bisa dinyalakan kapan saja.
 */
export const BUSINESS_MODELS: BusinessModelInfo[] = [
  {
    key: 'DAGANG',
    name: 'Dagang',
    summary: 'Membeli barang lalu menjualnya kembali ke pelanggan usaha',
    examples: 'Distributor, grosir, toko bangunan, suku cadang, alat kesehatan, ATK, penjual online',
    flow: ['Pembelian', 'Stok gudang', 'Penjualan & faktur', 'Piutang', 'Laporan & pajak'],
    apps: ['sales', 'purchase', 'inventory', 'accounting', 'cash'],
    ready: true,
  },
  {
    key: 'RITEL',
    name: 'Ritel / toko',
    summary: 'Menjual langsung ke pembeli lewat kasir',
    examples: 'Minimarket, toko kelontong, toko pakaian, toko kosmetik, apotek, toko perlengkapan',
    flow: ['Pembelian', 'Stok toko', 'Kasir', 'Tutup kasir', 'Laporan & pajak'],
    apps: ['pos', 'purchase', 'inventory', 'accounting', 'cash'],
    ready: true,
  },
  {
    key: 'JASA',
    name: 'Jasa',
    summary: 'Menjual keahlian atau pekerjaan, ditagih per pekerjaan atau termin',
    examples: 'Kontraktor, bengkel, konsultan, agen perjalanan, event organizer, jasa kebersihan & keamanan',
    flow: ['Penawaran & kontrak', 'Uang muka', 'Tagihan termin', 'Pembayaran & bukti potong', 'Laporan & pajak'],
    apps: ['crm', 'sales', 'purchase', 'accounting', 'cash'],
    ready: true,
  },
  {
    key: 'PRODUKSI',
    name: 'Produksi',
    summary: 'Mengolah bahan baku menjadi produk lalu menjualnya',
    examples: 'Konveksi, makanan & minuman kemasan, percetakan, mebel, kerajinan',
    flow: ['Pembelian bahan', 'Produksi', 'Stok produk jadi', 'Penjualan', 'Laporan & pajak'],
    apps: ['sales', 'purchase', 'inventory', 'accounting', 'cash'],
    ready: true,
  },
  {
    key: 'MANUFAKTUR',
    name: 'Manufaktur',
    summary: 'Pabrik yang mengolah bahan baku bertahap (bahan → barang setengah jadi → barang jadi) dengan perencanaan kebutuhan bahan dan pengendalian biaya produksi',
    examples: 'Pabrik makanan & minuman, garmen, plastik & kemasan, furnitur, kimia, komponen logam',
    flow: ['Perencanaan kebutuhan bahan', 'Pembelian bahan', 'Produksi bertingkat', 'Stok barang jadi', 'Penjualan', 'Analisis selisih & laporan'],
    apps: ['sales', 'purchase', 'inventory', 'accounting', 'cash'],
    ready: true,
  },
  {
    key: 'FNB',
    name: 'F&B (kafe & restoran)',
    summary: 'Membuat makanan dan minuman dari bahan sesuai resep, lalu menjualnya langsung lewat kasir',
    examples: 'Kafe, restoran, warung makan, kedai kopi, bakery, katering, food stall',
    flow: ['Pembelian bahan', 'Persediaan bahan (pantau kedaluwarsa)', 'Resep menu', 'Kasir (bahan terpotong otomatis)', 'Tutup kasir', 'Laporan & pajak'],
    apps: ['pos', 'purchase', 'inventory', 'accounting', 'cash'],
    ready: true,
    note: 'Tandai produk sebagai "Menu (dibuat saat dipesan)" dan buat resepnya di Produksi › Resep. Setiap menu terjual di kasir, bahan sesuai resep otomatis terpotong dan HPP dihitung dari bahan. Nyalakan pajak restoran daerah (PB1) di Pengaturan › Perusahaan bila daerah Anda mengenakannya; tarif dan tenggat tetap perlu dipastikan dengan konsultan pajak.',
  },
];
export const BUSINESS_MODEL_BY_KEY = Object.fromEntries(BUSINESS_MODELS.map((m) => [m.key, m])) as Record<BusinessModel, BusinessModelInfo>;
