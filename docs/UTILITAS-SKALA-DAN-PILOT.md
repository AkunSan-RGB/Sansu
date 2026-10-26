# Utilitas air: skala 10.000 pelanggan dan panduan pilot

Dokumen ini jujur tentang apa yang sudah diuji, apa yang belum, dan langkah menuju operasi nyata.

## 1. Hasil uji beban (data sintetis, 1 server, 1 database)

Data: 10.000 sambungan, ±30.000 tagihan, satu perusahaan.

| Operasi | Sebelum | Sesudah | Catatan |
|---|---|---|---|
| Cari tagihan di loket | tidak selesai (hang) | cepat (<1 dtk) | indeks `service_invoice_lines(invoice_id)` (migrasi 0112) |
| Tagih bulanan 10.000 sambungan | ±160 dtk dalam satu permintaan | berjalan di latar, progres tampil | migrasi 0113; ±64 faktur/dtk, serial karena penomoran dokumen |
| Impor 300 baris | - | ±6 dtk simpan, 0,1 dtk pratinjau | UI memecah per bagian; 10.000 baris ±3 menit |
| Impor ulang berkas sama | - | semua dilewati, tanpa duplikat | idempoten |

Tagih berlatar aman diulang: klaim periode unik (sambungan, periode), pekerjaan macet >3 menit diambil ulang.

## 2. Fitur kesiapan skala

- **Tagih berlatar**: tombol Tagih memulai pekerjaan, halaman menampilkan progres, boleh ditutup.
- **Impor massal**: pelanggan + sambungan dari CSV/Excel, pratinjau dulu, ulang aman.
- **Virtual account**: tiap sambungan punya nomor VA (awalan perusahaan + 8 digit). Bank/agregator memanggil
  `POST /api/ingest/utility/va-payments` dengan header `X-Api-Key` dan isi
  `{"vaNumber","amount","reference","paidAt","channel"}`. `reference` unik, panggilan ulang tidak menggandakan.
- **Antrean pesan**: pesan tagihan/peringatan masuk antrean, dikirim lewat penyedia webhook (WhatsApp/SMS) dengan
  coba ulang 3 kali. Penyedia diatur di menu Antrean pesan (alamat https, kunci, templat JSON).

## 3. Batas yang diketahui (belum selesai)

1. Beberapa daftar masih dibatasi 500/1000 baris dan diberi peringatan di layar; belum ada paginasi server sejati
   (sambungan, jatuh tempo, daftar kerja, kandidat).
2. Pratinjau tagihan memuat semua baris sekaligus; untuk 10.000 sambungan lambat dan berat di peramban.
3. Uji beban memakai satu server; belum diuji banyak pengguna bersamaan.
4. Integrasi VA diuji dengan simulasi webhook, belum dengan bank/agregator nyata (format tiap bank berbeda,
   mungkin perlu adaptor dan verifikasi tanda tangan).
5. Pengiriman pesan diuji dengan server tiruan, belum dengan penyedia WhatsApp/SMS nyata.
6. Belum ada tinjauan hukum/pajak (tarif, PPN/non-PPN, materai, perda tarif air) oleh pihak berwenang.
7. Tidak ada pilot nyata. Kesiapan produksi 10.000 pelanggan tetap "belum" sampai pilot di bawah lulus.

## 4. Rencana pilot

**Cakupan**: satu wilayah/zona, 100-500 sambungan, 2-3 siklus tagihan (≈ 3 bulan), sistem lama jalan paralel.

**Persiapan (minggu 0)**
- Cadangan penuh database sebelum impor; uji pulihkan di server lain.
- Impor pelanggan lewat pratinjau, cocokkan 20 sampel dengan data lama (nama, alamat, meter, tarif, saldo awal).
- Saldo awal piutang diinput lewat menu saldo awal; cocokkan total dengan buku lama.
- Atur tarif bertingkat, denda, biaya admin; hitung 10 tagihan sampel manual dan bandingkan.
- Buat pengguna sesuai peran: kasir loket, petugas lapangan, pelayanan pelanggan, keuangan.
- Atur VA dan penyedia pesan di lingkungan uji dulu, kirim satu pembayaran dan satu pesan percobaan.

**Siklus (tiap bulan)**
1. Petugas catat meter (lapangan/impor) → periksa taksiran dan anomali.
2. Tagih (latar) → bandingkan jumlah dan total dengan sistem lama.
3. Kirim tagihan otomatis, pantau antrean (gagal/ditunda).
4. Pembayaran loket + VA; rekap harian per loket dan konfirmasi Keuangan.
5. Akhir bulan: laporan piutang, umur piutang, NRW, kinerja; cocokkan dengan buku besar.

**Kriteria lulus** (semua terpenuhi pada 2 siklus berturut-turut)
- Selisih total tagihan vs perhitungan manual: 0 pada sampel, ≤0,1% pada total.
- Piutang di laporan = buku besar akun piutang.
- Pembayaran VA otomatis cocok ≥99%, sisanya ditangani manual tanpa kehilangan.
- Tidak ada tagihan ganda, tidak ada pembayaran hilang.
- Waktu tagih bulanan wilayah pilot < 5 menit; halaman utama terbuka < 3 detik.
- Pemulihan cadangan teruji.

**Hentikan/ulang pilot bila**: ada selisih saldo tak terjelaskan, tagihan ganda, atau VA salah alokasi.

## 5. Operasional sebelum seluruh 10.000

- Server: minimal 4 vCPU, 8 GB RAM, database terpisah dengan cadangan harian dan uji pulih bulanan.
- Pantau: antrean pesan gagal, pekerjaan tagih macet, webhook VA ditolak, waktu respons.
- Tuntunan insiden: VA salah alokasi (koreksi lewat menu Koreksi tagihan), pesan massal tertahan (jeda antrean).
- Setelah pilot lulus: perluas per zona (bukan sekaligus), selesaikan batas nomor 1 dan 2 di bagian 3 lebih dulu.
- Libatkan akuntan/pajak untuk meninjau tarif, PPN, dan perlakuan akuntansi sebelum tagihan resmi pertama.
