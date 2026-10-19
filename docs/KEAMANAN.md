# Keamanan data klien

Dokumen ini ringkasan kontrol keamanan SANSU yang ada di kode, cara memeriksanya, dan celah yang masih terbuka. Untuk pemilik layanan, pengembang, dan peninjau/penguji eksternal. Isinya dari pembacaan kode dan tes otomatis; **bukan hasil uji penetrasi**.

## 1. Kontrol yang ada

| Area | Kontrol | Lokasi |
|---|---|---|
| Pemisahan perusahaan | Peran database `sansu_app` (tanpa bypass) + RLS per perusahaan pada semua tabel; tabel anak dibatasi lewat induknya; trigger menolak foreign key lintas perusahaan | `drizzle/0038_*`, `0070_*`, `docs/ISOLASI-DATA.md`, tes `isolasi-perusahaan`, `rls` |
| Kata sandi | bcrypt (cost 10), 8–72 karakter, minimal satu huruf dan satu angka | `modules/auth` |
| Login | Kunci sementara 15 menit setelah 8 kegagalan per email; pembatasan permintaan global (`RATE_LIMIT_PER_MIN`, bawaan 600/menit) | `login-limiter.ts`, `app.module.ts` |
| Sesi | JWT 12 jam (`JWT_EXPIRES_IN`); ganti kata sandi atau "keluar dari semua perangkat" menaikkan `tokenVersion` sehingga semua token lama gugur | `auth.service.ts` |
| 2FA | TOTP; kebijakan wajib per peran | `auth/two-factor.ts`, `common/auth/two-factor-policy.ts` |
| Token email | Reset kata sandi dan verifikasi: acak 256 bit, hanya hash yang disimpan, reset kedaluwarsa 60 menit | `common/utils/secret.ts` |
| Rahasia pihak ketiga | Token marketplace dienkripsi AES-256-GCM dengan `DATA_ENCRYPTION_KEY`; produksi menolak start tanpa kunci kuat dan berbeda dari `JWT_SECRET` | `common/utils/secret.ts`, `bootstrap.ts` |
| Hak akses | Peran + matriks rute tunggal; OWNER selalu boleh; peran khusus hanya mempersempit; pemisahan fungsi (pembuat ≠ penyetuju) | `common/auth/route-matrix.ts`, tes `segregation` |
| Validasi masukan | `whitelist` + `forbidNonWhitelisted` (menolak bidang tak dikenal), tipe divalidasi | `bootstrap.ts` |
| Header | CSP ketat (`default-src 'self'`, tanpa skrip sebaris), `frame-ancestors 'none'`, HSTS, `nosniff`, tanpa `x-powered-by`; Caddy menambah CSP yang sama di instalasi VPS | `bootstrap.ts`, `deploy/Caddyfile` |
| Jejak audit | Perubahan penting dicatat (siapa, kapan, sebelum/sesudah); periode pembukuan bisa dikunci | modul `audit` |
| Pemantauan | Galat 5xx dikirim ke Telegram | `docs/OPERASIONAL.md` |

## 2. Daftar periksa produksi (pemilik layanan)

- [ ] `JWT_SECRET` dan `DATA_ENCRYPTION_KEY` acak ≥ 32 karakter, **berbeda satu sama lain**, tersimpan hanya di variabel server (bukan di repositori/chat). Aplikasi menolak start bila salah satunya lemah.
- [ ] `NODE_ENV=production`; `SWAGGER` tidak diisi `true` (dokumentasi API menampilkan seluruh rute).
- [ ] `CORS_ORIGIN` hanya alamat aplikasi sendiri.
- [ ] Koneksi ke database memakai TLS, dan **enkripsi saat disimpan (at rest)** aktif di penyedia database. Data bisnis tidak dienkripsi per kolom; perlindungannya bergantung pada ini.
- [ ] Aplikasi tersambung ke database sebagai peran `sansu_app`, bukan superuser/pemilik (jika tidak, RLS terlewati). Periksa: `SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;` harus `false`.
- [ ] Backup: jendela pemulihan sesuai paket berbayar, salinan terenkripsi di luar penyedia, dan **uji pemulihan tercatat** (lihat `docs/OPERASIONAL.md`).
- [ ] HTTPS dipaksa dan sertifikat valid; header diperiksa dengan `curl -sI https://<domain>/`.
- [ ] Akun pemilik layanan memakai 2FA; `PLATFORM_ADMIN_EMAILS` hanya orang yang berwenang.
- [ ] Pemantauan 5xx dan uptime aktif; ada prosedur insiden (siapa dihubungi, kapan klien diberi tahu).

