# Kontrol pajak

Temuan di `GET /cash/controls` (tab kontrol Kas; muncul di halaman Kontrol keuangan bila PR #147 sudah digabung). Hanya yang berbasis bukti data, bukan tafsir aturan pajak:

- `TAX_NO_NTPN` — setoran pajak (60 hari) tanpa NTPN lebih dari 7 hari.
- `TAX_MANUAL_JOURNAL` — jurnal manual ke akun PPN masukan/keluaran, PPh 21/23/4(2), atau pajak final dipotong.
- `PPH21_UNPAID` — PPh 21 yang dipotong di slip gaji suatu masa, tetapi setoran PPh 21 masa itu tercatat lebih kecil, setelah lewat tanggal 10 bulan berikutnya.

Batas jujur: tenggat memakai kebiasaan umum dan harus ditinjau konsultan pajak; temuan PPN (selisih faktur vs buku besar), PPh 23, dan e-Faktur belum ada karena sumbernya beragam dan rawan salah tanda. Daftar periksa pajak dan peringatan ambang pajak yang sudah ada tetap berlaku.
