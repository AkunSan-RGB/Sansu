import type { BusinessModel } from './apps';

/**
 * Ruang kerja per jenis usaha (ERP vertikal): alur kerja khas jenis usaha itu dari awal sampai laporan, dengan tautan ke halaman yang
 * mengerjakannya. Halaman Ruang kerja hanya menampilkan tautan yang memang terlihat di menu pengguna (peran, aplikasi, jenis usaha).
 */
export interface WorkspaceLink {
  label: string;
  to: string;
}
export interface WorkspaceStage {
  title: string;
  desc: string;
  links: WorkspaceLink[];
}
export interface WorkspaceDef {
  title: string;
  tagline: string;
  stages: WorkspaceStage[];
}

export const MODEL_WORKSPACE: Record<BusinessModel, WorkspaceDef> = {
  DAGANG: {
    title: 'Dagang & distribusi',
    tagline: 'Beli dari pemasok, simpan, jual ke pelanggan kredit, kirim, tagih.',
    stages: [
      { title: 'Siapkan', desc: 'Data induk dan aturan harga yang harus ada lebih dulu.', links: [{ label: 'Produk', to: '/products' }, { label: 'Pelanggan', to: '/customers' }, { label: 'Daftar harga', to: '/price-lists' }, { label: 'Kontrak harga pemasok', to: '/price-agreements' }] },
      { title: 'Jual & kirim', desc: 'Dari penawaran sampai barang sampai ke pelanggan.', links: [{ label: 'Penawaran harga', to: '/quotations' }, { label: 'Sales Order', to: '/sales-orders' }, { label: 'Surat jalan', to: '/deliveries' }, { label: 'Rute pengiriman', to: '/delivery-trips' }] },
      { title: 'Tagih', desc: 'Faktur, piutang, dan uang muka pelanggan.', links: [{ label: 'Faktur & piutang', to: '/invoices' }, { label: 'Uang muka pelanggan', to: '/customer-deposits' }, { label: 'Retur penjualan', to: '/returns?tab=sales' }] },
      { title: 'Beli & stok', desc: 'Pengadaan dan persediaan di gudang.', links: [{ label: 'Permintaan pembelian', to: '/purchase-requests' }, { label: 'Pesanan pembelian', to: '/purchase-orders' }, { label: 'Penerimaan barang', to: '/goods-receipts' }, { label: 'Stok barang', to: '/inventory' }] },
      { title: 'Kontrol & laporan', desc: 'Pastikan penjualan dan piutang sehat.', links: [{ label: 'Kontrol penjualan', to: '/sales-controls' }, { label: 'Laporan penjualan', to: '/laporan/sales' }, { label: 'Laporan persediaan', to: '/laporan/inventory' }] },
    ],
  },
  RITEL: {
    title: 'Ritel & toko',
    tagline: 'Kasir cepat, stok toko terjaga, uang kartu/QRIS cocok dengan rekening.',
    stages: [
      { title: 'Siapkan toko', desc: 'Produk, barcode, rak, dan program pelanggan.', links: [{ label: 'Produk', to: '/products' }, { label: 'Gudang & rak', to: '/inventory/warehouses' }, { label: 'Program loyalitas', to: '/pos/loyalty' }] },
      { title: 'Layani pembeli', desc: 'Transaksi kasir, shift, dan retur.', links: [{ label: 'Layar kasir', to: '/pos' }, { label: 'Riwayat sesi kasir', to: '/pos/sessions' }, { label: 'Retur penjualan', to: '/returns?tab=sales' }, { label: 'Jadwal shift', to: '/shifts' }] },
      { title: 'Cocokkan uang', desc: 'Pencairan QRIS/kartu dan kas harian.', links: [{ label: 'Pencairan QRIS/kartu', to: '/pos/settlements' }, { label: 'Kas & bank', to: '/cash' }] },
      { title: 'Stok & belanja', desc: 'Isi ulang barang dan hitung stok.', links: [{ label: 'Stok barang', to: '/inventory' }, { label: 'Opname stok', to: '/inventory/counts' }, { label: 'Pesanan pembelian', to: '/purchase-orders' }, { label: 'Penerimaan barang', to: '/goods-receipts' }] },
      { title: 'Laporan', desc: 'Penjualan kasir dan kontrol persediaan.', links: [{ label: 'Laporan kasir', to: '/laporan/pos' }, { label: 'Laporan persediaan', to: '/laporan/inventory' }] },
    ],
  },
  JASA: {
    title: 'Jasa & proyek',
    tagline: 'Penawaran, proyek, jam kerja, lalu tagihan tepat waktu.',
    stages: [
      { title: 'Dapatkan klien', desc: 'Calon klien sampai kesepakatan.', links: [{ label: 'Pipeline calon klien', to: '/crm' }, { label: 'Penawaran harga', to: '/quotations' }, { label: 'Pelanggan', to: '/customers' }] },
      { title: 'Kerjakan', desc: 'Pekerjaan menurut profil layanan Anda (Pengaturan › Jenis usaha): proyek, jam kerja, kelas, kontrak lokasi, atau layanan di kasir.', links: [{ label: 'Proyek & termin', to: '/projects' }, { label: 'Jadwal tim', to: '/scheduling' }, { label: 'Lembar waktu', to: '/timesheets' }, { label: 'Retainer', to: '/retainers' }, { label: 'Kelas & SPP', to: '/education' }, { label: 'Kontrak per lokasi', to: '/sites' }, { label: 'Layar kasir layanan', to: '/pos' }] },
      { title: 'Tagih', desc: 'Faktur termin, uang muka, dan piutang.', links: [{ label: 'Faktur & piutang', to: '/invoices' }, { label: 'Uang muka pelanggan', to: '/customer-deposits' }] },
      { title: 'Tim', desc: 'Karyawan, cuti, dan gaji per pekerjaan.', links: [{ label: 'Karyawan', to: '/employees' }, { label: 'Cuti', to: '/leaves' }, { label: 'Gaji jasa', to: '/payroll/jasa' }] },
      { title: 'Laporan', desc: 'Kinerja proyek dan utilisasi.', links: [{ label: 'Laporan jasa & proyek', to: '/laporan/jasa' }] },
    ],
  },
  FMCG: {
    title: 'FMCG & distributor',
    tagline: 'Harga bertingkat, promo, sales lapangan, lot dan kedaluwarsa, klaim prinsipal.',
    stages: [
      { title: 'Atur harga & promo', desc: 'Segmen outlet, bonus barang, target sales.', links: [{ label: 'Daftar harga', to: '/price-lists' }, { label: 'Promo & bonus barang', to: '/promos' }, { label: 'Target & komisi sales', to: '/sales-targets' }, { label: 'Kontrak harga prinsipal', to: '/price-agreements' }] },
      { title: 'Jual & distribusi', desc: 'Pesanan outlet, kanvas, dan pengiriman.', links: [{ label: 'Sales Order', to: '/sales-orders' }, { label: 'Kanvas (van sales)', to: '/canvass' }, { label: 'Rute pengiriman', to: '/delivery-trips' }, { label: 'Faktur & piutang', to: '/invoices' }] },
      { title: 'Retur & klaim', desc: 'Tukar-guling, titipan outlet, modern trade.', links: [{ label: 'Retur penjualan', to: '/returns?tab=sales' }, { label: 'Tukar-guling', to: '/goods-swaps' }, { label: 'Konsinyasi', to: '/consignments' }, { label: 'Modern trade & klaim', to: '/trade' }] },
      { title: 'Lot & kedaluwarsa', desc: 'Telusuri lot untuk recall dan jaga FEFO.', links: [{ label: 'Telusuri lot (recall)', to: '/inventory/lot-trace' }, { label: 'Kedaluwarsa', to: '/inventory/expiry' }, { label: 'Stok barang', to: '/inventory' }] },
      { title: 'Laporan', desc: 'Kinerja sales dan trade promo.', links: [{ label: 'Laporan FMCG', to: '/laporan/fmcg' }, { label: 'Laporan penjualan', to: '/laporan/sales' }] },
    ],
  },
  MANUFAKTUR: {
    title: 'Manufaktur',
    tagline: 'Resep produksi, kebutuhan bahan, perintah produksi, mutu, hasil jadi.',
    stages: [
      { title: 'Siapkan', desc: 'Produk, komposisi bahan, dan mesin.', links: [{ label: 'Produk', to: '/products' }, { label: 'Resep produksi (BOM)', to: '/production/boms' }, { label: 'Pusat kerja & jadwal mesin', to: '/production/work-centers' }] },
      { title: 'Siapkan bahan', desc: 'Hitung kebutuhan lalu beli.', links: [{ label: 'Kebutuhan bahan', to: '/production/requirements' }, { label: 'Pesanan pembelian', to: '/purchase-orders' }, { label: 'Penerimaan barang', to: '/goods-receipts' }] },
      { title: 'Produksi & mutu', desc: 'Perintah produksi dan pemeriksaan mutu.', links: [{ label: 'Perintah produksi', to: '/production/orders' }, { label: 'Pengendalian mutu', to: '/production/qc' }, { label: 'Selisih biaya', to: '/production/variance' }] },
      { title: 'Jual hasil', desc: 'Kirim barang jadi dan tagih.', links: [{ label: 'Sales Order', to: '/sales-orders' }, { label: 'Surat jalan', to: '/deliveries' }, { label: 'Faktur & piutang', to: '/invoices' }] },
      { title: 'Laporan', desc: 'Hasil dan biaya produksi.', links: [{ label: 'Laporan produksi', to: '/production/report' }, { label: 'Laporan manufaktur', to: '/laporan/mfg' }, { label: 'Stok barang', to: '/inventory' }] },
    ],
  },
  FNB: {
    title: 'Restoran & kafe (F&B)',
    tagline: 'Menu dan resep, meja, dapur, pesanan online, bahan terpotong otomatis.',
    stages: [
      { title: 'Menu & bahan', desc: 'Menu, resep, dan harga bahan.', links: [{ label: 'Menu & bahan', to: '/products' }, { label: 'Resep', to: '/production/boms' }, { label: 'Harga pemasok bahan', to: '/price-agreements' }, { label: 'Daftar belanja', to: '/shopping-list' }] },
      { title: 'Layani tamu', desc: 'Kasir, meja, dapur, dan pesan-antar.', links: [{ label: 'Layar kasir', to: '/pos' }, { label: 'Meja & pesanan', to: '/pos/tables' }, { label: 'Layar dapur', to: '/pos/kitchen' }, { label: 'Pesanan online', to: '/pos/online' }] },
      { title: 'Tutup hari', desc: 'Sesi kasir dan pencairan platform.', links: [{ label: 'Riwayat sesi kasir', to: '/pos/sessions' }, { label: 'Pencairan QRIS/kartu', to: '/pos/settlements' }] },
      { title: 'Bahan & stok', desc: 'Kedaluwarsa dan opname bahan.', links: [{ label: 'Kedaluwarsa', to: '/inventory/expiry' }, { label: 'Opname stok', to: '/inventory/counts' }, { label: 'Stok bahan', to: '/inventory' }] },
      { title: 'Laporan', desc: 'Penjualan dan kontrol F&B.', links: [{ label: 'Laporan F&B', to: '/laporan/fnb' }, { label: 'Laporan kasir', to: '/laporan/pos' }, { label: 'Program loyalitas', to: '/pos/loyalty' }] },
    ],
  },
  UTILITAS: {
    title: 'Utilitas air bersih',
    tagline: 'Pelanggan dan sambungan, catat meter, tagih bulanan, loket, tunggakan, pengaduan.',
    stages: [
      { title: 'Pelanggan & sambungan', desc: 'Pelanggan baru sampai sambungan aktif.', links: [{ label: 'Ringkasan layanan air', to: '/utility/ringkasan' }, { label: 'Pelanggan', to: '/customers' }, { label: 'Permohonan sambungan', to: '/utility/permohonan' }, { label: 'Sambungan & meter', to: '/utility/sambungan' }] },
      { title: 'Catat & tagih', desc: 'Baca meter lalu tagih per periode.', links: [{ label: 'Pencatatan meter', to: '/utility/meter' }, { label: 'Rute baca meter', to: '/utility/rute' }, { label: 'Tagihan bulanan', to: '/utility/tagihan' }, { label: 'Tarif', to: '/utility/tarif' }] },
      { title: 'Bayar & tagih tunggakan', desc: 'Loket, virtual account, dan penagihan.', links: [{ label: 'Loket pembayaran', to: '/utility/loket' }, { label: 'Virtual account', to: '/utility/va' }, { label: 'Tunggakan', to: '/utility/tunggakan' }, { label: 'Penagihan lapangan', to: '/utility/penagihan' }] },
      { title: 'Layanan & jaringan', desc: 'Pengaduan, perintah kerja, dan aset jaringan.', links: [{ label: 'Pengaduan & gangguan', to: '/utility/pengaduan' }, { label: 'Perintah kerja', to: '/utility/perintah-kerja' }, { label: 'Aset jaringan', to: '/utility/aset' }] },
      { title: 'Laporan', desc: 'Kinerja layanan dan kehilangan air.', links: [{ label: 'Laporan layanan air', to: '/laporan/utility' }, { label: 'Kinerja layanan', to: '/laporan/utility-kinerja' }, { label: 'Layanan non-air', to: '/laporan/utility-nonair' }] },
    ],
  },
};
