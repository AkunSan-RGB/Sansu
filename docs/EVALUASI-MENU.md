# Evaluasi menu dan hak akses

Pemeriksaan menyeluruh: apakah setiap menu yang tampil untuk sebuah peran benar-benar bisa dibuka datanya oleh peran itu?
Caranya: pasangkan setiap item menu → halaman → alamat API yang dipanggil halaman → peran yang diizinkan server, lalu bandingkan dengan peran yang melihat menu.

## Temuan dan perbaikan

| Temuan | Perbaikan |
|---|---|
| Admin melihat CRM tetapi API hanya untuk Sales (Admin hanya bisa mengatur tahap) | Admin diberi akses CRM |
| Admin boleh memposting gaji (bila belum ada Akuntan) tetapi tidak bisa melihat daftar penggajian | Admin boleh melihat daftar/slip/rekap penggajian |
| Admin mengatur jadwal shift tetapi daftar pegawai ditolak (butuh data gaji) | Endpoint nama pegawai tanpa data gaji: `/shifts/staff`, `/payroll/service/staff` |
| Kotak tugas menyuruh Admin menyetujui cuti, padahal hanya SDM yang berhak | Tugas cuti hanya untuk SDM |
| Gudang melihat Faktur & piutang, Uang muka, Daftar harga, Promo, Kanvas, Marketplace → ditolak server | Menu disembunyikan untuk peran yang tidak berhak |
| Admin melihat Kasir (layar kasir, meja, dapur, riwayat sesi) padahal tidak boleh mengoperasikan kasir | Menu kasir hanya untuk Kasir/Sales/Keuangan/Akuntan |
| Pembelian/Sales melihat Produksi, Perputaran, Kedaluwarsa, Penurunan nilai → ditolak | Menu dibatasi ke peran yang berhak membaca |
| Admin melihat Data karyawan, Absensi, Cuti (data SDM) → ditolak | Menu hanya untuk SDM (+ Keuangan/Akuntan untuk data karyawan) |

Semua tautan menu juga dicek punya halaman (`frontend/src/layout/menu.spec.ts`) dan perubahan akses diuji (`backend/test/akses-menu.e2e-spec.ts`).

## Yang sengaja tidak diubah

- Admin tetap **tidak** boleh membaca data lengkap karyawan (gaji, rekening) dan mengoperasikan kasir: itu pemisahan fungsi.
- Beberapa halaman memanggil data pendukung yang tidak boleh dibuka sebagian peran (mis. daftar proyek di halaman faktur pembelian untuk Pembelian): halaman tetap terbuka, bagian itu kosong. Perlu ditinjau bila ada keluhan pengguna.
