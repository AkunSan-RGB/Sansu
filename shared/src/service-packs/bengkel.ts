import { BEFORE, LATER, setupItem as I } from './helpers.js';
import type { ServiceProfilePack } from './types.js';

export const BENGKEL_PACK: ServiceProfilePack = {
  customerNoun: 'Pelanggan',
  tagline: 'Layanan dan suku cadang di kasir, mekanik per pekerjaan, dan servis armada korporat.',
  terms: {
    words: [
      ['Penjualan bulan ini', 'Pendapatan servis bulan ini'],
      ['Sales Order', 'Pesanan servis'],
      ['Nilai persediaan', 'Nilai suku cadang'],
      ['Supplier', 'Pemasok suku cadang'],
      ['Produk', 'Layanan & suku cadang'],
      ['Gudang', 'Gudang suku cadang'],
      ['Inventori', 'Suku cadang'],
    ],
    exact: { 'Faktur jasa baru': 'Tagihan servis baru', 'Faktur jasa': 'Tagihan servis' },
  },
  workspace: {
    title: 'Bengkel & layanan di kasir',
    tagline: 'Kasir untuk layanan dan suku cadang, mekanik per pekerjaan, stok suku cadang, dan armada korporat.',
    stages: [
      { title: 'Siapkan layanan', desc: 'Daftar layanan dan tarifnya, suku cadang, dan stok minimum.', links: [{ label: 'Layanan & suku cadang', to: '/products' }, { label: 'Stok suku cadang', to: '/inventory' }, { label: 'Karyawan (mekanik)', to: '/employees' }] },
      { title: 'Layani pelanggan', desc: 'Kasir dengan mekanik tercatat per layanan.', links: [{ label: 'Layar kasir', to: '/pos' }, { label: 'Riwayat sesi kasir', to: '/pos/sessions' }, { label: 'Jadwal tim', to: '/scheduling' }] },
      { title: 'Tagih armada korporat', desc: 'Servis perusahaan ditagih bulanan atas kredit.', links: [{ label: 'Tagihan servis baru', to: '/invoices/services/new' }, { label: 'Tagihan servis & piutang', to: '/invoices' }, { label: 'Pelanggan', to: '/customers' }] },
      { title: 'Beli suku cadang', desc: 'Pesan, terima, dan bayar pemasok.', links: [{ label: 'Pesanan pembelian', to: '/purchase-orders' }, { label: 'Tagihan pemasok', to: '/purchase-invoices' }, { label: 'Retur penjualan', to: '/returns?tab=sales' }] },
      { title: 'Komisi & laporan', desc: 'Pendapatan per mekanik, layanan terlaris, dan margin suku cadang.', links: [{ label: 'Gaji jasa (komisi)', to: '/payroll/jasa' }, { label: 'Laporan bengkel', to: '/laporan/jasa-bengkel' }] },
    ],
  },
  setup: [
    I('servicesCatalog', BEFORE, 'Daftar layanan servis dan tarifnya', 'Layanan dijual di kasir tanpa stok; tarif tersimpan sehingga kasir tidak mengetik harga.', '/products'),
    I('partsStock', BEFORE, 'Suku cadang dan stok minimum', 'Suku cadang terjual memotong stok dan harga pokok; stok minimum mengingatkan sebelum habis.', '/inventory'),
    I('posSession', BEFORE, 'Buka kasir dan coba satu transaksi', 'Memastikan kasir, printer struk, dan metode bayar siap sebelum bengkel buka.', '/pos'),
    I('mechanics', LATER, 'Mekanik dan komisinya', 'Mekanik dicatat per baris layanan; komisi dihitung dari pendapatan yang dikerjakan.', '/payroll/jasa'),
    I('fleetCustomers', LATER, 'Pelanggan armada korporat', 'Pelanggan perusahaan memakai termin kredit dan ditagih bulanan.', '/customers'),
    I('leads', LATER, 'Kontrak servis dan calon pelanggan', 'Peluang kontrak servis dilacak sampai aktif.', '/crm'),
  ],
  crm: {
    noun: 'Calon pelanggan servis / armada',
    titleExample: 'PT Armada Prima — servis berkala 20 kendaraan',
    stages: [{ name: 'Pertanyaan masuk', probability: 10 }, { name: 'Inspeksi / penawaran paket servis', probability: 35 }, { name: 'Negosiasi kontrak servis', probability: 65 }, { name: 'Kontrak servis aktif', probability: 90 }],
    sources: ['Datang ke bengkel', 'WhatsApp', 'Media sosial', 'Referensi pelanggan', 'Perusahaan armada', 'Marketplace jasa'],
    lostReasons: ['Harga lebih mahal', 'Lokasi terlalu jauh', 'Memilih bengkel resmi', 'Antrean terlalu lama', 'Tidak jadi servis'],
  },
  product: {
    categories: ['Servis Berkala', 'Perbaikan Mesin', 'Rem & Kaki-kaki', 'Kelistrikan & AC', 'Ban & Velg', 'Cuci & Detailing', 'Oli & Pelumas', 'Suku Cadang', 'Aksesori', 'Lain-lain'],
    baseUoms: ['PEKERJAAN', 'JAM', 'PAKET', 'KUNJUNGAN', 'PCS', 'BOTOL', 'SET', 'UNIT', 'LITER', 'PASANG', 'KG'],
    skuLabel: 'Kode layanan / suku cadang',
    nameLabel: 'Nama layanan / suku cadang',
    baseUomLabel: 'Satuan',
    priceLabel: 'Tarif / harga jual (belum PPN)',
    note: 'Layanan (tanpa stok) dan suku cadang (berstok) dijual bersama di kasir; mekanik dicatat per baris layanan.',
  },
  invoiceTypes: [
    { key: 'FLEET', label: 'Servis armada korporat', hint: 'Tagihan bulanan servis kendaraan perusahaan; pelanggan badan sering memotong PPh 23 atas jasa.', revenueKind: 'FLEET', unit: 'Unit', description: 'Servis berkala armada — ', termLabel: 'Bulanan', withholding: 'PPH23_JASA', withVat: true },
    { key: 'BIG_REPAIR', label: 'Perbaikan besar (di luar kasir)', hint: 'Overhaul atau body repair yang ditagih terpisah dari transaksi kasir.', revenueKind: 'REPAIR', unit: 'Pekerjaan', description: 'Perbaikan — ', withholding: null, withVat: true },
  ],
  costTypes: [
    { key: 'COMMISSION', label: 'Komisi dan bagi hasil mekanik', hint: 'Komisi dari pekerjaan yang dikerjakan.', account: '5-1880' },
    { key: 'CONSUMABLE', label: 'Bahan habis pakai bengkel', hint: 'Lap, gemuk, pembersih, dan limbah oli.', account: '5-1890' },
    { key: 'WARRANTY', label: 'Garansi dan pengerjaan ulang', hint: 'Biaya mengulang pekerjaan yang digaransi.', account: '5-1910' },
    { key: 'RENT', label: 'Sewa tempat bengkel', hint: 'Sewa bengkel dan area parkir.', account: '6-3000' },
    { key: 'UTILITY', label: 'Listrik, air, dan internet', hint: 'Operasional bengkel.', account: '6-4000' },
  ],
  quickActions: [
    { label: 'Buka kasir', desc: 'Layanan dan suku cadang dengan mekanik.', to: '/pos' },
    { label: 'Tagih servis armada', desc: 'Tagihan bulanan pelanggan korporat.', to: '/invoices/services/new' },
    { label: 'Pesan suku cadang', desc: 'Pesanan pembelian ke pemasok.', to: '/purchase-orders' },
    { label: 'Catat komisi mekanik', desc: 'Gaji jasa per pekerjaan.', to: '/payroll/jasa' },
    { label: 'Laporan bengkel', desc: 'Pendapatan per mekanik dan layanan.', to: '/laporan/jasa-bengkel' },
  ],
  kpis: [
    { key: 'b_orders_month', label: 'Transaksi kasir bulan ini', hint: 'Jumlah transaksi kasir bulan berjalan.', format: 'number', to: '/pos/sessions' },
    { key: 'b_service_month', label: 'Pendapatan layanan bulan ini', hint: 'Penjualan layanan tanpa stok di kasir (sebelum pajak).', format: 'money', to: '/laporan/jasa-bengkel' },
    { key: 'b_parts_month', label: 'Penjualan suku cadang bulan ini', hint: 'Penjualan barang berstok di kasir (sebelum pajak).', format: 'money', to: '/laporan/jasa-bengkel' },
    { key: 'b_top_mechanic', label: 'Mekanik teratas bulan ini', hint: 'Mekanik dengan pendapatan layanan terbesar.', format: 'text', to: '/laporan/jasa-bengkel' },
    { key: 'b_low_parts', label: 'Suku cadang di bawah minimum', hint: 'Suku cadang yang stoknya sudah di bawah batas minimum.', format: 'number', to: '/inventory/warehouses?tab=low' },
  ],
  report: { kind: 'jasa-bengkel', label: 'Laporan bengkel', hint: 'Pendapatan per mekanik, layanan terlaris, margin suku cadang, dan piutang armada.' },
  taxFocus: {
    title: 'Bengkel: layanan dan suku cadang',
    points: [
      'PPN atas jasa servis dan penjualan suku cadang berlaku bagi PKP; tentukan apakah harga di kasir sudah termasuk PPN.',
      'Pelanggan armada badan umumnya memotong PPh 23 atas jasa servis (bukan atas suku cadang); catat bukti potongnya.',
      'Komisi mekanik adalah penghasilan yang dipotong PPh 21 sesuai statusnya.',
      'Limbah oli dan bahan berbahaya punya ketentuan pengelolaan tersendiri di luar pajak; simpan bukti pembuangan.',
    ],
  },
};
