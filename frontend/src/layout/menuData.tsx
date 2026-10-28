import { CheckSquareOutlined, AuditOutlined, HeartOutlined } from '@ant-design/icons';
import { type AppKey, type BusinessModel } from '@sansu/shared';
import { APP_ICONS } from '@/lib/apps';
import { t } from '@/lib/terms';

/** `app`: item hanya tampil bila aplikasi itu aktif (mis. menu pajak yang butuh aplikasi Penjualan) */
export type Item = { key: string; label: string; /** Hanya untuk peran ini (OWNER selalu boleh) */ roles?: string[]; /** Hanya tampil bila fitur langganan dinyalakan di Panel SANSU */ billing?: boolean; /** Hanya untuk SAK EP (tidak diakui SAK EMKM) */ epOnly?: boolean; app?: AppKey; /** Disembunyikan untuk jenis usaha ini (mis. surat jalan untuk usaha jasa murni) */ hideFor?: BusinessModel[]; /** Hanya tampil untuk jenis usaha ini */ models?: BusinessModel[]; /** Hanya tampil bila perusahaan punya cabang usaha */ branch?: boolean; /** Hanya tampil bila perusahaan sudah membuat anggaran */ budget?: boolean; /** Hanya tampil bila fitur pajak ini relevan (lihat taxFeatures di @sansu/shared) */ tax?: 'vat' | 'coretax' | 'withheldByCustomers' | 'fiscalReconciliation' };
/** Menu pembukuan: Keuangan (pemegang uang) tidak memilikinya; OWNER selalu boleh */
export const BOOKKEEPING = ['ADMIN', 'ACCOUNTANT'];
/** Submenu boleh dikelompokkan dengan judul kecil (mis. "Akhir periode") */
export type Sub = Item | { section: string; items: Item[] };
export type Group = {
  key: string;
  app?: AppKey;
  /** Hanya tampil untuk model bisnis tertentu (mis. Produksi) */
  models?: BusinessModel[];
  /** Disembunyikan untuk model bisnis tertentu (menunya digantikan grup khusus) */
  hideFor?: BusinessModel[];
  admin?: boolean;
  label: string;
  icon: React.ReactNode;
  children?: Sub[];
  to?: string;
  /** Judul bagian di sidebar (Penjualan, Pembelian, Persediaan, Produksi, Keuangan, Pembukuan & pajak, SDM, Administrasi) */
  part: string;
  /** Peran yang hanya melihat menu ini (tanpa hak mengubah): diberi keterangan "lihat" pada judul grup */
  readOnlyFor?: string[];
  /** Menu inti: tampil untuk peran di `roles` tanpa syarat aplikasi */
  core?: boolean;
  roles?: string[];
};
export const subItems = (c: Sub[] = []): Item[] => c.flatMap((x) => ('section' in x ? x.items : [x]));

/**
 * Sidebar disusun mengikuti alur kerja usaha. Urutan bagian mengikuti alur utama jenis usahanya (GROUP_ORDER), dan di dalam tiap bagian
 * submenu dibagi tiga judul kecil yang berurutan:
 *   Persiapan (data induk dan aturan yang harus ada lebih dulu) → Proses (langkah kerja dari awal sampai akhir) → Laporan & kontrol.
 * "Laporan <bagian>" berisi laporan kerja bagian itu; laporan pendukung pembukuan hanya satu menu di Akuntansi.
 */