## 3. Bahan untuk peninjau/penguji eksternal

**Fokus utama (urutan prioritas)**
1. **Pemisahan antar perusahaan (IDOR):** dengan token perusahaan A, coba baca/ubah/hapus objek perusahaan B lewat setiap rute yang menerima ID (faktur, pelanggan, jurnal, laporan, unduhan, impor). Coba juga menyisipkan ID perusahaan B pada badan permintaan perusahaan A (foreign key lintas perusahaan).
2. **Hak akses vertikal:** untuk tiap peran (Kasir, Gudang, Penjualan, Keuangan, Akuntan, HR, peran khusus), panggil rute yang seharusnya ditolak; bandingkan dengan `scripts/rbac-matrix.ts`.
3. **Autentikasi:** brute force dan penguncian, enumerasi email pada login/lupa sandi (respons dan waktu), kedaluwarsa dan pembatalan token, bypass 2FA, tautan reset yang dipakai ulang.
4. **Masukan tak tepercaya:** impor Excel/CSV (ukuran hingga 20 MB), pesanan online via kunci API (`/api/online-orders`), webhook pembayaran dan marketplace, bidang teks yang tampil di PDF/Excel/cetak (injeksi rumus, XSS tersimpan).
5. **Logika bisnis penipuan:** melewati persetujuan, mengubah dokumen setelah periode dikunci, retur/pembatalan berulang, selisih kas disembunyikan.
6. **Konfigurasi:** header, CORS, kebocoran pesan galat/tumpukan jejak, jalur dokumentasi API.

**Akun uji:** buat perusahaan demo ("Buat demo baru") per jenis usaha; tambahkan satu pengguna tiap peran lewat Pengaturan › Pengguna.

**Di luar cakupan:** kerentanan pada penyedia (Neon, Railway, Brevo, Midtrans/Xendit) dan serangan fisik/sosial.

## 4. Celah yang diketahui

| Celah | Dampak | Saran |
|---|---|---|
| Pembatas percobaan login disimpan di memori proses | Hilang saat aplikasi restart dan tidak dibagi bila ada lebih dari satu instance | Pindahkan ke database/Redis sebelum menjalankan beberapa instance |
| JWT berlaku 12 jam tanpa refresh | Token curian berlaku sampai kedaluwarsa kecuali pengguna ganti kata sandi/"keluar dari semua perangkat" | Perpendek masa berlaku untuk peran sensitif atau tambah refresh token |
| bcrypt cost 10 | Cukup, tetapi di bawah rekomendasi terkini untuk perangkat keras baru | Naikkan ke 12 (hash lama tetap berlaku) |
| CSP memakai `style-src 'unsafe-inline'` | Diperlukan Ant Design; membuka injeksi gaya (bukan skrip) | Pantau; pertimbangkan nonce gaya bila pustaka mendukung |
| Data bisnis tidak dienkripsi per kolom | Bocornya cadangan/disk berarti data terbaca | Pastikan enkripsi at rest dan backup terenkripsi |
| Belum ada uji penetrasi independen | Keyakinan berasal dari tinjauan kode dan tes otomatis | Lakukan sebelum layanan berbayar |
| Pengaman ini belum ditinjau untuk UU PDP | Kewajiban hukum belum dipastikan | Tinjau advokat bersama Syarat Layanan dan Kebijakan Privasi |
