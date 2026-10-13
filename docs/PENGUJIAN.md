# Pengujian & kontrol integritas

SANSU diuji berlapis. Semua tes e2e berjalan pada **PostgreSQL 18** sungguhan (bukan tiruan), karena transaksi,
penguncian baris, dan `uuidv7()` adalah bagian dari perilaku yang diuji.

```bash
npm run db:up                       # PostgreSQL 18 (Docker)
npm test                            # unit (api, web)
npm run test:e2e                    # e2e api: mereset dan memigrasi database `akurata_test` lalu menjalankan semua
```

## Lapisan

| Lapisan | Berkas | Yang dijaga |
| --- | --- | --- |
| Unit | `*.spec.ts` | Aturan murni: PPh 21 TER, PTKP, Pasal 17/31E, penyusutan, tenggat pajak, ukuran usaha UMKM, ambang pajak, NPWP |
| Alur bisnis e2e | `test/*.e2e-spec.ts` | Siklus penuh jual-beli-stok-kas-pajak-gaji per fitur |
| **Uji acak invarian** | `integrity-fuzz` | Ratusan operasi campuran; hukum pembukuan tidak pernah dilanggar |
| **Penyisiran rute** | `garbage-input`, `input-bounds` | Masukan sembarang ke semua rute tidak pernah menghasilkan 5xx |
| **Isolasi & hak akses** | `security`, `role-access` | Perusahaan lain tidak bisa membaca/mengubah data; peran hanya melihat yang perlu |
| **Konkurensi** | `concurrency` | Permintaan serentak tidak melanggar pembukuan |
| Jejak audit | `journal-immutable` | Jurnal terposting tidak bisa diubah/dihapus (trigger database) |
| Kalender pajak & PPN | `tax-calendar-vat` | Tenggat digeser ke hari kerja berikutnya; pembulatan PPN ke rupiah penuh |
| Bagan akun per jenis usaha | `coa-per-model` | Akun khusus, nama inti, relevansi (akun tak terpakai dinonaktifkan) per jenis usaha; nama buatan pengguna tidak tertimpa |
| Fitur pajak per usaha | `tax-features` | Menu dan kewajiban pajak mengikuti jenis usaha, status PKP, dan skema PPh |
| Rantai dokumen penjualan | `delivery-chain` | Penawaran → pesanan → surat jalan → faktur → bayar → retur; stok, HPP, piutang, dan jejak dokumen cocok; jalur surat jalan juga masuk uji acak |
| Keterpaduan antar modul | `integration-cycle` | Siklus khas tiap jenis usaha; semua laporan, daftar piutang/utang, stok, dan kas saling cocok setelah setiap tahap |
| Penelusuran | `drilldown` | Buku besar dan jurnal membuka dokumen asal |
| Persetujuan | `approvals` | Batas nilai, keputusan, penolakan, pembatalan, dan persetujuan serentak |
| Pindah standar SAK EP ↔ EMKM | `framework-switch` | Satu perusahaan (diuji untuk Dagang, Ritel, Jasa, Produksi) berganti standar: bagan akun, laba rugi, CALK (kebijakan piutang, persediaan, aset tetap), pajak tangguhan, cadangan piutang, nilai residu aset, menu dan API penurunan nilai persediaan, akrual persentase penyelesaian proyek, dan cek kesehatan ikut berubah; angka tetap sama |
| Impor aset lama & kontrol aset tetap | `imports-aset`, `aset-kontrol` | Impor aset lama tanpa jurnal, selisih daftar aset vs buku besar, penyusutan otomatis (bisa dimatikan, tidak ganda), temuan kontrol, penanggung jawab & pemeriksaan fisik, persetujuan pelepasan aset |
| SOP kas & bank | `kontrol-kas` | Bukti wajib, persetujuan uang keluar/transfer di atas batas, blokir saldo negatif, pembatalan terkontrol (jurnal pembalik, hanya pemilik/admin, alasan wajib), temuan kontrol |
| Kas kecil (dana tetap / imprest) | `kas-kecil` | Pendirian dana, bukti kas kecil (nota wajib & unik, batas per bukti, hanya akun beban), pagar kas umum, pembatalan, pengisian kembali dengan persetujuan, kecocokan plafon dan temuan kontrol |
| Pemisahan fungsi | `segregation` | Matriks hak akses seluruh endpoint (3-way pengadaan, penjualan, stok, gaji, persetujuan), batasan Kasir/SDM, hak baca, serta persetujuan penyesuaian stok dan pembayaran supplier |
| Proses jurnal & buku besar | `jurnal-proses`, `jurnal-kontrol`, `jurnal-penyesuaian` | Buku besar lengkap saat terpotong, tanggal jurnal balik, pengaman bank, balik otomatis akrual, jurnal berulang tidak ganda saat bersamaan, peringatan jurnal ganda, tutup tahun tidak ganda, akun kontrol, penyesuaian di neraca lajur |
| Kontrol pembelian & stok | `pembayaran-supplier-batal`, `stok-kontrol` | Pembayaran supplier salah bisa dibatalkan (jurnal dibalik, hutang terbuka lagi, bukan oleh Keuangan), stok opname tidak dobel saat diklik serentak, transaksi stok/pembayaran tidak boleh bertanggal masa depan |
| Perputaran stok per jenis usaha | `perputaran-stok`, `movement.spec` | Barang cepat/normal/lambat/tidak bergerak/baru/habis-padahal-laku dikenali dari mutasi nyata dengan ambang tiap jenis usaha; Sales tidak boleh melihat |
| Anggaran vs realisasi | `anggaran` | Penyusunan, persetujuan (penyusun bukan penyetuju), kunci & buka kunci beralasan, selisih/status OVER-UNBUDGETED-SHORT, peringatan otomatis sekali per akun per bulan, isi dari realisasi |
| Multi-cabang | `multi-cabang` | Cabang turun otomatis dari toko/gudang & kas ke jurnal (kasir, retur, penjualan, pembelian, stok, kas, jurnal manual, jurnal balik); laba rugi per cabang; kolom gabungan = laba rugi perusahaan; temuan cabang |
| Bank otomatis & anti-fraud | `bank-kontrol` | Integritas file mutasi, anti catat ganda per baris, aturan kategori otomatis (batas nilai, hanya pendapatan/beban), staf tak bisa menyembunyikan uang keluar, hapus rekening koran terkontrol, pengesahan rekonsiliasi oleh orang lain, temuan kontrol bank |
| Kasir ↔ stok ↔ buku besar | `kasir-retur` | Retur/pembatalan kasir oleh supervisor (stok kembali pada HPP, jurnal dibalik, uang laci berkurang, total retur = total jual), kasir tak bisa ubah harga/diskon atau batalkan sendiri, pembatasan toko, temuan kontrol kasir |
| Kontrol pembelian anti-fraud | `kontrol-pembelian` | Pemasok mirip/ganda ditahan sampai dikonfirmasi, pembayaran pertama ke pemasok butuh persetujuan, PO dipecah di bawah batas ditandai, halaman Kontrol pembelian |
| Metode biaya persediaan | `inventory-method` | Rata-rata bergerak dan MPKP/FIFO untuk keempat jenis usaha dan kedua standar: LIFO ditolak, HPP FIFO 16.000 vs rata-rata 16.500, beralih metode tidak mengubah nilai stok, CALK mengikuti metode; uji acak invarian memakai FIFO pada benih ganjil |
| Manufaktur berjenjang & setengah jadi | `manufacturing-chain` | Rencana menghasilkan perintah induk dan anak untuk barang setengah jadi; induk tidak bisa mulai sebelum anak selesai; akun Persediaan Barang Setengah Jadi (1-1430) sama dengan kartu stok setengah jadi lewat produksi, penyesuaian, transfer, dan batal; setengah jadi tidak dijual/dibeli; uji acak invarian memuat barang setengah jadi pada benih tertentu |
| Notifikasi Telegram | `telegram` | Penautan akun lewat bot (kode sekali pakai 15 menit, grup/kode salah/kedaluwarsa ditolak), notifikasi persetujuan hanya ke pemberi persetujuan yang terhubung dengan tautan pribadi, pemutusan lewat aplikasi dan /stop; tanpa jaringan di uji |
| Panel SANSU & saklar langganan | `platform-panel`, `saas`, `hardening` | Langganan dimatikan secara bawaan (tanpa trial, batas paket, tagihan, penguncian); penangguhan lama tidak mengunci saat mati dan berlaku lagi saat dinyalakan; pantauan penggunaan (pengguna aktif, dokumen, aktivitas, perusahaan teraktif) hanya untuk pemilik layanan; suite langganan menyalakan saklar sendiri |
| Mata uang asing | `foreign-currency`, `fx.spec` | Kurs (peran, validasi, timpa per tanggal); pesanan dan PO valas (harga valas, Rupiah dari kurs, PPN dari DPP rupiah, total valas); pelunasan sebagian dan akhir dengan laba/rugi kurs terealisasi dari nilai tercatat awal; faktur beli valas dengan kurs dan harga valas sendiri (selisih kurs ke biaya perolehan, tanda Selisih kurs, kurs di atas pasar butuh persetujuan); penilaian ulang akhir periode piutang dan utang di akun penyesuaian terpisah, dibalik otomatis, subbuku tetap cocok; CALK dan cek kesehatan; uang muka valas ditolak; retur valas (kurs faktur, sisa valas, pelunasan akhir); uji acak invarian memuat penjualan/pembelian USD, bayar dengan kurs acak, dan penilaian ulang |
| Standar akuntansi umum IFRS | `ifrs` | Pilihan IFRS (kerangka lengkap seperti SAK EP): bagan akun, lima laporan dengan judul dwibahasa, CALK dengan pengungkapan IFRS (instrumen keuangan, sewa, standar baru, risiko keuangan, manajemen modal), angka tetap sama saat berpindah standar, rujukan IAS 2, wizard (akuntabilitas publik wajib IFRS, mikro tidak boleh) |
| Jenis usaha Manufaktur | `manufacturing` | Pengaturan bawaan (akun pabrik, istilah laporan, panduan); kebutuhan bahan dari resep bertingkat (stok barang setengah jadi dipakai dulu, pesanan berjalan dan permintaan pembelian dikurangkan, resep berputar ditolak); analisis selisih produksi dengan penanda pemakaian bahan berlebih dan hasil rendah; fitur dibatasi ke Manufaktur |
| Permintaan pembelian | `purchase-requests` | Gudang mengajukan, persetujuan (otomatis untuk nilai kecil), jadikan PO per supplier, usulan dari stok minimum |
| Harga faktur berbeda dari PO | `purchase-price-variance`, `purchase-quick` | Biaya perolehan mengikuti faktur; selisih ke persediaan dan HPP; pembelian cepat dari penawaran dan riwayat harga |
| Anti-fraud selisih harga | `purchase-price-control` | Alasan wajib, toleransi dan pembanding harga pasar, persetujuan, pemisahan tugas, laporan tinjauan |
| Persetujuan lewat tautan email & supplier favorit | `approval-links` | Token pribadi sekali pakai tanpa login, kedaluwarsa, lintas tenant; supplier favorit dengan batas persetujuan otomatis |
| Rantai pembelian | `purchase-chain` | Pesanan → penerimaan barang bertahap → faktur supplier bertahap: akun Barang Diterima Belum Ditagih terbentuk dan tertutup, stok dan utang cocok, batal penerimaan, jalur langsung faktur, non-PKP, FIFO, retur; uji acak invarian memuat operasi penerimaan dan faktur bertahap |
| Pengingat otomatis | `reminders` | Daftar pengingat dihitung dari data (piutang, utang, penerimaan belum difaktur, pesanan belum diterima), disaring menurut peran, bisa ditunda per pengguna, ambang diatur per perusahaan; ringkasan email harian sekali sehari; pengingat tagihan ke pelanggan per tahap dan manual sekali sehari |
| Saldo awal | `opening-balance` | Akun kontrol (piutang, utang, persediaan, penyeimbang) tidak bisa diisi manual; ringkasan kesiapan dan peringatan |