export const REPORT_ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'];
const SEC = { prep: 'Persiapan', proc: 'Proses', rep: 'Laporan & kontrol' } as const;
export const MENU: Group[] = [
  { part: '', key: '/dashboard', label: 'Dashboard', icon: APP_ICONS.dashboard, to: '/dashboard' },
  // Menu Ruang kerja disembunyikan dulu (halaman /vertikal tetap ada; aktifkan lagi dengan mengembalikan baris di bawah dan '/vertikal' di HEAD_KEYS)
  // { part: '', key: '/vertikal', label: 'Ruang kerja', icon: <AppstoreAddOutlined />, to: '/vertikal', core: true, roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER', 'HR'] },
  { part: '', key: '/health', label: 'Cek kesehatan', icon: <HeartOutlined />, to: '/health', core: true, roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
  { part: '', key: '/tasks', label: 'Tugas saya', icon: <CheckSquareOutlined />, to: '/tasks', core: true, roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER', 'HR'] },

  // ---------- Penjualan ----------
  {
    part: 'Penjualan',
    key: 'crm',
    app: 'crm',
    hideFor: ['UTILITAS'],
    label: 'CRM',
    icon: APP_ICONS.crm,
    children: [
      { key: '/crm', label: t('Pipeline calon pelanggan') },
      { key: '/quotations', label: 'Penawaran harga' },
    ],
  },
  // ---------- Layanan air (khusus perusahaan Utilitas: air bersih) ----------
  {
    part: 'Penjualan',
    key: 'water',
    app: 'utility',
    models: ['UTILITAS'],
    label: 'Layanan air',
    icon: APP_ICONS.utility,
    children: [
      { key: '/utility/ringkasan', label: 'Ringkasan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
      {
        section: 'Pelanggan & pelayanan',
        items: [
          { key: '/customers', label: 'Pelanggan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/permohonan', label: 'Permohonan sambungan baru', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/sambungan', label: 'Sambungan & meter', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/mutasi', label: 'Balik nama, ganti golongan, tutup', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/pengaduan', label: 'Pengaduan & gangguan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/portal', label: 'Portal pelanggan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES'] },
        ],
      },
      {
        section: 'Meter & tagihan',
        items: [
          { key: '/utility/tarif', label: 'Tarif air & aturan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/rute', label: 'Rute baca & tagih', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/meter', label: 'Catat & verifikasi meter', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
          { key: '/utility/lapangan', label: 'Petugas lapangan', roles: ['OWNER', 'ADMIN', 'WAREHOUSE'] },
          { key: '/utility/impor', label: 'Impor & alat meter', roles: ['OWNER', 'ADMIN', 'WAREHOUSE'] },
          { key: '/utility/tagihan', label: 'Tagihan air bulanan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/non-air', label: 'Layanan non-air', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/koreksi', label: 'Koreksi tagihan & denda', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
        ],
      },
      {
        section: 'Penerimaan & penagihan',
        items: [
          { key: '/utility/loket', label: 'Terima pembayaran (loket)', roles: ['OWNER', 'ADMIN', 'FINANCE', 'CASHIER'] },
          { key: '/utility/va', label: 'Pembayaran virtual account', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/rekap', label: 'Rekap harian loket', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/lokasi', label: 'Daftar loket', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/invoices', label: 'Faktur & piutang', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/tunggakan', label: 'Tunggakan & pemutusan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/cetak', label: 'Cetak & kirim tagihan/SP', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/antrean', label: 'Antrean pesan otomatis', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/penagihan', label: 'Penagihan lapangan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
          { key: '/utility/angsuran', label: 'Angsuran tunggakan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
          { key: '/utility/jaminan', label: 'Deposit / jaminan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
        ],
      },
      {
        section: 'Teknik & produksi',
        items: [
          { key: '/utility/inventaris', label: 'Inventaris & tera meter', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
          { key: '/utility/aset', label: 'Aset jaringan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/perintah-kerja', label: 'Perintah kerja', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE'] },
          { key: '/utility/produksi', label: 'Produksi air & NRW', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
          { key: '/utility/kualitas', label: 'Kualitas air', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/utility-kinerja', label: 'Laporan kinerja PAM', roles: REPORT_ROLES },
          { key: '/laporan/utility', label: 'Laporan layanan air', roles: REPORT_ROLES },
          { key: '/laporan/utility-nonair', label: 'Laporan layanan non-air', roles: REPORT_ROLES },
          { key: '/utility/zona', label: 'Kehilangan air per zona', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/kontrol', label: 'Kontrol kebocoran', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
    ],
  },
  {
    part: 'Penjualan',
    key: 'utility',
    app: 'utility',
    hideFor: ['UTILITAS'],
    label: 'Layanan utilitas',
    icon: APP_ICONS.utility,
    children: [
      {
        section: SEC.prep,
        items: [
          { key: '/utility/tarif', label: 'Tarif & aturan' },
          { key: '/utility/sambungan', label: 'Sambungan pelanggan' },
        ],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/utility/meter', label: 'Catat & verifikasi meter' },
          { key: '/utility/tagihan', label: 'Tagihan bulanan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/utility/tunggakan', label: 'Tunggakan & pemutusan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/utility/ringkasan', label: 'Ringkasan' },
          { key: '/laporan/utility', label: 'Laporan utilitas', roles: REPORT_ROLES },
          { key: '/utility/kontrol', label: 'Kontrol kebocoran', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
    ],
  },
  {
    part: 'Penjualan',
    key: 'sales',
    app: 'sales',
    hideFor: ['UTILITAS'],
    label: t('Penjualan'),
    icon: APP_ICONS.sales,
    children: [
      {
        section: SEC.prep,
        items: [
          { key: '/customers', label: t('Pelanggan') },
          { key: '/price-lists', label: 'Daftar harga', models: ['FMCG', 'DAGANG', 'RITEL'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT'] },
          { key: '/promos', label: 'Promo & bonus barang', models: ['FMCG', 'RITEL'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/sales-targets', label: 'Target & komisi sales', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
        ],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/sales-orders', label: t('Sales Order') },
          { key: '/projects', label: 'Proyek & termin', models: ['JASA'] },
          { key: '/scheduling', label: 'Jadwal sumber daya', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
          { key: '/timesheets', label: 'Lembar waktu', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
          { key: '/retainers', label: 'Retainer', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/customer-deposits', label: t('Uang muka pelanggan'), hideFor: ['RITEL'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT'] },
          { key: '/deliveries', label: 'Surat jalan', hideFor: ['JASA', 'RITEL', 'FNB', 'UTILITAS'] },
          { key: '/delivery-trips', label: 'Rute pengiriman', models: ['DAGANG', 'FMCG', 'MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
          { key: '/canvass', label: 'Kanvas (van sales)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT'] },
          { key: '/invoices', label: t('Faktur & piutang'), roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT'] },
          { key: '/returns?tab=sales', label: t('Retur penjualan'), roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/goods-swaps', label: 'Tukar-guling', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT'] },
          { key: '/consignments', label: 'Konsinyasi (titipan outlet)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
          { key: '/trade', label: 'Modern trade & klaim prinsipal', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          // Menu Marketplace disembunyikan dulu (halamannya tetap ada di /integrations?tab=marketplace)
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/sales', label: 'Laporan penjualan', roles: REPORT_ROLES, hideFor: ['JASA', 'RITEL', 'FNB', 'UTILITAS'] },
          { key: '/laporan/fmcg', label: 'Laporan FMCG', models: ['FMCG'], roles: REPORT_ROLES },
          { key: '/laporan/jasa', label: 'Laporan jasa & proyek', models: ['JASA'], roles: REPORT_ROLES },
          { key: '/sales-controls', label: 'Kontrol penjualan', roles: REPORT_ROLES, hideFor: ['JASA', 'RITEL', 'FNB', 'UTILITAS'] },
        ],
      },
    ],
  },
  {
    part: 'Penjualan',
    key: 'pos',
    app: 'pos',
    hideFor: ['UTILITAS'],
    label: 'Kasir (POS)',
    icon: APP_ICONS.pos,
    children: [
      {
        section: SEC.prep,
        items: [{ key: '/pos/loyalty', label: 'Program loyalitas', models: ['RITEL', 'FNB'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] }],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/pos', label: 'Layar kasir', roles: ['OWNER', 'CASHIER', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/pos/tables', label: 'Meja & pesanan', models: ['FNB'], roles: ['OWNER', 'CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/pos/kitchen', label: 'Layar dapur', models: ['FNB'], roles: ['OWNER', 'CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/pos/online', label: 'Pesanan online', models: ['FNB'], roles: ['ADMIN', 'FINANCE'] },
          { key: '/pos/sessions', label: 'Riwayat sesi kasir', roles: ['OWNER', 'CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/pos/staff-sales', label: 'Kinerja petugas', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/pos/settlements', label: 'Pencairan QRIS/kartu', models: ['RITEL', 'FNB'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/pos', label: 'Laporan kasir', models: ['RITEL', 'FNB'], roles: REPORT_ROLES },
          { key: '/laporan/fnb', label: 'Laporan F&B', models: ['FNB'], roles: REPORT_ROLES },
        ],
      },
    ],
  },

  // ---------- Pembelian & stok ----------
  {
    part: 'Pembelian',
    key: 'purchase',
    app: 'purchase',
    label: t('Pembelian'),
    icon: APP_ICONS.purchase,
    children: [
      {
        section: SEC.prep,
        items: [
          { key: '/suppliers', label: t('Supplier') },
          { key: '/price-agreements', label: 'Kontrak harga prinsipal', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
          { key: '/price-agreements', label: 'Harga pemasok bahan', models: ['FNB'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
          { key: '/price-agreements', label: 'Kontrak harga pemasok', models: ['DAGANG', 'RITEL', 'MANUFAKTUR', 'UTILITAS'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
        ],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/shopping-list', label: 'Daftar belanja harian', hideFor: ['JASA', 'UTILITAS'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING', 'WAREHOUSE'] },
          { key: '/purchase-requests', label: 'Permintaan beli' },
          { key: '/purchase-orders', label: t('Purchase Order') },
          { key: '/supplier-advances', label: 'Uang muka pemasok', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
          { key: '/goods-receipts', label: 'Penerimaan barang', hideFor: ['JASA'] },
          { key: '/purchase-invoices', label: t('Faktur & hutang') },
          { key: '/returns?tab=purchase', label: t('Retur pembelian'), roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/purchases', label: 'Laporan pembelian', roles: REPORT_ROLES },
          { key: '/purchase-controls', label: 'Kontrol pembelian', roles: REPORT_ROLES, hideFor: ['JASA'] },
        ],
      },
    ],
  },
  {
    part: 'Persediaan',
    key: 'inventory',
    app: 'inventory',
    label: t('Inventori'),
    icon: APP_ICONS.inventory,
    children: [
      {
        section: SEC.prep,
        items: [
          { key: '/products', label: t('Produk') },
          { key: '/warehouses', label: t('Gudang') },
        ],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/inventory', label: t('Persediaan & mutasi') },
          { key: '/inventory/warehouses', label: t('Persediaan per gudang') },
          { key: '/inventory/bins', label: 'Rak gudang', hideFor: ['JASA', 'UTILITAS'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING', 'SALES'] },
          { key: '/inventory/transfers', label: t('Transfer gudang') },
          { key: '/inventory/counts', label: 'Stock opname' },
          { key: '/inventory/expiry', label: 'Kedaluwarsa bahan', hideFor: ['JASA', 'UTILITAS'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT'] },
          { key: '/inventory/lot-trace', label: 'Telusuri lot (recall)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES', 'ACCOUNTANT'] },
          { key: '/inventory/writedowns', label: 'Penurunan nilai', epOnly: true, hideFor: ['JASA'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/inventory', label: 'Laporan persediaan', roles: REPORT_ROLES },
          { key: '/inventory-controls', label: 'Kontrol persediaan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'], hideFor: ['JASA'] },
        ],
      },
    ],
  },

  {
    part: 'Produksi',
    key: 'production',
    app: 'inventory',
    models: ['MANUFAKTUR', 'FNB'],
    label: 'Produksi',
    icon: APP_ICONS.production,
    children: [
      {
        section: SEC.prep,
        items: [
          { key: '/production/boms', label: t('Resep (BOM)'), roles: ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/production/work-centers', label: 'Pusat kerja & jadwal mesin', models: ['MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.proc,
        items: [
          { key: '/production/requirements', label: 'Kebutuhan bahan (MRP)', models: ['MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/production/orders', label: 'Perintah produksi', roles: ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/production/qc', label: 'Pengendalian mutu (QC)', models: ['MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT'] },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/mfg', label: 'Laporan produksi', models: ['MANUFAKTUR'], roles: REPORT_ROLES },
          { key: '/production/report', label: 'Harga pokok produksi', roles: REPORT_ROLES },
          { key: '/production/variance', label: 'Analisis selisih', models: ['MANUFAKTUR'], roles: REPORT_ROLES },
        ],
      },
    ],
  },

  // ---------- Keuangan ----------
  {
    part: 'Keuangan',
    key: 'cash',
    app: 'cash',
    label: 'Kas & Bank',
    icon: APP_ICONS.cash,
    readOnlyFor: ['ACCOUNTANT'],
    children: [
      {
        section: SEC.proc,
        items: [
          { key: '/cash', label: 'Kas, kas kecil & opname' },
          { key: '/bank', label: 'Cocokkan dengan bank' },
        ],
      },
      {
        section: SEC.rep,
        items: [
          { key: '/laporan/cash', label: 'Laporan kas & bank', roles: REPORT_ROLES },
          { key: '/finance-controls', label: 'Kontrol keuangan', roles: REPORT_ROLES },
        ],
      },
    ],
  },
  {
    part: 'Pembukuan & pajak',
    key: 'accounting',
    app: 'accounting',
    label: 'Akuntansi',
    icon: APP_ICONS.accounting,
    readOnlyFor: ['FINANCE'],
    // Urut mengikuti alur kerja pembukuan. Yang memegang uang (Keuangan) hanya melihat pencatatan dan laporan,
    // sedangkan persiapan dan tutup periode khusus yang membukukan (Akuntan/Admin/Pemilik).
    children: [
      {
        section: 'Persiapan',
        items: [
          { key: '/accounts', label: 'Bagan akun', roles: BOOKKEEPING },
          { key: '/opening-balance', label: 'Saldo awal', roles: BOOKKEEPING },
        ],
      },
      {
        section: 'Pencatatan',
        items: [
          { key: '/journals', label: 'Jurnal umum' },
          { key: '/adjustments', label: 'Jurnal penyesuaian', roles: BOOKKEEPING },
        ],
      },
      {
        section: 'Laporan',
        items: [
          { key: '/ledger', label: 'Buku besar' },
          { key: '/trial-balance', label: 'Neraca saldo' },
          { key: '/worksheet', label: 'Neraca lajur' },
          { key: '/reports', label: 'Laporan keuangan' },
          { key: '/support-reports', label: 'Laporan pendukung' },
          { key: '/accounting-controls', label: 'Kontrol pembukuan & pajak', roles: REPORT_ROLES },
        ],
      },
      {
        section: 'Akhir periode',
        items: [
          { key: '/closing', label: 'Tutup buku', roles: BOOKKEEPING },
          // Menu Pelaporan keuangan disembunyikan (pengaturannya tetap di Pengaturan → Perusahaan → Pelaporan keuangan)
        ],
      },
    ],
  },
  {
    part: 'Pembukuan & pajak',
    key: 'tax',
    app: 'accounting',
    label: 'Pajak',
    icon: APP_ICONS.tax,
    children: [
      { key: '/vat', label: 'Rekap PPN', tax: 'vat' },
      { key: '/integrations?tab=coretax', label: t('e-Faktur Coretax'), tax: 'coretax' },
      { key: '/tax/withheld', label: t('PPh dipotong pelanggan'), app: 'sales', tax: 'withheldByCustomers' },
      { key: '/tax', label: 'Setoran pajak & BPJS' },
      { key: '/tax/recap', label: 'Rekap pajak' },
      { key: '/payroll/bpjs?dari=pajak', label: 'Rekap BPJS', app: 'payroll' },
      { key: '/fiscal', label: 'Rekonsiliasi fiskal', tax: 'fiscalReconciliation', roles: BOOKKEEPING },
    ],
  },

  // ---------- SDM ----------
  {
    part: 'SDM',
    key: 'hr',
    app: 'hr',
    label: 'Karyawan',
    icon: APP_ICONS.hr,
    children: [
      {
        section: SEC.proc,
        items: [
          { key: '/employees', label: 'Data karyawan', roles: ['OWNER', 'HR', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/employees/controls', label: 'Persetujuan & peringatan', models: ['JASA'], roles: ['OWNER', 'HR', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/shifts', label: 'Jadwal shift', models: ['RITEL', 'FNB', 'MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
          { key: '/attendance', label: 'Absensi', roles: ['OWNER', 'HR'] },
          { key: '/leaves', label: 'Cuti', roles: ['OWNER', 'HR'] },
        ],
      },
      {
        section: SEC.rep,
        items: [{ key: '/laporan/hr', label: 'Laporan SDM', roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] }],
      },
    ],
  },
  {
    part: 'SDM',
    key: 'payroll',
    app: 'payroll',
    label: 'Penggajian',
    icon: APP_ICONS.payroll,
    children: [
      { key: '/payroll', label: 'Proses gaji' },
      { key: '/payroll/jasa', label: 'Upah jasa (jam, sesi, komisi)', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/jasa', label: 'Premi shift & borongan', models: ['RITEL', 'FNB'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/jasa', label: 'Upah borongan & per hasil', models: ['MANUFAKTUR', 'DAGANG', 'FMCG'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/pph21', label: 'Rekap PPh 21' },
      { key: '/payroll/bpjs', label: 'Rekap BPJS' },
    ],
  },

  // ---------- Administrasi ----------
  { part: 'Administrasi', key: '/approvals', label: 'Persetujuan', icon: <AuditOutlined />, to: '/approvals' },
  {
    part: 'Administrasi',
    key: 'settings',
    admin: true,
    label: 'Pengaturan',
    icon: APP_ICONS.settings,
    children: [
      { key: '/settings/company', label: 'Perusahaan' },
      { key: '/settings/users', label: 'Pengguna' },
      { key: '/settings/branches', label: 'Cabang & toko', branch: true },
      { key: '/settings/apps', label: 'Aplikasi' },
      { key: '/settings/import', label: 'Impor data (Excel)' },
      { key: '/billing', label: 'Langganan', billing: true },
      { key: '/settings/audit', label: 'Jejak audit' },
    ],
  },
];

/** Bagian menu: atas (selalu), lalu bagian usaha menurut alur utama jenis usahanya, lalu keuangan sampai administrasi */
export const HEAD_KEYS = ['/dashboard', '/health', '/tasks'];
export const TAIL_KEYS = ['cash', 'accounting', 'tax', 'hr', 'payroll', '/approvals', 'settings'];
export const GROUP_ORDER: Record<BusinessModel, string[]> = {
  DAGANG: ['utility', 'crm', 'sales', 'pos', 'purchase', 'inventory', 'production'],
  FMCG: ['utility', 'crm', 'sales', 'pos', 'purchase', 'inventory', 'production'],
  RITEL: ['utility', 'pos', 'sales', 'crm', 'purchase', 'inventory', 'production'],
  FNB: ['utility', 'pos', 'purchase', 'inventory', 'production', 'sales', 'crm'],
  MANUFAKTUR: ['utility', 'purchase', 'inventory', 'production', 'crm', 'sales', 'pos'],
  JASA: ['utility', 'crm', 'sales', 'pos', 'purchase', 'inventory', 'production'],
  UTILITAS: ['water', 'utility', 'crm', 'sales', 'pos', 'purchase', 'inventory', 'production'],
};
/** Susun ulang MENU menurut alur utama jenis usaha; kunci yang tak terdaftar tetap di tempat bagian usaha */
export function menuFor(model: BusinessModel, menu: Group[] = MENU): Group[] {
  const order = [...HEAD_KEYS, ...GROUP_ORDER[model], ...TAIL_KEYS];
  const at = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.indexOf(TAIL_KEYS[0]) - 0.5 : i; };
  return [...menu].sort((a, b) => at(a.key) - at(b.key));
}


/** Konteks pengguna untuk menilai apakah sebuah item menu terlihat (sama dengan aturan sidebar) */
export interface VisibilityCtx {
  role: string;
  model: BusinessModel;
  framework?: string;
  multiBranch?: boolean;
  hasBudget?: boolean;
  subscriptionEnabled?: boolean;
  taxFeatures?: Record<string, boolean | undefined>;
  can: (app: AppKey) => boolean;
}
/** Item menu terlihat untuk pengguna ini? (peran, jenis usaha, aplikasi, fitur pajak, cabang, anggaran) */
export function itemVisible(i: Item, c: VisibilityCtx): boolean {
  return (!i.app || c.can(i.app)) && (!i.roles || c.role === 'OWNER' || i.roles.includes(c.role)) && (!i.models || i.models.includes(c.model)) && !i.hideFor?.includes(c.model)
    && (!i.tax || c.taxFeatures?.[i.tax] !== false) && !(i.epOnly && c.framework === 'SAK_EMKM') && !(i.billing && c.subscriptionEnabled === false) && !(i.branch && !c.multiBranch) && !(i.budget && !c.hasBudget);
}
/** Tautan (path, boleh dengan ?query) terlihat bila ada item menu berkunci sama yang terlihat; tautan di luar menu dianggap tidak ada */
export function pathVisible(path: string, c: VisibilityCtx, menu: Group[] = MENU): boolean {
  return menu.some((g) => (!g.models || g.models.includes(c.model)) && !g.hideFor?.includes(c.model) && (!g.app || c.can(g.app)) && (g.to === path ? !g.roles || c.role === 'OWNER' || g.roles.includes(c.role) : subItems(g.children).some((i) => i.key === path && itemVisible(i, c))));
}
