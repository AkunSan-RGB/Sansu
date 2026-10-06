/**
 * Isi Pusat Bantuan SANSU. Ditulis untuk pengguna awam: singkat, langkah demi langkah.
 * `paths` = halaman aplikasi tempat artikel ini relevan (untuk tombol bantuan "?" di pojok kanan atas).
 */
export interface HelpArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  paths: string[];
  steps?: string[];
  tips?: string[];
  keywords?: string;
  /** tautan ke halaman terkait */
  link?: { label: string; to: string };
}

export const HELP_CATEGORIES = [
  'Memulai',
  'Penjualan',
  'Kasir',
  'Pembelian & Stok',
  'Akuntansi & Pajak',
  'Pengaturan & Keamanan',
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  // ---------- Memulai ----------
  {
    id: 'mulai',
    category: 'Memulai',
    title: 'Langkah pertama memakai SANSU',
    summary: 'Urutan yang disarankan agar data dan laporan benar sejak hari pertama.',
    paths: ['/'],
    steps: [
      'Pilih model bisnis saat mendaftar (Dagang, Ritel, Jasa, atau Produksi) — SANSU menyiapkan aplikasi yang sesuai. Bisa diubah di Pengaturan › Perusahaan.',
      'Lengkapi profil perusahaan: nama, NPWP, alamat, dan tarif PPN di Pengaturan › Perusahaan. Pasang juga logo dan info rekening agar tampil di faktur.',
      'Tambahkan gudang/toko bila punya lebih dari satu lokasi (Inventori › Gudang).',
      'Masukkan produk, pelanggan, dan supplier — satu per satu atau impor dari Excel (Pengaturan › Impor data).',
      'Isi saldo awal: saldo kas & bank, piutang, utang lewat Akuntansi › Saldo awal; stok awal lewat Inventori › Penyesuaian stok (alasan: Saldo awal).',
      'Buat akun untuk tim Anda di Pengaturan › Pengguna dan pilih peran yang sesuai.',
      'Mulai bertransaksi: sales order → faktur, atau buka layar Kasir untuk toko.',
    ],
    tips: ['Panduan "Mulai pakai SANSU" di halaman utama mencentang langkah yang sudah selesai secara otomatis.'],
    keywords: 'awal setup onboarding mulai baru pertama',
  },
  {
    id: 'impor',
    category: 'Memulai',
    title: 'Impor produk, pelanggan, supplier, dan stok awal dari Excel',
    summary: 'Pindahkan data dari sistem lama tanpa mengetik ulang.',
    paths: ['/settings/import', '/products', '/customers', '/suppliers'],
    steps: [
      'Buka Pengaturan › Impor data, pilih jenis data.',
      'Unduh templat Excel, isi sesuai kolom (jangan ubah judul kolom).',
      'Unggah file. SANSU memeriksa setiap baris dulu dan menunjukkan baris yang salah beserta alasannya.',
      'Perbaiki bila ada yang salah, unggah ulang, lalu klik Impor.',
    ],
    tips: [
      'Impor "Stok awal" sekaligus membuat kartu stok dan jurnal persediaan — jangan isi persediaan lewat jurnal manual.',
    ],
    keywords: 'import excel csv template migrasi data lama',
    link: { label: 'Buka Impor data', to: '/settings/import' },
  },
  // ---------- Penjualan ----------
  {
    id: 'alur-jual',
    category: 'Penjualan',
    title: 'Alur penjualan: penawaran → sales order → faktur → pembayaran',
    summary: 'Cara mencatat penjualan kredit ke pelanggan dari awal sampai lunas.',
    paths: ['/quotations', '/sales-orders', '/invoices', '/customers'],
    steps: [
      '(Opsional) Buat penawaran di CRM › Penawaran, lalu ubah menjadi sales order bila disetujui.',
      'Buat sales order: pilih pelanggan, gudang, produk, harga, dan diskon.',
      'Kirim barang dan buat faktur dari sales order. Stok berkurang, piutang dan penjualan tercatat otomatis.',
      'Cetak faktur dan surat jalan dari halaman detail faktur.',
      'Saat pelanggan membayar, catat pembayaran di faktur (bisa sebagian). Piutang berkurang otomatis.',
    ],
    tips: ['Laporan umur piutang ada di halaman Faktur — gunakan untuk menagih pelanggan yang terlambat.'],
    keywords: 'jual invoice faktur piutang tagih bayar pelanggan sales order penawaran',
  },
  {
    id: 'retur',
    category: 'Penjualan',
    title: 'Retur penjualan dan retur pembelian',
    summary: 'Barang dikembalikan pelanggan atau dikembalikan ke supplier.',
    paths: ['/returns'],
    steps: [
      'Buka Retur, pilih tab Penjualan atau Pembelian.',
      'Pilih faktur asal, isi jumlah yang diretur per barang.',
      'Simpan. Stok, piutang/utang, PPN, dan HPP dikoreksi otomatis dengan jurnal yang sesuai.',
    ],
    keywords: 'retur kembali barang rusak nota kredit',
  },
  // ---------- Kasir ----------
  {
    id: 'kasir',
    category: 'Kasir',
    title: 'Memakai layar kasir (POS)',
    summary: 'Buka kasir, scan barang, terima pembayaran, dan tutup kasir di akhir shift.',
    paths: ['/pos', '/pos/sessions'],
    steps: [
      'Buka aplikasi Kasir, pilih toko/gudang, isi modal awal di laci, klik Mulai jualan.',
      'Scan barcode atau ketik nama/SKU lalu Enter (F2 untuk langsung ke kotak cari).',
      'Tekan F9 atau klik Bayar, pilih tunai/QRIS/debit/transfer, isi uang diterima. Kembalian dihitung otomatis.',
      'Cetak struk (printer thermal 58/80 mm).',
      'Akhir shift: klik Tutup kasir, hitung uang di laci. Selisih kas dicatat otomatis.',
    ],
    keywords: 'pos kasir toko struk barcode scan shift laci',
    link: { label: 'Buka Kasir', to: '/pos' },
  },
  // ---------- Pembelian & Stok ----------
  {
    id: 'beli',
    category: 'Pembelian & Stok',
    title: 'Pembelian: PO → terima barang → faktur supplier → bayar',
    summary: 'Mencatat pembelian ke supplier dan utang usaha.',
    paths: ['/purchase-orders', '/purchase-invoices', '/suppliers'],
    steps: [
      'Buat purchase order (PO) ke supplier.',
      'Saat barang datang, buat faktur pembelian dari PO. Stok bertambah dengan HPP rata-rata baru, utang usaha tercatat.',
      'Catat pembayaran ke supplier dari halaman faktur pembelian.',
    ],
    keywords: 'beli po purchase supplier vendor utang hutang terima barang',
  },
  {
    id: 'gudang',
    category: 'Pembelian & Stok',
    title: 'Mengelola beberapa gudang',
    summary: 'Tambah gudang, batasi akses pengguna, dan pantau stok semua lokasi.',
    paths: ['/warehouses', '/inventory/warehouses', '/inventory'],
    steps: [
      'Tambah gudang di Inventori › Gudang (khusus Pemilik/Admin; jumlah gudang mengikuti paket langganan).',
      'Atur stok minimum per gudang agar muncul peringatan stok menipis.',
      'Lihat stok semua gudang sekaligus di Inventori › Stok per gudang (bisa diekspor ke Excel).',
      'Batasi pengguna gudang ke lokasi tertentu di Pengaturan › Pengguna › Akses gudang.',
    ],
    keywords: 'gudang warehouse cabang toko lokasi stok minimum',
  },
  {
    id: 'transfer',
    category: 'Pembelian & Stok',
    title: 'Transfer barang antar gudang (termasuk barang dalam perjalanan)',
    summary: 'Pindahkan stok dengan surat jalan; kiriman jauh diterima belakangan oleh gudang tujuan.',
    paths: ['/inventory/transfers'],
    steps: [
      'Inventori › Transfer › Transfer baru. Pilih gudang asal & tujuan, barang, dan jumlah.',
      'Pilih cara: "Langsung" bila stok langsung pindah, atau "Dikirim, diterima belakangan" untuk kiriman antar kota.',
      'Cetak surat jalan untuk sopir.',
      'Untuk kiriman: petugas gudang tujuan membuka transfer lalu klik Terima barang, isi jumlah yang benar-benar tiba.',
      'Bila ada kekurangan, nilainya otomatis dibukukan ke Selisih Persediaan. Kiriman yang batal bisa dibatalkan agar barang kembali ke gudang asal.',
    ],
    tips: ['Selama di jalan, nilai barang tercatat di akun "Persediaan dalam Perjalanan" sehingga neraca tetap benar.'],
    keywords: 'transfer mutasi pindah gudang kirim surat jalan perjalanan transit terima',
    link: { label: 'Buka Transfer', to: '/inventory/transfers' },
  },
  {
    id: 'opname',
    category: 'Pembelian & Stok',
    title: 'Stock opname (hitung fisik)',
    summary: 'Cocokkan stok di sistem dengan barang di rak.',
    paths: ['/inventory/counts'],
    steps: [
      'Inventori › Stock opname › Opname baru, pilih gudang (bisa per kategori).',
      'Cetak lembar hitung atau isi langsung jumlah fisik di layar. Bisa disimpan bertahap.',
      'Klik Posting. Selisih menjadi penyesuaian stok dan jurnal secara otomatis.',
    ],
    keywords: 'opname hitung fisik stok selisih cek rak',
  },
  // ---------- Akuntansi & Pajak ----------
  {
    id: 'laporan',
    category: 'Akuntansi & Pajak',
    title: 'Laporan keuangan & ekspor Excel',
    summary: 'Laba rugi, posisi keuangan, arus kas, dan catatan atas laporan keuangan.',
    paths: ['/reports', '/trial-balance', '/worksheet', '/ledger', '/journals'],
    steps: [
      'Buka Akuntansi › Laporan keuangan, pilih periode.',
      'Semua laporan bisa dicetak atau diunduh ke Excel — angka turunan ditulis sebagai rumus Excel sehingga bisa ditelusuri.',
      'Gunakan Cek kesehatan data untuk memastikan buku besar cocok dengan piutang, utang, dan stok.',
    ],
    keywords: 'laporan laba rugi neraca posisi keuangan arus kas excel ekspor calk',
  },
  {
    id: 'pajak',
    category: 'Akuntansi & Pajak',
    title: 'PPN, e-Faktur Coretax, dan PPh',
    summary: 'Rekap PPN masukan/keluaran, file XML Coretax, dan setoran pajak.',
    paths: ['/vat', '/tax', '/fiscal', '/payroll/pph21'],
    steps: [
      'Atur tarif PPN dan status PKP di Pengaturan › Perusahaan.',
      'Rekap PPN bulanan ada di Pajak › Rekap PPN; unduh XML faktur keluaran untuk diimpor ke Coretax DJP.',
      'Catat setoran pajak (kode billing & NTPN) di Pajak › Setoran pajak & BPJS.',
      'Rekonsiliasi fiskal & PPh badan di Pajak › Rekonsiliasi fiskal.',
    ],
    tips: [
      'SANSU membantu menyiapkan data; pelaporan resmi tetap dilakukan di Coretax DJP. Konsultasikan dengan konsultan pajak Anda untuk kasus khusus.',
    ],
    keywords: 'pajak ppn coretax efaktur e-faktur xml pph 21 23 25 29 fiskal npwp',
  },
  {
    id: 'rekap-pajak',
    category: 'Akuntansi & Pajak',
    title: 'Rekap pajak & BPJS (tahunan, PPh 23/4(2), iuran BPJS)',
    summary: 'Pantau semua kewajiban pajak & BPJS per masa, bahan bukti potong, dan pencocokan tagihan BPJS.',
    paths: ['/tax/recap', '/tax', '/payroll/bpjs'],
    steps: [
      'Pajak › Rekap pajak & BPJS › Rekap tahunan: semua jenis pajak & BPJS per bulan — terutang, disetor, NTPN, dan status (tepat waktu, terlambat, kurang setor).',
      'Tab PPh 23 & 4(2) dipotong: daftar potongan dari tagihan supplier per masa beserta DPP, tarif, dan NPWP — bahan membuat bukti potong di e-Bupot Unifikasi (Coretax).',
      'Tab Iuran BPJS (atau Penggajian › Rekap BPJS): iuran per karyawan per program, dipisah bagian perusahaan & karyawan — cocokkan dengan tagihan SIPP dan e-Dabu sebelum membayar.',
      'Setelah menyetor, catat di Setoran pajak & BPJS (kode billing & NTPN) agar statusnya berubah menjadi lunas.',
      'Semua rekap bisa diunduh ke Excel lengkap dengan rumus.',
    ],
    tips: [
      'Jatuh tempo: PPh 21/23/4(2)/25 setor tgl 15 & lapor tgl 20 bulan berikutnya; PPN setor & lapor akhir bulan berikutnya; BPJS Kesehatan tgl 10, BPJS Ketenagakerjaan tgl 15.',
      'Supplier tanpa NPWP/NIK ditandai merah — tarif PPh 23 tanpa NPWP 100% lebih tinggi.',
      'Batas upah BPJS Kesehatan & Jaminan Pensiun diatur di Pengaturan penggajian; perbarui bila ada pengumuman batas baru.',
    ],
    keywords: 'rekap pajak tahunan bpjs pph 23 4 ayat 2 bukti potong ebupot e-bupot ntpn jatuh tempo terlambat sipp edabu iuran jht jp jkk jkm kesehatan spt',
    link: { label: 'Buka Rekap pajak & BPJS', to: '/tax/recap' },
  },
  {
    id: 'tutup-buku',
    category: 'Akuntansi & Pajak',
    title: 'Tutup buku bulanan',
    summary: 'Kunci periode agar transaksi lama tidak berubah.',
    paths: ['/closing', '/adjustments'],
    steps: [
      'Pastikan semua transaksi bulan itu sudah dicatat dan Cek kesehatan data hijau.',
      'Buat jurnal penyesuaian bila perlu (penyusutan dihitung otomatis dari daftar aset tetap).',
      'Buka Akuntansi › Tutup buku, kunci periode. Hanya Pemilik yang bisa membuka kembali.',
    ],
    keywords: 'tutup buku closing kunci periode akhir bulan tahun',
  },
  {
    id: 'opname-kas',
    category: 'Akuntansi & Pajak',
    title: 'Opname kas (hitung fisik uang)',
    summary: 'Cocokkan uang di kas kecil / kas kantor dengan saldo di pembukuan, minimal sebulan sekali.',
    paths: ['/cash/counts', '/cash'],
    steps: [
      'Buka Kas & Bank › Opname kas › Opname baru. Pilih kas, tanggal, dan nama pemegang kas.',
      'Hitung uang per pecahan (lembar & keping). Total dan selisih terhadap saldo buku muncul otomatis.',
      'Bila ada bon sementara/kasbon yang belum dicatat, tambahkan sebagai pos (+); uang titipan sebagai pos (−).',
      'Isi penjelasan bila masih ada selisih, lalu klik Selesaikan. Selisih kecil langsung dibukukan ke akun Selisih Kas.',
      'Selisih di atas batas (bawaan Rp50.000) menunggu persetujuan Pemilik, yang bisa menyetujui atau mengembalikan untuk dihitung ulang.',
      'Cetak berita acara opname kas untuk ditandatangani pemegang kas, pemeriksa, dan atasan.',
    ],
    tips: [
      'Setelah opname selesai, transaksi ke kas tersebut tidak bisa lagi bertanggal sebelum/sama dengan tanggal opname — hasil yang sudah ditandatangani tidak berubah.',
      'Rekening bank tidak diopname; gunakan Rekonsiliasi bank.',
      'Cek kesehatan data mengingatkan bila kas belum diopname lebih dari sebulan.',
    ],
    keywords: 'opname kas cash count hitung uang kas kecil petty cash selisih kas berita acara pecahan',
    link: { label: 'Buka Opname kas', to: '/cash/counts' },
  },
  {
    id: 'jasa',
    category: 'Penjualan',
    title: 'Usaha jasa: faktur jasa, termin proyek, uang muka, PPh dipotong pelanggan',
    summary: 'Tagih pekerjaan tanpa stok barang, per termin kontrak, dengan PPh 23 / PPh 4(2) yang dipotong pelanggan.',
    paths: ['/invoices/services/new', '/projects', '/customer-deposits', '/tax/withheld'],
    steps: [
      'Kontrak bertahap: buka Penjualan › Proyek & termin › Proyek baru. Isi pelanggan dan nilai kontrak (DPP, belum PPN).',
      'Menerima DP: Penjualan › Uang muka pelanggan › Terima uang muka. DP dicatat sebagai utang kepada pelanggan, bukan pendapatan. Bila PKP, PPN uang muka langsung terutang.',
      'Menagih: Faktur & piutang › Faktur jasa (atau tombol Tagih termin di halaman proyek). Isi persen termin, pilih jenis PPh yang dipotong pelanggan, lalu Posting.',
      'Melunasi dengan DP: di faktur klik Pakai uang muka. Sisa tagihan dibayar lewat Terima bayar.',
      'Bukti potong: setelah pelanggan mengirim bukti potong, catat nomornya di Pajak › PPh dipotong pelanggan.',
      'Tiap akhir bulan: di halaman proyek klik Catat kemajuan dan isi % pekerjaan selesai. Pendapatan yang sudah dikerjakan tapi belum ditagih otomatis tercatat (atau sebaliknya, tagihan yang mendahului pekerjaan dicatat sebagai pendapatan diterima dimuka).',
      'Biaya proyek: pilih proyeknya saat mencatat tagihan biaya (subkon, material, sewa alat) kas keluar, atau jurnal umum (baris beban), dan tempatkan pekerja lapangan di proyek lewat data karyawan agar gajinya ikut. Halaman proyek menampilkan biaya langsung dan margin per proyek.',
    ],
    tips: [
      'PPh 23 yang dipotong pelanggan masuk Pajak Dibayar Dimuka dan otomatis mengurangi PPh Badan di Rekonsiliasi fiskal — syaratnya ada bukti potong.',
      'PPh 4(2) jasa konstruksi / sewa bangunan bersifat final: dicatat sebagai Beban PPh Final, pendapatannya (akun 4-2100 / 4-2200) dikeluarkan dari PPh tarif umum. Biaya untuk memperoleh pendapatan final otomatis dikoreksi di Rekonsiliasi fiskal: biaya langsung proyek ber-PPh final seluruhnya, biaya bersama (di luar HPP barang dagang) secara proporsional pendapatan. Angkanya bisa diganti manual bila Anda punya pemisahan yang lebih tepat.',
      'Pendapatan jasa diakui sebesar kemajuan pekerjaan (SAK EP Bab 23) lewat Catat kemajuan, sehingga laba tiap bulan tidak bergantung pada kapan termin ditagih.',
      'Tagihan proyek tidak bisa melebihi nilai kontrak. Bila ada pekerjaan tambah, ubah nilai kontrak (addendum) di halaman proyek.',
      'e-Faktur Coretax: uang muka ber-PPN ikut diekspor sebagai faktur pajak uang muka, dan faktur pelunasan otomatis dikurangi DPP uang muka yang sudah dipakai. Pakai uang muka di faktur sebelum mengekspor.',
    ],
    keywords: 'jasa kontraktor konstruksi termin proyek kontrak uang muka dp down payment pph 23 pph 4 ayat 2 final bukti potong sewa konsultan faktur jasa',
    link: { label: 'Buat faktur jasa', to: '/invoices/services/new' },
  },
  {
    id: 'produksi',
    category: 'Pembelian & Stok',
    title: 'Produksi: resep (BOM), perintah produksi, harga pokok produksi',
    summary: 'Olah bahan baku menjadi produk jadi dengan harga pokok = bahan + upah langsung + overhead pabrik (SAK EP Bab 13).',
    paths: ['/production/boms', '/production/orders', '/production/report'],
    steps: [
      'Daftarkan bahan baku dan produk jadi di Produk (satuan dasar, mis. meter, gulung, pcs). Beli bahan lewat Pembelian seperti biasa.',
      'Buat resep di Produksi › Resep (BOM): hasil per batch, bahan per batch (termasuk susut normal), serta upah langsung & overhead pabrik standar per batch.',
      'Produksi › Perintah produksi › Produksi baru: pilih resep dan jumlah batch.',
      'Klik Mulai produksi: bahan keluar dari gudang ke Barang dalam Proses. Ubah jumlah bila pemakaian sebenarnya berbeda dari resep.',
      'Setelah selesai, isi hasil baik lalu klik Selesai: produk jadi masuk gudang dengan harga pokok per unit yang dihitung otomatis, siap dijual.',
      'Tandai pekerja produksi di data karyawan, dan catat biaya pabrik (listrik mesin, sewa pabrik) ke akun 5-4200 agar laporan Harga pokok produksi bisa membandingkan biaya sesungguhnya dengan yang dibebankan.',
    ],
    tips: [
      'Produk cacat / susut normal cukup tidak dihitung sebagai hasil baik — biayanya otomatis ditanggung produk yang baik.',
      'Produksi yang belum selesai di akhir bulan tetap tercatat sebagai Barang dalam Proses (bagian persediaan) di neraca.',
      'Selisih biaya konversi sesungguhnya vs dibebankan masuk beban pokok penjualan periode berjalan. Bila selisih terus besar, perbarui upah & overhead standar di resep.',
      'Membatalkan produksi yang sedang berjalan mengembalikan bahan ke gudang dengan biaya semula.',
    ],
    keywords: 'produksi manufaktur bom resep bahan baku barang dalam proses wip harga pokok produksi hpp overhead upah langsung konveksi pabrik',
    link: { label: 'Buka Perintah produksi', to: '/production/orders' },
  },
  {
    id: 'penurunan-nilai',
    category: 'Akuntansi & Pajak',
    title: 'Penurunan & pemulihan nilai persediaan',
    summary: 'Catat persediaan sebesar yang lebih rendah antara harga pokok dan nilai realisasi neto (SAK EP Bab 13).',
    paths: ['/inventory/writedowns'],
    steps: [
      'Buka Inventori › Penurunan nilai. Pilih gudang; daftar menampilkan barang yang harga jualnya di bawah harga pokok rata-rata.',
      'Isi "Biaya menjual" (%) bila ada taksiran ongkos untuk menjual (komisi, ongkir, diskon), agar nilai realisasi neto lebih tepat.',
      'Centang barang yang memang perlu diturunkan, lalu klik Turunkan nilai. Untuk barang rusak/kedaluwarsa yang tidak muncul, pakai "Barang lain".',
      'Periksa nilai realisasi neto per satuan, isi alasan, lalu Posting. Harga pokok barang langsung turun dan jurnal dibuat otomatis.',
      'Bila harga naik lagi, barang muncul di kartu "Pemulihan nilai". Centang lalu klik Pulihkan nilai — paling tinggi sampai harga pokok sebelum diturunkan.',
    ],
    tips: [
      'Jurnal: Dr Kerugian Penurunan Nilai Persediaan (kelompok beban pokok) · Cr Persediaan.',
      'Pajak: kerugian ini belum boleh dikurangkan (koreksi fiskal positif). Saat barangnya terjual/keluar, Rekonsiliasi fiskal otomatis membuat koreksi negatif sebesar penurunan yang terealisasi; sisanya dihitung sebagai beda temporer pajak tangguhan.',
      'Pemulihan dicatat Dr Persediaan · Cr Kerugian Penurunan Nilai Persediaan, dan secara fiskal bukan penghasilan (koreksi negatif).',
      'Lakukan minimal setiap akhir tahun sebelum tutup buku. Cek kesehatan data mengingatkan bila ada barang yang dijual di bawah harga pokok.',
      'Barang yang sudah tidak bisa dijual sama sekali: nilai realisasi neto = 0, atau keluarkan lewat penyesuaian stok (rusak).',
    ],
    keywords: 'penurunan nilai persediaan NRV nilai realisasi neto write down pemulihan reversal usang kedaluwarsa rusak harga pokok SAK EP koreksi fiskal',
    link: { label: 'Buka Penurunan nilai', to: '/inventory/writedowns' },
  },
  {
    id: 'pkp',
    category: 'Akuntansi & Pajak',
    title: 'PKP, non-PKP, dan harga kasir termasuk PPN',
    summary: 'Atur apakah perusahaan memungut PPN dan bagaimana harga di kasir dihitung.',
    paths: ['/settings/company'],
    steps: [
      'Buka Pengaturan › Perusahaan › Identitas & pajak.',
      'PKP: penjualan dipungut PPN keluaran dan PPN dari supplier dikreditkan sebagai PPN Masukan.',
      'Non-PKP (belum dikukuhkan, omzet ≤ Rp4,8 miliar/tahun): penjualan tanpa PPN. PPN yang ditagih supplier tidak bisa dikreditkan, jadi otomatis ditambahkan ke harga pokok barang, biaya, atau harga perolehan aset.',
      'Harga di kasir "sudah termasuk PPN" (lazim di toko ritel): harga rak = harga bayar; sistem menghitung mundur DPP = harga × 100/111 dan PPN yang terkandung, lalu mencetaknya di struk.',
      'Penawaran & pesanan penjualan: centang "Harga yang diketik sudah termasuk PPN". Total dokumen sama dengan harga yang Anda tawarkan; baris disimpan sebagai DPP sehingga faktur, retur, dan e-Faktur Coretax tetap benar.',
    ],
    tips: [
      'Perubahan berlaku untuk transaksi baru; dokumen lama tidak berubah.',
      'Wajib mengajukan pengukuhan PKP bila omzet setahun melewati Rp4,8 miliar.',
      'Retur pembelian dari faktur non-PKP mengembalikan PPN bersama nilai barang (tidak mengurangi PPN Masukan).',
    ],
    keywords: 'pkp non-pkp pengusaha kena pajak ppn termasuk ppn harga rak kasir dpp ritel umkm penawaran sales order inklusif',
    link: { label: 'Buka Pengaturan perusahaan', to: '/settings/company' },
  },
  // ---------- Pengaturan & Keamanan ----------
  {
    id: 'pengguna',
    category: 'Pengaturan & Keamanan',
    title: 'Pengguna dan hak akses',
    summary: 'Siapa boleh membuka apa.',
    paths: ['/settings/users'],
    steps: [
      'Pengaturan › Pengguna › Pengguna baru. Isi nama, email, kata sandi awal, dan peran.',
      'Peran menentukan aplikasi yang bisa dibuka: Admin, Keuangan, Sales, Gudang, Kasir, HR.',
      'Batasi akses gudang bila pengguna hanya boleh mengelola lokasi tertentu.',
      'Nonaktifkan pengguna yang keluar — riwayat transaksinya tetap tersimpan.',
    ],
    keywords: 'user pengguna akses peran role izin karyawan',
  },
  {
    id: '2fa',
    category: 'Pengaturan & Keamanan',
    title: 'Verifikasi 2 langkah (2FA)',
    summary: 'Lapisan keamanan tambahan memakai kode dari HP.',
    paths: ['/account/security', '/settings/users'],
    steps: [
      'Pasang Google Authenticator atau Microsoft Authenticator di HP.',
      'Klik nama Anda di kanan atas › Keamanan akun › Aktifkan verifikasi 2 langkah.',
      'Pindai kode QR, masukkan 6 angka yang muncul, lalu simpan 10 kode cadangan di tempat aman.',
      'Pemilik dapat mewajibkan 2FA untuk Admin/Keuangan atau semua pengguna di halaman yang sama.',
    ],
    tips: ['HP hilang? Masuk dengan kode cadangan, atau minta Pemilik me-reset 2FA Anda di menu Pengguna.'],
    keywords: '2fa otp authenticator keamanan kode verifikasi google hp hilang',
    link: { label: 'Buka Keamanan akun', to: '/account/security' },
  },
  {
    id: 'langganan',
    category: 'Pengaturan & Keamanan',
    title: 'Langganan, tagihan, dan invoice',
    summary: 'Pilih paket, bayar, dan unduh invoice.',
    paths: ['/billing'],
    steps: [
      'Buka Langganan dari menu Pengaturan.',
      'Pilih paket dan siklus (bulanan/tahunan). Tagihan dibuat otomatis.',
      'Bayar lewat transfer lalu unggah bukti, atau bayar online bila tersedia. Langganan aktif setelah dikonfirmasi.',
      'Klik Invoice di riwayat tagihan untuk mencetak / menyimpan PDF.',
    ],
    tips: ['Bila masa aktif habis, data tetap aman dan bisa dilihat (baca saja) sampai langganan diperpanjang.'],
    keywords: 'langganan paket bayar tagihan invoice perpanjang harga',
    link: { label: 'Buka Langganan', to: '/billing' },
  },
  {
    id: 'lupa-sandi',
    category: 'Pengaturan & Keamanan',
    title: 'Lupa kata sandi',
    summary: 'Atur ulang kata sandi lewat email.',
    paths: [],
    steps: [
      'Di halaman masuk, klik "Lupa kata sandi?" dan masukkan email Anda.',
      'Buka email dari SANSU dan klik tautan atur ulang (berlaku 1 jam).',
      'Bila email tidak masuk, periksa folder Spam, atau minta Admin perusahaan mengatur ulang kata sandi Anda di menu Pengguna.',
    ],
    keywords: 'lupa password sandi reset email masuk login',
  },
];

/** Artikel yang relevan dengan halaman yang sedang dibuka */
export function articlesFor(pathname: string): HelpArticle[] {
  const exact = HELP_ARTICLES.filter((a) =>
    a.paths.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))),
  );
  return exact;
}

/** Pencarian sederhana: semua kata harus muncul di judul/ringkasan/isi/kata kunci */
export function searchArticles(term: string): HelpArticle[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return HELP_ARTICLES;
  return HELP_ARTICLES.filter((a) => {
    const hay = [a.title, a.summary, a.keywords, ...(a.steps ?? []), ...(a.tips ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
