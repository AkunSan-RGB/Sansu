# Kebijakan migrasi, pemulihan, dan audit dependensi

## Kebijakan migrasi database

- **Hanya maju (forward-only).** Berkas `backend/drizzle/*.sql` tidak pernah diedit setelah digabung. Kesalahan diperbaiki dengan migrasi baru.
- **Cadangan sebelum migrasi.** Sebelum menerapkan migrasi di produksi, ambil `pg_dump` penuh. Rollback = pulihkan cadangan itu, bukan menjalankan migrasi mundur
  (migrasi mundur otomatis tidak ada dan tidak dijanjikan).
- **Perluas lalu susutkan (expand/contract).** Perubahan yang merusak dibagi dua rilis: rilis 1 menambah kolom/tabel baru dan kode yang bisa memakai keduanya;
  rilis 2 (setelah rilis 1 stabil) baru menghapus yang lama. Dengan begitu kode versi sebelumnya tetap jalan bila rilis dibatalkan.
- **Uji pada salinan data sebelum rilis:** `backend/scripts/uji-migrasi.sh`. Skrip menyalin database (TEMPLATE), menerapkan migrasi baru pada salinan itu,
  lalu memeriksa jumlah tabel/baris. Skrip **gagal keras** bila `pg_dump` tidak cocok versi atau salinan kosong (0 tabel), bukan lulus palsu.
- Migrasi yang mengubah tabel besar (mis. `utility_bills`, `journal_lines`) harus diuji pada salinan berukuran produksi untuk mengukur lama kunci tabel.

## Audit dependensi (`npm audit`)

| Paket | Tindakan / penilaian |
|---|---|
| nodemailer | **Dinaikkan** ke versi yang menutup kerentanan yang dilaporkan. |
| multer | Terdeteksi namun **tidak dipakai** kode aplikasi (tidak ada import). Risiko praktis nol; dihapus saat pembersihan berikutnya. |
| xlsx | Tidak ada versi perbaikan di npm. Dipakai **di sisi klien** untuk berkas milik pengguna sendiri, bukan input pihak ketiga ke server. Risiko diterima, dipantau. |
| exceljs / uuid | Kerentanan tidak terjangkau dari cara pakai kami (tidak memakai fungsi yang terdampak). |
| swagger / js-yaml | Hanya dokumentasi API, tidak aktif di produksi. |

Sisa temuan **tidak dihilangkan**; yang tercatat di sini adalah penilaian risikonya. Tinjau ulang tiap rilis dengan `npm audit`.
