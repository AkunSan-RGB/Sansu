import { BEFORE, LATER, setupItem as I } from './helpers.js';
import type { ServiceProfilePack } from './types.js';

export const KONSULTAN_PACK: ServiceProfilePack = {
  customerNoun: 'Klien',
  tagline: 'Proyek, jam kerja yang ditagih, retainer bulanan, dan utilisasi tim.',
  terms: {
    words: [
      ['Produk', 'Layanan & lisensi'],
      ['Sales Order', 'Perjanjian kerja'],
    ],
  },
  workspace: {
    title: 'Konsultan & profesional',
    tagline: 'Proposal, jam kerja, tagihan tepat waktu, dan retainer yang tidak terlewat.',
    stages: [
      { title: 'Dapatkan klien', desc: 'Calon klien sampai proposal disetujui.', links: [{ label: 'Pipeline calon klien', to: '/crm' }, { label: 'Penawaran harga', to: '/quotations' }, { label: 'Klien', to: '/customers' }] },
      { title: 'Kerjakan', desc: 'Proyek, jadwal tim, dan jam kerja.', links: [{ label: 'Proyek & termin', to: '/projects' }, { label: 'Jadwal tim', to: '/scheduling' }, { label: 'Lembar waktu', to: '/timesheets' }] },
      { title: 'Tagih', desc: 'Tagih jam disetujui, milestone proyek, dan retainer bulanan.', links: [{ label: 'Tagihan jasa baru', to: '/invoices/services/new' }, { label: 'Retainer', to: '/retainers' }, { label: 'Tagihan & piutang', to: '/invoices' }] },
      { title: 'Tim', desc: 'Karyawan, cuti, dan gaji per pekerjaan.', links: [{ label: 'Karyawan', to: '/employees' }, { label: 'Cuti', to: '/leaves' }, { label: 'Gaji jasa', to: '/payroll/jasa' }] },
      { title: 'Laporan', desc: 'Utilisasi, jam belum ditagih, dan retainer.', links: [{ label: 'Laporan konsultan', to: '/laporan/jasa-konsultan' }] },
    ],
  },
  setup: [
    I('serviceRates', BEFORE, 'Tarif jasa per jam atau sesi', 'Jam kerja ditagih dengan tarif yang konsisten dan bisa ditelusuri per karyawan atau proyek.', '/timesheets'),
    I('projects', BEFORE, 'Proyek atau kontrak', 'Tagihan milestone dan biaya proyek terkumpul per proyek.', '/projects'),
    I('resources', LATER, 'Sumber daya dan jadwal', 'Jadwal tim tidak bentrok; cuti dan jam kerja ikut dihitung.', '/scheduling'),
    I('retainers', LATER, 'Langganan jasa (retainer)', 'Tagihan rutin bulanan terbit otomatis dan tidak terlewat.', '/retainers'),
    I('leads', LATER, 'Prospek dan proposal', 'Calon klien dilacak dari proposal sampai kontrak.', '/crm'),
  ],
  crm: {
    noun: 'Calon klien',
    titleExample: 'PT Maju — audit proses dan rekomendasi sistem',
    stages: [{ name: 'Prospek baru', probability: 10 }, { name: 'Diskusi kebutuhan / brief', probability: 25 }, { name: 'Proposal dikirim', probability: 50 }, { name: 'Negosiasi & kontrak', probability: 75 }],
    sources: ['Referensi klien', 'Jaringan profesional', 'Website / konten', 'Webinar & event', 'Tender / RFP', 'Media sosial'],
    lostReasons: ['Anggaran klien tidak cukup', 'Klien memilih konsultan lain', 'Proyek ditunda', 'Lingkup tidak sesuai', 'Tidak ada respon'],
  },
  product: {
    categories: ['Konsultasi Manajemen', 'Konsultasi TI & Pengembangan', 'Desain & Kreatif', 'Hukum, Akuntansi & Pajak', 'Riset & Analisis', 'Pelatihan & Workshop', 'Langganan / Retainer', 'Lisensi & Perangkat', 'Lain-lain'],
    baseUoms: ['JAM', 'HARI', 'PAKET', 'PROYEK', 'BULAN', 'SESI', 'LAPORAN', 'DOKUMEN', 'LISENSI', 'ORANG', 'UNIT'],
    skuLabel: 'Kode layanan',
    nameLabel: 'Nama layanan',
    baseUomLabel: 'Satuan tarif',
    priceLabel: 'Tarif per satuan (belum PPN)',
    note: 'Layanan ditagih per jam, hari, atau paket. Lisensi dan perangkat yang dijual kembali memakai satuan barang.',
  },
  invoiceTypes: [
    { key: 'HOURLY', label: 'Tagihan jam kerja', hint: 'Jam kerja disetujui ditagih dengan tarif per jam (otomatis dari Lembar waktu: pakai tombol Tagih di sana).', revenueKind: 'CONSULT', unit: 'Jam', description: 'Jasa profesional — ', termLabel: 'Jam kerja', withholding: 'PPH23_JASA', withVat: true },
    { key: 'MILESTONE', label: 'Fee proyek / milestone', hint: 'Tagihan tetap per tahap pekerjaan proyek.', revenueKind: 'CONSULT', unit: 'Paket', description: 'Milestone — ', termLabel: 'Milestone', withholding: 'PPH23_JASA', withVat: true },
    { key: 'ADVISORY', label: 'Biaya konsultasi tunggal', hint: 'Sesi konsultasi atau opini sekali jadi.', revenueKind: 'CONSULT', unit: 'Sesi', description: 'Konsultasi — ', withholding: 'PPH23_JASA', withVat: true },
  ],
  costTypes: [
    { key: 'EXPERT', label: 'Tenaga ahli eksternal', hint: 'Narasumber atau konsultan lepas yang dibayar per pekerjaan.', account: '5-1800' },
    { key: 'SUBCON', label: 'Subkontraktor', hint: 'Pekerjaan proyek yang dialihkan ke pihak lain.', account: '5-1500' },
    { key: 'DATA', label: 'Riset, data, dan lisensi proyek', hint: 'Data berbayar dan lisensi yang dipakai untuk proyek klien.', account: '5-1960' },
    { key: 'TRAVEL', label: 'Perjalanan dan akomodasi proyek', hint: 'Perjalanan ke lokasi klien.', account: '5-1970' },
    { key: 'SOFTWARE', label: 'Langganan perangkat lunak', hint: 'Alat kerja tim.', account: '6-3710' },
    { key: 'TRAINING', label: 'Pelatihan dan sertifikasi tim', hint: 'Pengembangan kompetensi.', account: '6-3800' },
  ],
  quickActions: [
    { label: 'Catat jam kerja', desc: 'Lembar waktu harian atau timer.', to: '/timesheets' },
    { label: 'Tagih jam / milestone', desc: 'Tagihan jasa profesional.', to: '/invoices/services/new' },
    { label: 'Kelola retainer', desc: 'Langganan bulanan klien.', to: '/retainers' },
    { label: 'Buat proyek', desc: 'Kontrak, milestone, dan anggaran.', to: '/projects' },
    { label: 'Laporan konsultan', desc: 'Utilisasi dan jam belum ditagih.', to: '/laporan/jasa-konsultan' },
  ],
  kpis: [
    { key: 's_unbilled_value', label: 'Jam disetujui belum ditagih', hint: 'Nilai jam kerja yang sudah disetujui tetapi belum masuk tagihan.', format: 'money', to: '/timesheets' },
    { key: 's_hours_month', label: 'Jam dapat ditagih bulan ini', hint: 'Jam kerja dapat ditagih yang disetujui bulan berjalan.', format: 'number', to: '/timesheets' },
    { key: 's_utilization_pct', label: 'Utilisasi bulan ini', hint: 'Jam dapat ditagih dibanding seluruh jam yang dicatat.', format: 'percent', to: '/laporan/jasa-konsultan' },
    { key: 's_retainer_mrr', label: 'Retainer bulanan aktif', hint: 'Jumlah biaya bulanan retainer yang aktif.', format: 'money', to: '/retainers' },
    { key: 's_projects_active', label: 'Proyek berjalan', hint: 'Jumlah proyek berstatus aktif.', format: 'number', to: '/projects' },
  ],
  report: { kind: 'jasa-konsultan', label: 'Laporan konsultan', hint: 'Utilisasi tim, jam belum ditagih per klien, retainer, dan pendapatan per klien.' },
  taxFocus: {
    title: 'Konsultan: jasa profesional',
    points: [
      'Klien badan umumnya memotong PPh 23 saat membayar jasa; catat bukti potong di pembayaran agar menjadi kredit pajak.',
      'Jasa konsultansi konstruksi punya PPh final tersendiri; pilih jenisnya di tagihan bila relevan.',
      'Tenaga ahli lepas yang dibayar per pekerjaan: PPh 21 atau PPh 23 sesuai statusnya; simpan bukti potong.',
      'PPN atas jasa kena pajak berlaku bagi PKP.',
    ],
  },
};
