import type { BusinessModel } from './apps.js';

/**
 * Pengaturan yang perlu diatur menurut jenis usaha. Definisi (teks + tujuan) dipakai bersama oleh server (yang menghitung status
 * terisi/belum dari data) dan tampilan. Hanya pengaturan yang MEMANG relevan bagi jenis usaha itu yang ditampilkan.
 */
export type SetupGroup = 'BEFORE_START' | 'RECOMMENDED';
export const SETUP_GROUP_LABELS: Record<SetupGroup, string> = {
  BEFORE_START: 'Atur sebelum mulai bertransaksi',
  RECOMMENDED: 'Disarankan setelah berjalan',
};

export interface SetupItemDef {
  key: string;
  group: SetupGroup;
  title: string;
  /** mengapa pengaturan ini penting bagi jenis usaha ini */
  why: string;
  /** halaman tempat mengaturnya */
  link: string;
}

const I = (key: string, group: SetupGroup, title: string, why: string, link: string): SetupItemDef => ({ key, group, title, why, link });
const B = 'BEFORE_START' as const;
const R = 'RECOMMENDED' as const;

export const MODEL_SETUP: Record<BusinessModel, SetupItemDef[]> = {
  DAGANG: [
    I('priceLists', B, 'Daftar harga per segmen pelanggan', 'Harga grosir, toko, dan proyek berbeda; faktur otomatis memakai harga sesuai segmen pelanggan.', '/price-lists'),
    I('creditLimit', B, 'Batas kredit pelanggan', 'Mencegah penjualan kredit melebihi kemampuan bayar; tanpa batas, piutang macet sulit dikendalikan.', '/customers'),
    I('inventoryMethod', B, 'Metode persediaan (rata-rata / FIFO)', 'Menentukan harga pokok penjualan dan nilai stok di neraca. Pilih sebelum ada banyak transaksi.', '/settings/company'),
    I('vehicles', R, 'Armada dan rute pengiriman', 'Surat jalan, muatan kendaraan, dan bukti kirim terkelola per rute.', '/delivery-trips'),
    I('supplierPrices', R, 'Kontrak harga pemasok', 'Harga beli disepakati dan dipantau; lonjakan harga langsung terlihat.', '/price-agreements'),
    I('stockMin', R, 'Batas stok minimum', 'Barang cepat habis diingatkan sebelum kosong.', '/inventory'),
  ],
  RITEL: [
    I('posSession', B, 'Buka kasir dan coba satu penjualan', 'Memastikan kasir, printer struk, dan metode pembayaran siap sebelum toko buka.', '/pos'),
    I('barcodes', B, 'Barcode produk', 'Barang dipindai di kasir, bukan dicari manual; mengurangi salah harga dan antrean.', '/products'),
    I('cardBank', B, 'Rekening pencairan EDC dan QRIS', 'Penjualan non-tunai dicocokkan dengan pencairan bank agar selisih dan potongan terlihat.', '/pos/settlements'),
    I('loyalty', R, 'Program poin pelanggan', 'Mendorong pembelian ulang; aturan poin dan batas penukaran diatur sendiri.', '/pos/loyalty'),
    I('branches', R, 'Cabang atau toko lain', 'Stok, kas, dan laporan dipisah per toko bila usaha punya lebih dari satu lokasi.', '/settings/branches'),
    I('stockMin', R, 'Batas stok minimum', 'Rak tidak kosong tanpa disadari.', '/inventory'),
  ],
  JASA: [
    I('serviceRates', B, 'Tarif jasa per jam atau sesi', 'Jam kerja dan sesi ditagih dengan tarif yang konsisten dan bisa ditelusuri.', '/timesheets'),
    I('projects', B, 'Proyek atau kontrak', 'Tagihan termin, uang muka, dan biaya proyek terkumpul per proyek.', '/projects'),
    I('resources', R, 'Sumber daya dan jadwal', 'Jadwal orang atau alat tidak bentrok; cuti dan jam kerja ikut dihitung.', '/scheduling'),
    I('retainers', R, 'Langganan jasa (retainer)', 'Tagihan rutin bulanan terbit otomatis dan tidak terlewat.', '/retainers'),
    I('leads', R, 'Prospek dan penawaran', 'Calon pelanggan dilacak dari penawaran sampai kontrak.', '/crm'),
  ],
  FMCG: [
    I('priceLists', B, 'Daftar harga bertingkat per segmen outlet', 'Harga outlet, grosir, dan modern trade berbeda; sales tidak perlu mengetik harga.', '/price-lists'),
    I('lots', B, 'Lacak lot dan kedaluwarsa', 'Wajib untuk barang bermasa simpan: menarik barang bermasalah (recall) dan menghindari kedaluwarsa.', '/inventory/expiry'),
    I('creditLimit', B, 'Batas kredit outlet', 'Piutang outlet terbesar risiko distributor; batas kredit menahan pesanan berlebih.', '/customers'),
    I('promos', R, 'Promo dan bonus barang', 'Diskon bertingkat dan bonus dihitung otomatis pada pesanan.', '/promos'),
    I('salesTargets', R, 'Target sales lapangan', 'Pencapaian dan komisi sales terukur per periode.', '/sales-targets'),
    I('tradeTerms', R, 'Syarat dagang modern trade', 'Potongan dan kewajiban ke jaringan ritel dicatat agar klaim tidak terlewat.', '/trade'),
    I('salesRoutes', R, 'Rute kunjungan sales (kanvas)', 'Kunjungan, penjualan van, dan setoran terkontrol per rute.', '/canvass'),
  ],
  MANUFAKTUR: [
    I('boms', B, 'Resep produksi bertingkat', 'Kebutuhan bahan dan harga pokok barang jadi dihitung dari resep, bukan tebakan.', '/production/boms'),
    I('inventoryMethod', B, 'Metode persediaan (rata-rata / FIFO)', 'Menentukan harga pokok bahan yang terpakai dan nilai barang setengah jadi.', '/settings/company'),
    I('workCenters', R, 'Mesin dan pusat kerja', 'Penjadwalan, kapasitas, dan downtime mesin terpantau.', '/production/work-centers'),
    I('qcPlans', R, 'Rencana pengendalian mutu (QC)', 'Barang gagal uji tertahan sebelum masuk stok jadi atau terkirim.', '/production/qc'),
    I('supplierPrices', R, 'Kontrak harga pemasok bahan', 'Harga bahan baku disepakati dan lonjakannya terdeteksi.', '/price-agreements'),
    I('stockMin', R, 'Batas stok minimum bahan', 'Produksi tidak berhenti karena bahan habis.', '/inventory'),
  ],
  FNB: [
    I('boms', B, 'Resep tiap menu', 'Setiap menu terjual memotong bahan otomatis dan menghitung harga pokok per porsi.', '/production/boms'),
    I('localTax', B, 'Pajak restoran daerah (PB1)', 'Penjualan makanan dan minuman kena pajak daerah, bukan PPN; tarifnya mengikuti peraturan daerah Anda.', '/settings/company'),
    I('tables', B, 'Meja dan layar dapur', 'Pesanan dine-in, pisah bill, dan antrean dapur butuh daftar meja.', '/pos/tables'),
    I('platforms', R, 'Komisi platform pesan-antar', 'Penjualan GoFood/GrabFood/ShopeeFood dicatat bersih setelah komisi dan dicocokkan saat pencairan.', '/pos/online'),
    I('shelfLife', R, 'Masa simpan bahan', 'Bahan mudah rusak diingatkan sebelum kedaluwarsa.', '/products'),
    I('recipeTerm', R, 'Istilah "resep" sesuai kebiasaan', 'Sebut sesuai kebiasaan dapur Anda (resep, formula, racikan).', '/settings/company'),
  ],
  UTILITAS: [
    I('tariffs', B, 'Tarif (blok pemakaian dan abonemen)', 'Dasar semua tagihan bulanan; salah tarif berarti salah tagih ke seluruh pelanggan.', '/utility/tarif'),
    I('counters', B, 'Loket pembayaran', 'Pembayaran tunai dan non-tunai dicatat per loket dan direkap harian.', '/utility/lokasi'),
    I('utilRules', B, 'Aturan denda dan pemutusan', 'Batas tunggakan, besar denda, dan jadwal peringatan mengikuti peraturan pengelola.', '/utility/tarif'),
    I('vaSetup', R, 'Virtual account pembayaran', 'Pelanggan membayar lewat bank dan pembayaran masuk otomatis ke tagihannya.', '/utility/va'),
    I('messaging', R, 'Pesan otomatis (WhatsApp/SMS)', 'Tagihan dan peringatan terkirim tanpa petugas mengetik satu per satu.', '/utility/antrean'),
    I('utilRoutes', R, 'Rute baca meter', 'Petugas lapangan membaca meter berurutan per zona; bacaan yang terlewat terlihat.', '/utility/rute'),
  ],
};
