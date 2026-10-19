# Data perusahaan klien: penyimpanan, ekspor, penghapusan, dan jaminan keamanan

Dokumen ini menjelaskan bagaimana SANSU menjaga database klien, apa hak pemilik perusahaan atas datanya, dan apa yang harus dilakukan pemilik layanan. Isinya mengikuti kode; angka dan nama merujuk berkas di repositori.

## 1. Di mana data klien

Semua klien berbagi satu database PostgreSQL. Setiap baris membawa penanda perusahaan (`tenant_id`), dan database sendiri yang membatasi akses per perusahaan (row-level security, RLS). Lihat `docs/ISOLASI-DATA.md` untuk lapisan pengamannya. Lokasi fisiknya bergantung pada cara deploy: Neon (jalur Railway) atau kontainer di server sendiri (jalur VPS).

## 2. Jaminan yang diperiksa terus-menerus (postur keamanan database)

`SecurityPostureService` (`modules/data-rights/security-posture.ts`) memeriksa bahwa pemisahan antar perusahaan benar-benar berlaku **di database yang sedang dipakai**, bukan hanya di kode:

| Pemeriksaan | Kritis? | Isi |
|---|---|---|
| Peran aplikasi `sansu_app` tunduk pada RLS | ya | bukan superuser dan tidak memiliki `BYPASSRLS` |
| RLS tidak dimatikan lewat `RLS_DISABLED` | ya | pengaturan darurat tidak boleh aktif |
| Semua tabel data perusahaan dilindungi RLS | ya | tabel ber-`tenant_id` dan tabel anak (rantai foreign key) wajib ber-RLS dan berkebijakan; satu-satunya pengecualian `auth_tokens` (hanya lewat token hash sekali pakai) |
| Uji langsung isolasi | ya | dengan lingkup satu perusahaan, baris perusahaan lain harus tidak terlihat; perusahaan tak dikenal melihat 0 baris |
| Koneksi database memakai TLS | peringatan | wajar tanpa TLS di jaringan privat; wajib TLS bila lewat internet |

Dijalankan saat aplikasi start (**produksi menolak start bila ada pemeriksaan kritis yang gagal**), setiap 24 jam (kegagalan dicatat sebagai galat), dan dapat dibaca pemilik layanan di Panel SANSU › **Keamanan data** (atau `GET /api/platform-admin/security-posture`). Tabel baru yang lupa diberi RLS otomatis membuat pemeriksaan ini gagal.

## 3. Ekspor seluruh data (hak portabilitas)

Pemilik perusahaan (hanya OWNER) membuka **Pengaturan › Data & privasi › Ekspor seluruh data**.

1. **Verifikasi ulang:** kata sandi saat ini dan, bila verifikasi 2 langkah aktif, kode TOTP atau kode cadangan. Lima percobaan gagal dalam 15 menit mengunci verifikasi sementara (dicatat di jejak audit, berlaku lintas instance).
2. Server menerbitkan **tautan unduh sekali pakai** (berlaku 5 menit; hanya hash tokennya yang disimpan). Ekspor beruntun dibatasi 10 menit. Pemilik dan admin menerima email pemberitahuan.
3. Tautan mengalirkan **arsip ZIP** langsung ke browser: satu CSV per tabel (UTF-8 + BOM, pemisah koma), `manifest.json` (jumlah baris, kolom, dan checksum SHA-256 tiap berkas), dan `README.txt`.

Jaminan:
- **Isolasi:** pembacaan dilakukan dalam satu snapshot database (repeatable read, hanya baca) di bawah lingkup RLS perusahaan peminta, ditambah filter `tenant_id` eksplisit. Tabel yang diekspor ditentukan dari katalog database, jadi tabel baru otomatis ikut.
- **Tanpa rahasia:** kolom bernama password/secret/token/credential/key_hash/api_key/backup_codes tidak pernah ikut (tercatat di manifest sebagai `excludedColumns`), begitu pula tabel `auth_tokens`, `error_logs`, token ekspor, dan log penghapusan. Kunci bernuansa rahasia pada pengaturan perusahaan dibuang.
- **Keutuhan:** checksum tiap CSV tercantum di manifest.
- **Keamanan berkas:** sel teks yang diawali `=`, `+`, `-`, atau `@` diberi apostrof agar tidak dijalankan sebagai rumus di Excel/Sheets.
- **Jejak:** `DATA_EXPORT_REQUEST`, `DATA_EXPORT`, dan `DATA_EXPORT_FAILED` tercatat di audit.