## Uji acak invarian

Menjalankan urutan operasi acak berbenih tetap: pembelian, penjualan, pembayaran, retur, penyesuaian dan transfer
stok, kasir, jurnal manual dan pembaliknya, tagihan, aset dan penyusutan, produksi, penggajian, setoran pajak,
dokumen bertanggal mundur, lalu tutup buku tahun lalu. Setelah **setiap langkah** diperiksa langsung di database:

- setiap jurnal seimbang (debit = kredit); neraca saldo dan persamaan akuntansi seimbang
- piutang dan utang di buku besar = saldo dokumen (faktur penjualan / pembelian)
- persediaan di buku besar (1-1400) = nilai stok; persediaan dalam perjalanan (1-1410) nol bila tidak ada transfer berjalan
- stok tidak negatif; pembayaran + retur tidak melebihi tagihan; status dokumen konsisten
- tidak ada respons 5xx; penolakan bisnis (4xx) wajar
- di akhir: tidak ada cek kesehatan berstatus ERROR; setelah tutup buku, akun sementara tahun itu nol tetapi
  laporan tahun itu tetap terbaca dan neraca akhir tahun seimbang

```bash
# ulangi satu temuan persis
FUZZ_SEED=1013 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
# kampanye besar
FUZZ_SEEDS=$(seq -s, 3001 3040) FUZZ_STEPS=150 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
# lihat alasan penolakan bisnis per jenis operasi
FUZZ_WHY=1 FUZZ_SEED=101 npx dotenv -e .env.test -- jest --config test/jest-e2e.json --runInBand integrity-fuzz
```

