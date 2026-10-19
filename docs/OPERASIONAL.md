# Kesiapan operasional SANSU (daftar periksa pemilik layanan)

Dokumen ini untuk **pemilik layanan**. Semua langkah dilakukan di Railway, Neon, atau penyedia terkait; jangan menempelkan kunci/sandi ke chat atau repositori.

## 1. Backup database
Data pelanggan ada di Postgres (Neon). Backup yang tidak pernah diuji pemulihannya belum bisa disebut backup.

- [ ] **Neon:** buka *Project → Settings → Storage / Restore window*; atur jendela pemulihan (point-in-time restore) selama mungkin sesuai paket (paket berbayar bisa sampai 30 hari). Paket gratis hanya beberapa jam–1 hari: **tidak cukup untuk produk berbayar**.
- [ ] **Salinan di luar Neon:** jadwalkan `pg_dump` mingguan (atau harian) ke penyimpanan lain (mis. Cloudflare R2/Wasabi/Google Drive) memakai `DATABASE_URL` dari komputer/CI Anda. Simpan minimal 30 hari. Enkripsi file bila berisi data pelanggan.
- [ ] **Uji pemulihan** (sekali sebulan): buat *branch* Neon dari titik waktu kemarin, jalankan aplikasi ke branch itu, pastikan login dan laporan terbuka. Catat tanggal dan hasilnya di bawah.
- [ ] Sebelum setiap rilis yang mengubah database (migrasi): buat *branch* Neon sebagai titik kembali.
- Backup VPS (bila memakai `docker-compose.prod.yml`) sudah otomatis; lihat `docs/PANDUAN-SERVER.md` bagian 4.
- **Otomatis lewat SANSU:** langkah "salinan di luar Neon" dan "uji pemulihan" di atas sudah disiapkan sebagai skrip dan jadwal; lihat **Backup database Neon** di bawah. Status terakhirnya tampil di **Panel SANSU › Keamanan data › Backup database** dan Telegram memberi tahu bila backup gagal atau basi.

| Tanggal uji pemulihan | Hasil | Catatan |
| --- | --- | --- |
|  |  |  |

### Backup database Neon (GitHub Actions)

Aplikasi tidak memegang kredensial penyimpanan backup, jadi pelaksananya ada di luar aplikasi: workflow `.github/workflows/backup-database.yml` menjalankan `deploy/backup/external-backup.sh` dan **melapor** ke SANSU.

- **Setiap hari 01:30 WIB (`dump`):** `pg_dump` dari Neon → verifikasi (`pg_restore --list`, harus memuat data tabel `tenants`) → enkripsi AES-256 (`BACKUP_PASSPHRASE`) → salinan di luar penyedia (S3/R2/Wasabi lewat rclone) dan diverifikasi ukurannya → lapor. Salinan harian disimpan 90 hari (`OFFSITE_KEEP_DAYS`), salinan tanggal 1 tidak dihapus otomatis.
- **Tanggal 2 tiap bulan (`restore-test`):** backup terbaru diambil, didekripsi, **dipulihkan ke database sementara**, lalu diperiksa (jumlah tabel, bisa membaca `tenants` dan `users`) → lapor. Ini yang mengubah "backup" menjadi "backup yang terbukti bisa dipulihkan". Bisa dijalankan kapan saja lewat *Actions › Backup database › Run workflow*.

Pasang sekali (di GitHub: *Settings › Secrets and variables › Actions*; di Railway: variabel layanan):

| Tempat | Nama | Isi |
|---|---|---|
| GitHub secret | `BACKUP_DATABASE_URL` | koneksi **langsung** (bukan pooler) Neon dengan peran **pemilik** database. Tanpa ini workflow otomatis dilewati. Peran biasa tidak cocok: RLS membuat `pg_dump` gagal atau kosong |
| GitHub secret | `BACKUP_PASSPHRASE` | kata sandi enkripsi ≥ 16 karakter. **Simpan salinannya di tempat terpisah**: tanpa ini backup tidak bisa dibuka |
| GitHub secret | `RCLONE_REMOTE`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (+ `S3_PROVIDER`, `S3_REGION` bila perlu) | bucket tujuan; contoh `RCLONE_REMOTE=offsite:nama-bucket/sansu`. Gunakan kunci yang hanya boleh menulis/membaca bucket itu |
| GitHub secret | `BACKUP_REPORT_URL`, `BACKUP_REPORT_TOKEN` | `https://<domain-anda>/api/backup-report` dan token yang **sama** dengan di Railway |
| Railway | `BACKUP_REPORT_TOKEN` | acak ≥ 24 karakter (`openssl rand -base64 32`). Mengaktifkan pelaporan; tanpa ini Panel menampilkan "belum diaktifkan" |
| Railway (opsional) | `BACKUP_MAX_AGE_HOURS` (26), `RESTORE_TEST_MAX_AGE_DAYS` (40) | batas dianggap basi |

