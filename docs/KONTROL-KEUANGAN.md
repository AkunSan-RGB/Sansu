# Kontrol keuangan

Menu **Kas & Bank › Kontrol keuangan** (`/finance-controls`, data dari `GET /cash/controls`). Temuan 60 hari terakhir.

**Kas & bank** (sudah ada, kini terkumpul di satu halaman): uang keluar tanpa bukti, di akhir pekan, dipecah di bawah batas persetujuan; saldo negatif; saldo melebihi batas simpanan; rekening bank lama belum direkonsiliasi; selisih hitung kas; transaksi dibatalkan.

**Jurnal manual** (baru):
- `JE_LARGE` — nilai ≥ batas persetujuan jurnal manual (bila batas 0: Rp10 juta).
- `JE_CONTROL_ACCOUNT` — menyentuh kas/bank, piutang, utang, atau persediaan (seharusnya lewat dokumen).
- `JE_WEEKEND` — bertanggal Sabtu/Minggu.
- `JE_REVERSED_FAST` — dibalik dalam 3 hari.

**Banner "Pengaman belum aktif"**: bila batas persetujuan uang keluar dan jurnal manual keduanya 0, halaman menampilkan banner dengan tombol *Terapkan rekomendasi* (uang keluar ≥ Rp5 juta, jurnal manual ≥ Rp10 juta). Batas diatur di Pengaturan › Perusahaan › Kebijakan.

**Belum dikerjakan**: pendeteksi selisih catatan kas vs mutasi bank yang sudah diimpor (saat ini hanya "belum direkonsiliasi"); penggajian dan pajak belum ditinjau di halaman ini.