Tes ini menggunakan database `akurata_test`; jangan diarahkan ke database berisi data nyata.

## Menambah fitur

- **Rute baru otomatis ikut teruji** oleh `security` (isolasi perusahaan) dan `garbage-input` (masukan sembarang).
  Bila sebuah rute memang harus dikecualikan, jelaskan alasannya di daftar `SKIP` pada tes tersebut.
- Bila fitur membuat jurnal, tambahkan operasinya ke `integrity-fuzz` agar invariannya ikut dijaga.
- Aturan perpajakan taruh sebagai **fungsi murni** di `shared` (contoh: `taxDueDate`, `recommendProfile`,
  `evaluateThresholds`) lalu uji pada nilai batas: tepat di batas, satu rupiah di atas, dan pergantian tahun.
- Data sensitif per peran: tambahkan `@Roles(...)` pada rute dan masukkan ke `role-access`.

## Catatan

- Aturan yang bergantung pada peraturan (tarif, tenggat, batas) diberi rujukan di komentar kode. Peraturan berubah:
  tinjau ulang bersama konsultan pajak secara berkala, terutama tabel TER, batas upah BPJS, dan aturan PPh final.
- Tenggat yang jatuh di akhir pekan digeser otomatis; hari libur nasional dan cuti bersama diisi pengguna di Pengaturan perusahaan tiap tahun (tidak ditanam di kode karena berubah-ubah).