Yang dilakukan SANSU dengan laporannya: menyimpannya, menampilkannya di Panel, dan mengirim Telegram **segera** bila backup/uji pemulihan GAGAL, bila backup berhasil tetapi tanpa salinan di luar penyedia, dan paling sering sekali per 24 jam bila backup sukses terakhir lebih tua dari batas. Pemeriksaan postur juga menampilkan peringatan "Backup database terbaru dan sukses".

Memulihkan dari salinan (darurat): unduh berkas `sansu-*.dump.enc` dari bucket, lalu
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in sansu-….dump.enc -out pulih.dump` dan `pg_restore --no-owner -d <database-baru> pulih.dump` (pastikan peran `sansu_app` ada; jalankan migrasi aplikasi sesudahnya bila versi aplikasi lebih baru dari backup). Skrip yang sama dipakai backup di server sendiri, jadi format dan kata sandinya seragam.

#### Alternatif tanpa GitHub Actions (Docker di komputer/server Anda)
Bila kuota atau pembayaran GitHub Actions bermasalah (job gagal dengan pesan *recent account payments have failed or your spending limit needs to be increased*), jalankan skrip yang sama lewat Docker. Cocok untuk server yang selalu menyala (VPS kecil); komputer pribadi yang sering mati akan melewatkan backup, dan Panel SANSU lalu menandainya basi.

1. Pasang Docker (Linux: Docker Engine; Windows: Docker Desktop, dibiarkan berjalan).
2. Di folder `deploy/backup`: salin `backup.env.example` menjadi `backup.env` dan isi (nilainya sama dengan daftar secret di atas; format `NAMA=nilai` tanpa tanda kutip). Berkas ini berisi kunci ke seluruh data: batasi aksesnya (`chmod 600 backup.env`) dan jangan di-commit (sudah di `.gitignore`).
3. Uji sekali: Linux `./run-external.sh dump`; Windows PowerShell `.\run-external.ps1 dump`. Lalu lihat Panel SANSU › Keamanan data › Backup database: harus **Baik**. Ulangi dengan `restore-test`.
4. Jadwalkan:
   - Linux (cron): `30 1 * * * /jalur/ke/deploy/backup/run-external.sh dump >> /var/log/sansu-backup.log 2>&1` dan `0 3 2 * * /jalur/ke/deploy/backup/run-external.sh restore-test >> /var/log/sansu-backup.log 2>&1`.
   - Windows: *Task Scheduler* › Create Task › Trigger harian 01:30 › Action: `powershell.exe` dengan argumen `-ExecutionPolicy Bypass -File "C:\jalur\deploy\backup\run-external.ps1" dump`; buat tugas kedua bulanan untuk `restore-test`.

Pembungkus Docker ini baru diuji sebagian (skrip backupnya diuji nyata; pembungkus `run-external.sh/.ps1` dan image-nya belum dijalankan karena tidak ada Docker di lingkungan pengembangan). Jalankan `dump` dan `restore-test` sekali dan pantau hasilnya sebelum mengandalkannya.

Batasan jujur:
- GitHub Actions bisa terlambat atau dilewati (jadwal GitHub tidak dijamin tepat waktu, dan dihentikan otomatis pada repositori yang tidak aktif 60 hari). Karena itu SANSU memeriksa **kesegaran laporan**, bukan hanya menunggu kabar gagal.
- `BACKUP_DATABASE_URL` adalah kunci ke seluruh data klien dan tersimpan di GitHub secrets. Pakai repositori privat, batasi siapa yang bisa mengubah workflow, dan putar (ganti) kata sandinya bila ada orang keluar. Alternatif: jalankan skrip yang sama dari cron di server milik Anda.
- Jendela waktu pemulihan Neon (PITR) tetap perlu diatur terpisah; ini salinan tambahan, bukan penggantinya.
- Uji pemulihan memeriksa struktur dan keterbacaan, bukan kebenaran setiap angka transaksi. Sesekali buka salinan hasil pulih dan cocokkan beberapa laporan.
- Backup server sendiri (VPS) melapor ke SANSU bila `BACKUP_REPORT_TOKEN` diisi di `.env`; uji pemulihannya tetap manual lewat `./sansu.sh restore`.

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
