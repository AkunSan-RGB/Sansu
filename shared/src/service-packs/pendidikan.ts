import { BEFORE, LATER, setupItem as I } from './helpers.js';
import type { ServiceProfilePack } from './types.js';

export const PENDIDIKAN_PACK: ServiceProfilePack = {
  customerNoun: 'Wali / peserta',
  tagline: 'Kelas dan peserta, SPP bulanan per wali, tunggakan, dan honor pengajar.',
  terms: {
    words: [
      ['Faktur & piutang', 'SPP & piutang'],
      ['Faktur terbaru', 'Tagihan terbaru'],
      ['Penjualan bulan ini', 'Pendapatan bulan ini'],
      ['Sales Order', 'Pendaftaran'],
      ['Nilai persediaan', 'Nilai modul & perlengkapan'],
      ['Pelanggan', 'Wali / peserta'],
      ['Supplier', 'Pemasok modul & perlengkapan'],
      ['Produk', 'Kelas, modul & perlengkapan'],
      ['Gudang', 'Lemari modul'],
      ['Inventori', 'Modul & perlengkapan'],
    ],
    exact: { 'Faktur jasa baru': 'Tagihan baru (pendaftaran / kelas)', 'Faktur jasa': 'Tagihan peserta' },
  },
  workspace: {
    title: 'Pendidikan & kursus',
    tagline: 'Pendaftaran, kelas, SPP bulanan, penagihan tunggakan, dan honor pengajar.',
    stages: [
      { title: 'Terima peserta', desc: 'Calon peserta sampai terdaftar dan membayar uang pendaftaran.', links: [{ label: 'Pipeline calon peserta', to: '/crm' }, { label: 'Wali / peserta', to: '/customers' }, { label: 'Tagihan pendaftaran', to: '/invoices/services/new' }] },
      { title: 'Atur kelas', desc: 'Kelas, kapasitas, SPP bulanan, dan peserta tiap kelas.', links: [{ label: 'Kelas & SPP', to: '/education' }] },
      { title: 'Tagih SPP', desc: 'SPP bulanan ditagih per wali; pantau yang menunggak.', links: [{ label: 'Kelas & SPP', to: '/education' }, { label: 'SPP & piutang', to: '/invoices' }] },
      { title: 'Pengajar & operasional', desc: 'Honor per sesi, modul, dan biaya kelas.', links: [{ label: 'Gaji jasa (honor per sesi)', to: '/payroll/jasa' }, { label: 'Karyawan', to: '/employees' }, { label: 'Tagihan pemasok', to: '/purchase-invoices' }] },
      { title: 'Laporan', desc: 'SPP per kelas, tunggakan, dan pendapatan per jenis.', links: [{ label: 'Laporan pendidikan', to: '/laporan/jasa-pendidikan' }] },
    ],
  },
  setup: [
    I('eduClasses', BEFORE, 'Kelas dan SPP bulanan', 'Dasar tagihan: tanpa kelas dan tarif SPP, penagihan bulanan tidak bisa berjalan.', '/education'),
    I('eduEnroll', BEFORE, 'Peserta dan wali', 'Tiap peserta terhubung ke wali yang ditagih; diskon saudara atau beasiswa diatur per peserta.', '/education'),
    I('eduBilled', LATER, 'Tagih SPP bulan pertama', 'Penagihan massal satu periode membuat tagihan per wali dan mencegah tagihan ganda.', '/education'),
    I('serviceRates', LATER, 'Tarif honor pengajar per sesi', 'Honor pengajar dihitung dari sesi yang diajar dan masuk slip gaji.', '/payroll/jasa'),
    I('leads', LATER, 'Calon peserta dan lembaga', 'Pertanyaan masuk dilacak sampai mendaftar.', '/crm'),
  ],
  crm: {
    noun: 'Calon peserta / lembaga',
    titleExample: 'Bu Rina — kelas matematika SMP untuk 2 anak',
    stages: [{ name: 'Pertanyaan masuk', probability: 10 }, { name: 'Kelas percobaan / observasi', probability: 30 }, { name: 'Penawaran paket & biaya', probability: 55 }, { name: 'Daftar & bayar pendaftaran', probability: 85 }],
    sources: ['Referensi wali / alumni', 'Media sosial', 'Spanduk & brosur', 'Kerja sama sekolah', 'Website', 'Pameran pendidikan'],
    lostReasons: ['Biaya terlalu mahal', 'Jadwal tidak cocok', 'Memilih lembaga lain', 'Lokasi terlalu jauh', 'Tidak jadi mendaftar'],
  },
  product: {
    categories: ['Kelas Reguler', 'Kelas Intensif / Persiapan Ujian', 'Les Privat', 'Pelatihan Korporat / Sekolah', 'Modul & Buku', 'Seragam & Perlengkapan', 'Biaya Pendaftaran', 'Lain-lain'],
    baseUoms: ['BULAN', 'SESI', 'JAM', 'ORANG', 'PAKET', 'TAHUN', 'HARI', 'PCS', 'SET', 'UNIT'],
    skuLabel: 'Kode kelas / modul',
    nameLabel: 'Nama kelas / modul',
    baseUomLabel: 'Satuan',
    priceLabel: 'Biaya per satuan (belum PPN)',
    note: 'SPP bulanan diatur per kelas di Kelas & SPP. Daftar ini untuk biaya pendaftaran, modul, seragam, dan paket pelatihan.',
  },
  invoiceTypes: [
    { key: 'REGISTRATION', label: 'Uang pendaftaran', hint: 'Biaya satu kali saat peserta baru mendaftar; terpisah dari SPP bulanan.', revenueKind: 'EDU_REG', unit: 'Peserta', description: 'Uang pendaftaran — ', termLabel: 'Pendaftaran', withholding: null, withVat: false },
    { key: 'PRIVATE', label: 'Les privat / paket sesi', hint: 'Paket sesi di luar kelas reguler.', revenueKind: 'EDU_FEE', unit: 'Sesi', description: 'Les privat — ', withholding: null, withVat: false },
    { key: 'CORPORATE', label: 'Pelatihan untuk sekolah / perusahaan', hint: 'Pelatihan guru atau karyawan; pelanggan badan sering memotong PPh 23.', revenueKind: 'EDU_CORP', unit: 'Paket', description: 'Pelatihan — ', termLabel: 'Pelatihan', withholding: 'PPH23_JASA', withVat: false },
  ],
  costTypes: [
    { key: 'HONOR', label: 'Honor pengajar (per sesi)', hint: 'Honor pengajar lepas atau tidak tetap.', account: '5-1810' },
    { key: 'MATERIAL', label: 'Modul dan bahan ajar', hint: 'Cetak modul dan alat peraga yang dipakai kelas.', account: '5-1820' },
    { key: 'ROOM', label: 'Sewa ruang dan fasilitas belajar', hint: 'Ruang kelas yang disewa per periode.', account: '5-1830' },
    { key: 'PROMO', label: 'Promosi penerimaan siswa', hint: 'Spanduk, iklan, dan brosur.', account: '6-2100' },
    { key: 'UTILITY', label: 'Listrik, air, dan internet', hint: 'Operasional gedung belajar.', account: '6-4000' },
  ],
  quickActions: [
    { label: 'Daftarkan peserta', desc: 'Kelas, wali, dan diskon.', to: '/education' },
    { label: 'Tagih SPP bulan ini', desc: 'Tagihan massal per wali.', to: '/education' },
    { label: 'Tagihan pendaftaran / pelatihan', desc: 'Tagihan di luar SPP.', to: '/invoices/services/new' },
    { label: 'Catat sesi mengajar', desc: 'Honor pengajar per sesi.', to: '/payroll/jasa' },
    { label: 'Laporan pendidikan', desc: 'SPP per kelas dan tunggakan.', to: '/laporan/jasa-pendidikan' },
  ],
  kpis: [
    { key: 'e_students_active', label: 'Peserta aktif', hint: 'Peserta yang belum keluar dari kelas.', format: 'number', to: '/education' },
    { key: 'e_fee_month', label: 'SPP ditagih bulan ini', hint: 'Jumlah SPP periode berjalan.', format: 'money', to: '/education' },
    { key: 'e_arrears', label: 'Tunggakan SPP', hint: 'SPP yang sudah jatuh tempo dan belum dibayar.', format: 'money', to: '/laporan/jasa-pendidikan' },
    { key: 'e_collection_pct', label: 'Tingkat penagihan 3 bulan', hint: 'SPP terbayar dibanding SPP ditagih tiga bulan terakhir.', format: 'percent', to: '/laporan/jasa-pendidikan' },
    { key: 'e_class_fill_pct', label: 'Keterisian kelas', hint: 'Peserta aktif dibanding kapasitas kelas yang berkapasitas.', format: 'percent', to: '/education' },
  ],
  report: { kind: 'jasa-pendidikan', label: 'Laporan pendidikan', hint: 'SPP per kelas, tunggakan per wali, mutasi peserta, dan pendapatan per jenis.' },
  taxFocus: {
    title: 'Pendidikan: SPP dan pelatihan',
    points: [
      'Jasa pendidikan yang memenuhi syarat umumnya dibebaskan dari PPN; periksa pengaturan PPN pada tiap tagihan sebelum menerbitkan.',
      'Honor pengajar lepas dipotong PPh 21 sesuai statusnya; pengajar tetap masuk penggajian biasa.',
      'Pelatihan untuk perusahaan atau sekolah: pelanggan badan sering memotong PPh 23; catat bukti potong.',
      'Penghasilan lembaga mengikuti skema pajak badan atau PPh final UMKM sesuai pengaturan perusahaan.',
    ],
  },
};