Tetap bisa dipakai walau langganan habis atau email belum diverifikasi: data adalah milik klien.

## 4. Penghapusan seluruh data perusahaan

Karena tidak dapat dibatalkan, penghapusan memiliki banyak pengaman:

1. Hanya **OWNER**, dengan verifikasi ulang (sama seperti ekspor), mengetik **nama perusahaan**, dan menyatakan memahami kewajiban menyimpan pembukuan/dokumen pajak.
2. **Masa tenggang** (bawaan 30 hari, `DATA_DELETION_GRACE_DAYS`, minimal 7). Pemilik dan admin diberi email saat permintaan dibuat, diingatkan tiap 3 hari dalam 7 hari terakhir, dan dapat **membatalkan** kapan saja (OWNER atau ADMIN).
3. Penghapusan **menunggu ekspor data diunduh**, kecuali pemilik secara eksplisit memilih "hapus tanpa menunggu ekspor". Bila jatuh tempo tanpa ekspor, data **tidak** dihapus dan pemilik diingatkan.
4. **Penahanan oleh pemilik layanan** (mis. sengketa atau permintaan hukum) di Panel SANSU › **Keamanan data** (tombol Tahan/Lepas, alasan wajib), atau lewat API: `POST /api/platform-admin/data-deletions/:id/hold` dengan alasan; `.../release` untuk melepas. `GET /api/platform-admin/data-deletions` menampilkan permintaan dan bukti penghapusan.
5. Perusahaan yang memuat akun pemilik layanan tidak dapat dihapus lewat jalur ini.
6. Eksekusi oleh penjadwal (cek tiap 6 jam), dalam **satu transaksi** di koneksi admin:
   - tabel yang dihapus ditentukan dari katalog database (tabel ber-`tenant_id` dan seluruh turunannya lewat foreign key), anak lebih dulu;
   - bila ada tabel tanpa `tenant_id` yang tidak bisa dikaitkan ke perusahaan (skema berubah tanpa penyesuaian) atau ada ketergantungan melingkar, **penghapusan berhenti dan tidak ada yang terhapus**;
   - sesudah menghapus, jumlah baris tiap tabel harus turun **persis** sebanyak baris milik perusahaan itu dan tidak boleh ada baris tersisa bertanda perusahaan itu; selisih sekecil apa pun membatalkan seluruh transaksi;
   - semua sesi dicabut selama proses; bila gagal, hanya pengguna yang tadinya aktif diaktifkan kembali dan pemilik layanan diberi tahu lewat Telegram.
7. **Bukti** disimpan di `data_erasure_log` tanpa data bisnis: nama perusahaan, peminta, waktu, jumlah baris per tabel, dan apakah ekspor dilepas. Hanya terlihat oleh pemilik layanan.

Diuji pada data demo yang kaya (puluhan tabel): perusahaan lain tetap identik jumlah barisnya dan tidak ada baris anak yatim.

### Yang tidak dicakup penghapusan
- **Cadangan:** salinan di cadangan database (mis. jendela pemulihan Neon, backup VPS) tetap ada sampai masa retensinya habis. Atur retensi cadangan dan beri tahu klien lamanya.
- **Salinan klien:** arsip ekspor yang diunduh adalah tanggung jawab klien.
- **Catatan akuntabilitas:** `data_erasure_log` menyimpan nama perusahaan dan email peminta sebagai bukti.
- **Penghapusan data per orang** (mis. satu pelanggan yang meminta dilupakan) belum ada: pembukuan wajib dipertahankan, dan nama muncul juga di teks bebas dokumen sehingga anonimisasi parsial tidak bisa dijamin lengkap.

## 5. Yang perlu ditinjau advokat
- Jangka waktu penyimpanan pembukuan dan dokumen pajak yang wajib, dan apakah penyedia layanan boleh/harus menahan data selama itu.
- Dasar hukum permintaan penghapusan (UU PDP) dibanding kewajiban retensi, dan isi teks yang diakui pemilik saat meminta penghapusan.
- Retensi cadangan dan pemberitahuan kepada klien.
