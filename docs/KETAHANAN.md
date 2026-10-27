# Ketahanan: beban serentak, jaringan buruk, kirim ulang

Hasil uji beban lokal (4 CPU, satu proses server, database di mesin yang sama, data demo). Angka bukan angka produksi; fungsinya membuktikan perilaku, bukan menjanjikan kapasitas.

## Yang ditemukan dan diperbaiki
| Temuan | Perbaikan |
|---|---|
| 100 kas keluar atau setoran pajak serentak membekukan server permanen (kolam 10 koneksi; tiap transaksi memegang satu koneksi dan meminta koneksi kedua untuk membaca pengaturan) | Pembaca pengaturan, aplikasi, kewajiban pajak, kategori aset, alur kerja, rute kirim, dan upah jasa menerima `tx`. Pemberitahuan latar belakang berjalan di luar transaksi |
| Permintaan yang tidak kebagian koneksi menggantung selamanya | Batas tunggu koneksi `DB_POOL_WAIT_MS` (bawaan 20 dtk), isi kolam `DB_POOL_MAX` (bawaan 10) |
| Kode ganda saat pendaftaran serentak (aset: 409 `fixed_assets_code_uq`; pelanggan CRM) | Kode dari hitungan baris diserialkan per perusahaan |
| 100 kas keluar serentak lolos 24 kali pada saldo yang cukup untuk 15 (saldo jadi negatif) | Pemeriksaan saldo diserialkan per akun kas; kini tepat 15 |
| Kirim ulang karena jawaban hilang menggandakan transaksi | Header `Idempotency-Key` (tabel `idempotency_keys`, migrasi 0104): jawaban pertama diputar ulang |
| Peramban menunggu tanpa batas | Batas waktu 45 dtk (180 dtk untuk impor/ekspor); pesan menyatakan transaksi MUNGKIN sudah tersimpan |

## Pengaman agar tidak terulang
- `TenantPool` mendeteksi koneksi kedua yang dibuka di dalam transaksi: **galat di mode tes** (rangkaian e2e menangkapnya), peringatan berlimit di produksi.
- `backend/test/konkurensi-kolam.e2e-spec.ts`: 40 permintaan serentak (lebih banyak dari isi kolam) untuk kas keluar, pajak, uang muka, jurnal, aset, dan saldo.
- `backend/test/idempotensi.e2e-spec.ts`.

## Hasil ukur setelah perbaikan (lokal)
- 100 pengguna membaca selama 30 detik: 5.465 permintaan, 0 galat, p50 28 ms, p95 162 ms, p99 470 ms.
- 100 serentak: kas keluar, jurnal manual, penyesuaian stok, pesanan penjualan, setoran pajak: tidak ada yang macet; kas keluar tepat 15 berhasil dari saldo yang cukup untuk 15.

## Batas yang jujur
- Belum diuji: beban berhari-hari, data jutaan baris, banyak proses server sekaligus, gangguan jaringan nyata (hanya kode dan uji lokal).
- Batas laju 600 permintaan/menit per IP: kantor dengan satu IP publik dan banyak pengguna bisa kena 429; atur `RATE_LIMIT_PER_MIN`.
- Pembuatan permintaan persetujuan di dalam transaksi kas keluar masih memakai koneksi terpisah (jarang terjadi).

## Tambahan: batas waktu database, galat tampilan, uji beban serentak

- **Batas waktu database** (pool aplikasi, bukan migrasi): `DB_STATEMENT_TIMEOUT_MS` (default 60 dtk) membatalkan kueri yang macet,
  `DB_IDLE_TX_TIMEOUT_MS` (default 60 dtk) memutus transaksi yang dibiarkan menganggur dan melepas kuncinya. 0 = tanpa batas.
  Galat 57014/25P03 (waktu habis), 40P01 (kebuntuan), 40001 (gagal serialisasi), 55P03 (kunci tidak tersedia) dijawab 503 dengan pesan
  "tidak ada data yang tersimpan setengah jalan, coba lagi" — transaksinya sudah dibatalkan seluruhnya sehingga aman diulang.
- **Galat tampilan:** `ErrorBoundary` terluar dan per rute. Halaman yang gagal tampil menjadi pesan dengan "Coba lagi"/"Muat ulang", menu tetap berfungsi;
  galat memuat potongan kode (rilis baru saat tab lama terbuka) diarahkan ke muat ulang.
- **Kunci idempotensi:** `api()` menambahkannya otomatis pada semua POST/PUT/PATCH/DELETE (kecuali `/auth/`) dan mempertahankannya saat jawaban tidak datang
  (jaringan putus/waktu habis). Diuji di `frontend/src/api/client.test.ts` dan di fase jaringan buruk uji beban.
- **Uji beban serentak:** lihat [UJI-BEBAN-SERENTAK.md](UJI-BEBAN-SERENTAK.md).
