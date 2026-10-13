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
