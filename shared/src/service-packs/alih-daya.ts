import { BEFORE, LATER, setupItem as I } from './helpers.js';
import type { ServiceProfilePack } from './types.js';

export const ALIH_DAYA_PACK: ServiceProfilePack = {
  customerNoun: 'Pengguna jasa',
  tagline: 'Kontrak per lokasi, pos jaga, jadwal petugas, dan tagihan bulanan dengan potongan kekurangan petugas.',
  terms: {
    words: [
      ['Faktur & piutang', 'Tagihan layanan & piutang'],
      ['Penjualan bulan ini', 'Tagihan layanan bulan ini'],
      ['Sales Order', 'Perjanjian layanan'],
      ['Nilai persediaan', 'Nilai perlengkapan petugas'],
      ['Pelanggan', 'Pengguna jasa'],
      ['Supplier', 'Pemasok perlengkapan'],
      ['Produk', 'Layanan & perlengkapan petugas'],
      ['Gudang', 'Gudang perlengkapan'],
      ['Inventori', 'Perlengkapan petugas'],
    ],
    exact: { 'Faktur jasa baru': 'Tagihan layanan baru', 'Faktur jasa': 'Tagihan layanan' },
  },
  workspace: {
    title: 'Alih daya (keamanan & kebersihan)',
    tagline: 'Kontrak per lokasi, jadwal jaga petugas, tagihan bulanan, dan margin per lokasi.',
    stages: [
      { title: 'Dapatkan kontrak', desc: 'Calon pengguna jasa sampai kontrak kerja sama.', links: [{ label: 'Pipeline calon pengguna jasa', to: '/crm' }, { label: 'Penawaran harga', to: '/quotations' }, { label: 'Pengguna jasa', to: '/customers' }] },
      { title: 'Atur lokasi & petugas', desc: 'Kontrak per lokasi, pos jaga, dan jumlah petugas.', links: [{ label: 'Kontrak per lokasi', to: '/sites' }, { label: 'Karyawan (petugas)', to: '/employees' }] },
      { title: 'Jadwalkan jaga', desc: 'Petugas ditempatkan per pos dan per hari.', links: [{ label: 'Jadwal jaga', to: '/sites' }, { label: 'Cuti', to: '/leaves' }, { label: 'Absensi', to: '/attendance' }] },
      { title: 'Tagih bulanan', desc: 'Tagihan per lokasi dengan potongan bila petugas kurang dari kontrak.', links: [{ label: 'Kontrak per lokasi', to: '/sites' }, { label: 'Tagihan layanan baru', to: '/invoices/services/new' }, { label: 'Tagihan layanan & piutang', to: '/invoices' }] },
      { title: 'Biaya & laporan', desc: 'Perlengkapan petugas, gaji, dan margin per lokasi.', links: [{ label: 'Tagihan pemasok perlengkapan', to: '/purchase-invoices' }, { label: 'Penggajian', to: '/payroll' }, { label: 'Laporan alih daya', to: '/laporan/jasa-alihdaya' }] },
    ],
  },
  setup: [
    I('siteContracts', BEFORE, 'Kontrak per lokasi dan pos jaga', 'Dasar tagihan bulanan: pos jaga dengan jumlah petugas dan tarif per petugas.', '/sites'),
    I('dutyRoster', BEFORE, 'Jadwal jaga petugas', 'Kekurangan petugas dihitung dari jadwal dan dipotong dari tagihan sesuai kontrak.', '/sites'),
    I('fieldStaff', BEFORE, 'Data petugas lapangan', 'Satpam dan petugas kebersihan terdaftar sebagai karyawan untuk jadwal dan penggajian.', '/employees'),
    I('sitesBilled', LATER, 'Tagih bulan pertama', 'Penagihan per lokasi membuat tagihan dan mencatat potongan kekurangan petugas.', '/sites'),
    I('supplierPrices', LATER, 'Harga pemasok perlengkapan', 'Seragam dan bahan kebersihan dibeli dengan harga disepakati.', '/price-agreements'),
    I('leads', LATER, 'Tender dan calon pengguna jasa', 'Peluang kontrak baru dilacak sampai tanda tangan.', '/crm'),
  ],
  crm: {
    noun: 'Calon pengguna jasa',
    titleExample: 'Gedung Perkantoran Sentral — 12 petugas kebersihan & keamanan',
    stages: [{ name: 'Permintaan masuk', probability: 10 }, { name: 'Survei lokasi & kebutuhan petugas', probability: 30 }, { name: 'Penawaran harga per pos', probability: 55 }, { name: 'Negosiasi & kontrak kerja sama', probability: 80 }],
    sources: ['Tender / lelang gedung', 'Referensi pengelola gedung', 'Kunjungan', 'Website', 'Asosiasi / komunitas', 'Telepon masuk'],
    lostReasons: ['Harga per petugas terlalu tinggi', 'Pengguna jasa memilih vendor lain', 'Kontrak tetap dengan vendor lama', 'Anggaran belum tersedia', 'Syarat SLA tidak terpenuhi'],
  },
  product: {
    categories: ['Layanan Keamanan (Satpam)', 'Layanan Kebersihan (Cleaning)', 'Layanan Tambahan', 'Seragam & Perlengkapan Petugas', 'Bahan Kebersihan', 'Peralatan Kebersihan', 'Lain-lain'],
    baseUoms: ['BULAN', 'ORANG', 'HARI', 'JAM', 'PAKET', 'SET', 'PCS', 'JERIGEN', 'DUS', 'UNIT'],
    skuLabel: 'Kode layanan / perlengkapan',
    nameLabel: 'Nama layanan / perlengkapan',
    baseUomLabel: 'Satuan',
    priceLabel: 'Tarif / harga per satuan (belum PPN)',
    note: 'Tarif per petugas diatur di kontrak per lokasi. Daftar ini untuk layanan tambahan dan perlengkapan (seragam, bahan kebersihan).',
  },
  invoiceTypes: [
    { key: 'EXTRA', label: 'Layanan tambahan sekali pakai', hint: 'General cleaning, event, atau pekerjaan di luar kontrak bulanan.', revenueKind: 'SITE_EXTRA', unit: 'Paket', description: 'Layanan tambahan — ', termLabel: 'Layanan tambahan', withholding: 'PPH23_JASA', withVat: true },
    { key: 'TEMP_SECURITY', label: 'Tenaga keamanan sementara', hint: 'Petugas keamanan untuk acara atau periode pendek.', revenueKind: 'SITE_SECURITY', unit: 'Orang-hari', description: 'Tenaga keamanan sementara — ', termLabel: 'Sementara', withholding: 'PPH23_JASA', withVat: true },
    { key: 'TEMP_CLEANING', label: 'Tenaga kebersihan sementara', hint: 'Petugas kebersihan untuk acara atau periode pendek.', revenueKind: 'SITE_CLEANING', unit: 'Orang-hari', description: 'Tenaga kebersihan sementara — ', termLabel: 'Sementara', withholding: 'PPH23_JASA', withVat: true },
  ],
  costTypes: [
    { key: 'UNIFORM', label: 'Seragam dan perlengkapan petugas', hint: 'Seragam, sepatu, dan atribut petugas.', account: '5-1840' },
    { key: 'SUPPLIES', label: 'Bahan dan peralatan kebersihan habis pakai', hint: 'Cairan, kantong sampah, dan alat sekali pakai di lokasi.', account: '5-1850' },
    { key: 'TRAINING', label: 'Pelatihan dan sertifikasi petugas', hint: 'Pelatihan satpam, K3, dan kebersihan.', account: '5-1860' },
    { key: 'OVERTIME', label: 'Lembur dan petugas pengganti', hint: 'Biaya menutup kekurangan petugas.', account: '5-1870' },
    { key: 'SUBCON', label: 'Subkontraktor', hint: 'Pekerjaan yang dialihkan ke vendor lain.', account: '5-1500' },
    { key: 'FUEL', label: 'BBM patroli dan antar bahan', hint: 'Transportasi ke lokasi.', account: '6-2000' },
  ],
  quickActions: [
    { label: 'Buat kontrak lokasi', desc: 'Pos jaga, jumlah petugas, dan tarif.', to: '/sites' },
    { label: 'Atur jadwal jaga', desc: 'Petugas per pos dan per hari.', to: '/sites' },
    { label: 'Tagih kontrak bulan ini', desc: 'Tagihan per lokasi dengan potongan kekurangan.', to: '/sites' },
    { label: 'Tagihan layanan tambahan', desc: 'General cleaning atau tenaga sementara.', to: '/invoices/services/new' },
    { label: 'Laporan alih daya', desc: 'Margin per lokasi dan keterisian jaga.', to: '/laporan/jasa-alihdaya' },
  ],
  kpis: [
    { key: 'a_sites_active', label: 'Kontrak lokasi aktif', hint: 'Kontrak per lokasi yang berjalan.', format: 'number', to: '/sites' },
    { key: 'a_staffing_pct', label: 'Keterisian jaga bulan ini', hint: 'Hari-orang terjadwal dibanding kebutuhan kontrak.', format: 'percent', to: '/laporan/jasa-alihdaya' },
    { key: 'a_billing_month', label: 'Tagihan kontrak bulan ini', hint: 'Tagihan per lokasi yang terbit bulan ini (sebelum PPN).', format: 'money', to: '/sites' },
    { key: 'a_shortfall_month', label: 'Hari-orang kurang bulan lalu', hint: 'Kekurangan petugas yang dipotong dari tagihan bulan lalu.', format: 'number', to: '/laporan/jasa-alihdaya' },
    { key: 'a_ar_overdue', label: 'Piutang kontrak lewat jatuh tempo', hint: 'Tagihan kontrak lokasi yang lewat jatuh tempo.', format: 'money', to: '/invoices' },
  ],
  report: { kind: 'jasa-alihdaya', label: 'Laporan alih daya', hint: 'Margin per lokasi, keterisian jaga per pos, kekurangan petugas, dan hari jaga per petugas.' },
  taxFocus: {
    title: 'Alih daya: tagihan per lokasi',
    points: [
      'Pengguna jasa badan umumnya memotong PPh 23 atas jasa; dasar pemotongan (seluruh tagihan atau hanya biaya manajemen) mengikuti kontrak dan ketentuan terbaru — tetapkan bersama konsultan pajak.',
      'PPN atas tagihan jasa berlaku bagi PKP; pastikan dasar pengenaannya sesuai kontrak.',
      'Petugas lapangan adalah karyawan: PPh 21, BPJS, dan upah minimum berlaku; lembur dan pengganti dicatat sebagai biaya layanan.',
      'Potongan karena petugas kurang mengurangi tagihan, sehingga mengurangi dasar PPN dan PPh yang dipotong.',
    ],
  },
};
