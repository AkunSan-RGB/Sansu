# Kesiapan operasional SANSU (daftar periksa pemilik layanan)

Dokumen ini untuk **pemilik layanan**. Semua langkah dilakukan di Railway, Neon, atau penyedia terkait; jangan menempelkan kunci/sandi ke chat atau repositori.

## 1. Backup database
Data pelanggan ada di Postgres (Neon). Backup yang tidak pernah diuji pemulihannya belum bisa disebut backup.

- [ ] **Neon:** buka *Project → Settings → Storage / Restore window*; atur jendela pemulihan (point-in-time restore) selama mungkin sesuai paket (paket berbayar bisa sampai 30 hari). Paket gratis hanya beberapa jam–1 hari: **tidak cukup untuk produk berbayar**.
- [ ] **Salinan di luar Neon:** jadwalkan `pg_dump` mingguan (atau harian) ke penyimpanan lain (mis. Cloudflare R2/Wasabi/Google Drive) memakai `DATABASE_URL` dari komputer/CI Anda. Simpan minimal 30 hari. Enkripsi file bila berisi data pelanggan.
- [ ] **Uji pemulihan** (sekali sebulan): buat *branch* Neon dari titik waktu kemarin, jalankan aplikasi ke branch itu, pastikan login dan laporan terbuka. Catat tanggal dan hasilnya di bawah.
- [ ] Sebelum setiap rilis yang mengubah database (migrasi): buat *branch* Neon sebagai titik kembali.
- Backup VPS (bila memakai `docker-compose.prod.yml`) sudah otomatis; lihat `docs/PANDUAN-SERVER.md` bagian 4.

| Tanggal uji pemulihan | Hasil | Catatan |
| --- | --- | --- |
|  |  |  |

## 2. Pemantauan error dan ketersediaan
Bawaan aplikasi: setiap galat server (5xx) dicatat di tabel `error_logs` (disimpan 30 hari) dan dikirim ke pemilik layanan lewat Telegram dan email dengan pembatasan agar tidak membanjir. Lihat di **Panel SANSU**.

- [ ] Isi variabel Railway `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` (token hanya di Railway). Uji dengan tombol uji peringatan di Panel SANSU.
- [ ] Pastikan `PLATFORM_ADMIN_EMAILS` hanya berisi email Anda.
- [ ] **Uptime monitor** gratis (UptimeRobot / Better Stack): pantau `https://<domain-anda>/api/health` tiap 5 menit, beri peringatan ke WhatsApp/email.
- [ ] **Email:** di Brevo matikan pembatasan IP (IP Railway berubah-ubah) dan verifikasi domain pengirim (SPF, DKIM, DMARC); gunakan alamat di domain sendiri, bukan Gmail.
- [ ] Pantau tab **Metrics** dan **Logs** Railway minggu pertama setelah pelanggan masuk.

## 3. Dokumen hukum
Halaman publik sudah tersedia: `/syarat-layanan` dan `/kebijakan-privasi`; pendaftaran mewajibkan persetujuan dan mencatat waktu serta versinya (`tenants.settings.legal`).

- [ ] **Minta advokat/konsultan hukum meninjau** kedua dokumen sebelum dijual luas (draf ini bukan nasihat hukum). Perhatikan: batas tanggung jawab, masa retensi data, lokasi server di luar Indonesia, dan UU PDP (UU 27/2022).
- [ ] Cantumkan kontak resmi (email/WhatsApp) untuk permintaan hak data pribadi.
- [ ] Bila isi dokumen diubah, naikkan `LEGAL_VERSION` di `shared/src/legal.ts`.

## 4. Panduan pelanggan
- Pusat Bantuan di dalam aplikasi (tombol "?" dan menu Bantuan) memuat artikel langkah demi langkah, termasuk cabang, anggaran, bank, dan kas kecil.
- [ ] Siapkan video/PDF singkat "10 menit pertama" dan kirim bersama email selamat datang.
- [ ] Tentukan jam layanan dukungan dan waktu respons, lalu cantumkan di invoice langganan.

## 5. Sebelum menerima pelanggan berbayar
- [ ] Pilot 2–3 pelanggan nyata (gratis) beberapa minggu, kumpulkan masukan.
- [ ] Akuntan/konsultan pajak meninjau laporan dan perhitungan pajak.
- [ ] Aktifkan pembayaran online (Midtrans) atau pastikan alur transfer manual jelas.
