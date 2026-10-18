# Kontrol keuangan: kas vs bank dan penggajian

Temuan tambahan di `GET /cash/controls` (halaman Kontrol keuangan / tab kontrol Kas).

**Catatan vs rekening koran** (hanya untuk rekening yang mutasinya sudah diimpor)
- `BANK_OUT_UNRECORDED` (error) — uang keluar di rekening koran belum dicocokkan/dicatat > 7 hari.
- `BANK_IN_UNRECORDED` (peringatan) — uang masuk di rekening koran belum dicocokkan > 7 hari.
- `BANK_OUT_NOT_IN_STATEMENT` (error) — uang keluar tercatat di buku pada periode mutasi yang sudah diimpor, tetapi tidak ada baris bank yang cocok (kemungkinan pembayaran fiktif).
- `BANK_BALANCE_DIFF` (peringatan) — saldo akhir rekening koran terbaru ≠ saldo buku pada tanggal yang sama.

**Penggajian**
- `PAYROLL_JUMP` — total gaji bersih berubah > 20% dari bulan sebelumnya.
- `PAYROLL_AFTER_RESIGN` (error) — slip gaji untuk karyawan yang tanggal berhentinya sebelum periode.
- `PAYROLL_OTHER_INCOME` — tambahan penghasilan manual ≥ Rp1 juta atau ≥ 20% gaji pokok (90 hari).
- `PAYROLL_NO_BANK` (info) — karyawan aktif bergaji tanpa nomor rekening.
- Yang sudah ada sebelumnya: pemisahan HR (menyusun) / Akuntan atau Admin (memposting) / Keuangan (membayar), NIK/NPWP/rekening ganda ditolak, perubahan data sensitif karyawan jasa butuh persetujuan.

**Belum dikerjakan**: temuan khusus pajak (saat ini ada daftar periksa pajak dan peringatan ambang pajak); ini perlu ditinjau konsultan pajak. Temuan bank bergantung pada mutasi yang diimpor: tanpa impor, tidak ada pembanding.
