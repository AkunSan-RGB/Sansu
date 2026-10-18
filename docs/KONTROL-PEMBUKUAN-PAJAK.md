# Kontrol pembukuan & pajak

Menu **Akuntansi › Laporan › Kontrol pembukuan & pajak** (`/accounting-controls`, `GET /accounting-controls`; Pemilik, Admin, Keuangan, Akuntan).

Satu daftar temuan yang menggabungkan:
- **Pemeriksaan kesehatan pembukuan** (`/accounting/health`) yang berstatus WARN/ERROR → temuan `HEALTH_*` (neraca saldo, persamaan akuntansi, kas negatif, saldo tidak wajar, jurnal tanpa bukti, jurnal bertanggal ke depan, rekonsiliasi bank, penyusutan, NRV persediaan, kurs, penyisihan piutang, ekuitas, kunci periode, pemisahan fungsi, setoran pajak, ambang pajak, dsb.).
- **Daftar periksa pajak** (`/tax/focus`) yang berstatus PERLU → temuan `TAXFOCUS_*`.
- **`JE_BACKDATED`**: jurnal bertanggal lebih dari satu bulan penuh sebelum dibuat (60 hari terakhir), di luar jurnal berulang, pembalik, penutup, saldo awal, dan penyesuaian. Tanda angka bulan yang sudah dilaporkan berubah.

Temuan kas/bank, jurnal manual, dan pajak berbasis bukti tetap ada di **Kontrol keuangan** (`/cash/controls`).

Batas jujur: halaman ini hanya memeriksa kelengkapan dan kewajaran data; kunci periode tetap pengingat (bukan paksaan otomatis); pencocokan PPN faktur vs buku besar belum ada; perhitungan pajak perlu ditinjau konsultan pajak. Bagan akun tidak bisa diubah/dihapus lewat API (hanya ditambah), sehingga tidak ada temuan perubahan akun.
