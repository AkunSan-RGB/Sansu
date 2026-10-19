# Deploy SANSU di Railway (satu layanan)

Satu layanan Railway menjalankan **API + tampilan web** sekaligus (satu alamat: web di `/`, API di `/api`), ditambah satu database Postgres.
Tanpa nginx, tanpa CORS, tanpa pengalihan `/api`. Berkas yang dipakai: `railway.json` → `deploy/railway/Dockerfile`.

## Langkah (sekali)

1. railway.com › **New Project** › **Deploy from GitHub repo** › pilih `Sansu`.
   (Tanpa GitHub: pasang Railway CLI, lalu `railway up` dari akar folder proyek.)
2. Di project yang sama: **+ New** › **Database** › **Add PostgreSQL**.
3. Buka layanan **Sansu** › tab **Variables** › isi:

   | Variabel | Nilai |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (pilih lewat menu "Add Reference") |
   | `JWT_SECRET` | teks acak ≥ 32 karakter: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `DATA_ENCRYPTION_KEY` | **wajib** (aplikasi menolak start tanpanya): kunci enkripsi token pihak ketiga, acak ≥ 32 karakter dan **berbeda** dari `JWT_SECRET`: `openssl rand -base64 48`. Simpan di tempat aman (salinan terpisah dari server) dan jangan diubah setelah diisi: kunci ini juga mengenkripsi NIK, NPWP, dan nomor rekening, yang **tidak terbaca lagi** bila kuncinya hilang atau berganti. Data yang sudah terenkripsi dengan kunci lama (turunan `JWT_SECRET`) tetap terbaca. |
   | `BACKUP_RETENTION_DAYS` | opsional: lama (hari) cadangan database menyimpan data; ditampilkan ke klien saat meminta penghapusan data. Samakan dengan jendela pemulihan/retensi backup di Neon atau server. |
   | `BACKUP_REPORT_TOKEN` | opsional tetapi disarankan: acak ≥ 24 karakter; mengaktifkan laporan status backup ke Panel SANSU dan peringatan Telegram bila backup gagal/basi. Pelaksana backup (GitHub Actions): lihat `docs/OPERASIONAL.md`. |
   | `APP_URL` | alamat publik layanan, mis. `https://sansu-production.up.railway.app` (diisi setelah langkah 4) |
   | `CORS_ORIGIN` | sama dengan `APP_URL` |
   | `PLATFORM_ADMIN_EMAILS` | email pemilik layanan (akses panel pemilik) |
   | `BREVO_API_KEY` | kunci API Brevo (Brevo › SMTP & API › **API Keys**). Email lewat HTTPS, jadi jalan di Railway |
   | `BREVO_SENDER_EMAIL` `BREVO_SENDER_NAME` | pengirim: alamat yang **sudah diverifikasi** di Brevo, dan nama tampilan (mis. `SANSU`) |
   | `MAIL_REPLY_TO` (opsional) | alamat balasan |

   `NODE_ENV=production` dan `WEB_DIST` sudah diatur di Dockerfile. `PORT` disuntikkan Railway otomatis.
4. Tab **Settings** › **Networking** › **Generate Domain**. Salin alamatnya ke `APP_URL` dan `CORS_ORIGIN`, lalu **Redeploy**.
5. Buka alamat itu: halaman login SANSU tampil. Cek `https://<alamat>/api/health` → `{"status":"ok","database":"up",...}`.

Migrasi database dijalankan otomatis setiap start. Healthcheck Railway memakai `/api/health`.

## Bila bermasalah

| Gejala | Penyebab umum |
| --- | --- |
| Deploy gagal "Konfigurasi produksi tidak aman" | `JWT_SECRET` kurang dari 32 karakter atau memuat kata `ganti`/`secret`/`rahasia` |
| Healthcheck gagal (503 `database: down`) | `DATABASE_URL` belum diisi atau salah referensi ke layanan Postgres |
| Halaman terbuka tetapi login gagal | `APP_URL`/`CORS_ORIGIN` belum sama dengan alamat publik; cek tab **Logs** |
| Email tidak terkirim | `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` belum diisi, atau pengirim belum diverifikasi di Brevo (lihat tab Logs: "Brevo menolak email (401/400)"). Jangan pakai `SMTP_*` di Railway: port SMTP diblokir pada paket gratis/Hobby |
| Migrasi gagal "Peran sansu_app sudah ada…" | lihat catatan RLS di `docs/ARCHITECTURE.md` (peran dibuat pengguna database lain) |

## Cadangan
Aktifkan **Backups** pada layanan Postgres di Railway, dan uji pemulihan ke database sementara sebelum dipakai data asli.

## Pastikan isolasi antar perusahaan (RLS) aktif di produksi

Aplikasi berganti ke peran database `sansu_app` (tanpa hak melewati RLS) pada setiap koneksi, jadi pemisahan data tetap berlaku walau `DATABASE_URL` memakai pengguna pemilik. Yang bisa mematikannya hanya salah konfigurasi. Cek sekali setelah deploy pertama dan setelah migrasi besar.

1. **Variabel lingkungan:** di Railway › service API › Variables, pastikan **tidak ada** `RLS_DISABLED=true` (saklar darurat untuk diagnosis saja).
2. **Jalankan tiga pemeriksaan ini** di Railway › Postgres › Data › Query (atau `psql`):

```sql
-- a) peran harus ada, bukan superuser, tidak melewati RLS  → harapan: rolsuper = f, rolbypassrls = f
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sansu_app';

-- b) tabel ber-tenant_id tanpa RLS  → harapan: 0 baris
SELECT c.relname FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND NOT c.relrowsecurity;

-- c) perusahaan asing tidak boleh melihat apa pun  → harapan: semua 0
BEGIN;
SET LOCAL ROLE sansu_app;
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.bypass_rls', 'off', true);
SELECT (SELECT count(*) FROM invoices) AS faktur, (SELECT count(*) FROM journal_entries) AS jurnal;
ROLLBACK;
```

3. Bila (a) kosong atau (b)/(c) tidak sesuai harapan, jalankan ulang migrasi (`npm run db:migrate`) dan hubungi pengelola database; jangan menerima data pelanggan sungguhan sebelum semuanya sesuai.
4. Batas yang perlu diketahui: pemeriksaan ini hanya membuktikan pembatas database. Ia bukan pengganti uji penetrasi independen.
