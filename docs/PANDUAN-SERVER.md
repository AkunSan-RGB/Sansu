# Panduan Menjalankan SANSU sebagai Layanan Online

Panduan ini untuk pemilik SANSU dan teknisi yang membantu memasang server. Semua perintah dijalankan di server (lewat SSH), dari folder `sansu`.

---

## 1. Yang perlu disiapkan

| Kebutuhan | Rekomendasi |
|---|---|
| **Server (VPS)** | Ubuntu 24.04, minimal **2 vCPU · 4 GB RAM · 40 GB SSD**. Untuk >30 perusahaan aktif: 4 vCPU · 8 GB. |
| **Lokasi server** | **Data center di Indonesia** (mis. Biznet Gio, IDCloudHost, DewaWeb, atau AWS/GCP region Jakarta) — memudahkan kepatuhan UU PDP dan lebih cepat bagi pengguna. |
| **Domain** | Mis. `app.sansu.id`. Di pengelola domain, buat **A-record** yang mengarah ke IP server. |
| **Object storage** (untuk backup di luar server) | Layanan S3-compatible: IDCloudHost Object Storage, Biznet Gio NEO Object Storage, Wasabi, Cloudflare R2, atau AWS S3. |
| **Telegram** (opsional) | Untuk menerima pesan bila backup gagal. |

---

## 2. Pemasangan pertama (±20 menit)

```bash
# 1. salin kode SANSU ke server (git clone atau upload folder), lalu:
cd sansu
sudo bash deploy/install.sh
```

Skrip akan:
1. memasang Docker,
2. membuat swap & menyalakan firewall (hanya port SSH, 80, 443),
3. menanyakan **domain** dan **email**, lalu membuat file `.env` berisi rahasia acak,
4. menampilkan **kata sandi enkripsi backup** → **catat dan simpan di tempat aman**,
5. membangun dan menjalankan semua layanan.

Setelah selesai, buka `https://domain-anda` → tab **Coba gratis** untuk mendaftarkan perusahaan pertama. Sertifikat HTTPS dibuat & diperpanjang otomatis.

> Ingin ada akun demo untuk calon pelanggan? `./sansu.sh demo` (login `admin@demo.id` / `demo12345`). Siapa pun yang tahu sandi ini bisa masuk ke akun demo — jangan isi data asli di sana.

---

## 3. Perintah sehari-hari

| Perintah | Fungsi |
|---|---|
| `./sansu.sh status` | Kondisi semua layanan, versi, backup terakhir, sisa disk |
| `./sansu.sh logs api` | Lihat log aplikasi (ganti `api` dengan `web`, `db`, `caddy`, `backup`) |
| `./sansu.sh backup` | Backup sekarang |
| `./sansu.sh backups` | Daftar file backup |
| `./sansu.sh restore <file>` | Pulihkan dari backup |
| `./sansu.sh update` | Pasang versi baru (otomatis backup dulu) |
| `./sansu.sh restart` | Jalankan ulang semua layanan |

---

## 4. Backup

**Otomatis setiap hari pukul 01:30 WIB** (ubah lewat `BACKUP_TIME` di `.env`). Setiap file diverifikasi setelah dibuat.

| Disimpan di server (`./backups`) | Jumlah |
|---|---|
| Harian | 14 terakhir |
| Mingguan (hari Minggu) | 8 terakhir |
| Bulanan (tanggal 1) | 12 terakhir |

Backup juga dibuat otomatis **sebelum setiap update** dan **sebelum setiap pemulihan**.

### 4a. Wajib: salinan di luar server (offsite)

Backup yang hanya ada di server ikut hilang bila server rusak. Isi bagian ini di `.env`:

```ini
RCLONE_REMOTE=offsite:nama-bucket/sansu
S3_PROVIDER=Other                 # AWS / Wasabi / Cloudflare / Other
S3_ENDPOINT=https://endpoint-penyedia-anda
S3_REGION=                        # bila diminta penyedia
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

Lalu `./sansu.sh restart` dan `./sansu.sh backup`. File offsite **dienkripsi** dengan `BACKUP_PASSPHRASE`; salinan harian disimpan 90 hari, bulanan tidak dihapus otomatis.

### 4b. Notifikasi bila backup gagal (Telegram)

1. Chat **@BotFather** → `/newbot` → salin token ke `TELEGRAM_BOT_TOKEN`.
2. Kirim pesan apa saja ke bot Anda, lalu chat **@userinfobot** untuk melihat chat id → isi `TELEGRAM_CHAT_ID`.
3. `./sansu.sh restart`.

### 4c. Memulihkan data

```bash
./sansu.sh backups                         # pilih file
./sansu.sh restore sansu-20261004-013000.dump
```

- Aplikasi berhenti sebentar (1–5 menit tergantung ukuran data).
- Kondisi sekarang dibackup dulu, dan database lama disimpan sebagai `sansu_sebelum_<waktu>` — pemulihan bisa dibatalkan.
- Untuk file offsite (`.dump.enc`), unduh ke folder `backups/`, lalu `./sansu.sh restore nama-file.dump.enc`.

> **Latihan pemulihan sebulan sekali** di server cadangan. Backup yang belum pernah dicoba dipulihkan belum bisa dianggap aman.

---

## 5. Keamanan yang sudah aktif

- HTTPS wajib (HSTS), sertifikat otomatis.
- Header keamanan ketat (CSP, anti-clickjacking, nosniff), font disajikan dari server sendiri — tidak ada data pengguna yang dikirim ke pihak ketiga.
- Data tiap perusahaan terisolasi; diuji otomatis: perusahaan lain tidak bisa membaca/mengubah data lewat **semua** rute API.
- Kata sandi minimal 8 karakter berisi huruf & angka (disimpan sebagai hash bcrypt).
- Akun dikunci 15 menit setelah 8× salah sandi; pembatas laju per alamat IP.
- Sesi langsung berakhir saat pengguna dinonaktifkan, diganti peran, atau diganti sandinya; pengguna bisa **Keluar dari semua perangkat**.
- Aplikasi menolak berjalan bila rahasia `.env` lemah; dokumentasi API disembunyikan di produksi.
- Database tidak terbuka ke internet; log dibatasi ukurannya agar disk tidak penuh.

**Tugas Anda:** jaga file `.env` (jangan dibagikan), login server memakai SSH key (matikan login password), dan jalankan `./sansu.sh update` saat ada versi baru.

---

## 6. Menjual layanan: panel admin, email, pembayaran, marketplace

### 6a. Panel SANSU (pemilik layanan)
Email yang diisi saat `install.sh` otomatis menjadi pemilik layanan (`PLATFORM_ADMIN_EMAILS` di `.env`). Daftarkan akun dengan email itu lewat **Coba gratis**, lalu menu **Panel SANSU** muncul di samping. Isinya: ringkasan pendapatan (MRR), daftar perusahaan & masa aktifnya, konfirmasi bukti transfer, pengaturan paket & harga, rekening transfer, lama uji coba.

Alur pelanggan: daftar → **uji coba 14 hari** → pilih paket di menu **Pengaturan › Langganan** → bayar → aktif. Bila masa aktif habis (+3 hari tenggang) perusahaan masuk **mode baca saja**: data tetap bisa dilihat & diekspor, tetapi tidak bisa ditambah/diubah sampai dibayar. Tujuh hari sebelum berakhir, tagihan perpanjangan dibuat & dikirim otomatis.

### 6b. Email (wajib untuk lupa sandi & verifikasi)
Isi di `.env`, lalu `./sansu.sh restart`, lalu uji lewat **Panel SANSU › Pengaturan › Kirim email uji**:
```ini
SMTP_HOST=smtp-relay.brevo.com     # contoh Brevo (gratis 300 email/hari)
SMTP_PORT=587
SMTP_USER=...                      # login SMTP dari penyedia
SMTP_PASS=...
MAIL_FROM="SANSU <no-reply@domain-anda>"
```
Agar email tidak masuk spam, verifikasi domain pengirim di penyedia SMTP (catatan SPF & DKIM di DNS).

### 6c. Pembayaran langganan
- **Transfer manual** (langsung bisa): isi rekening di **Panel SANSU › Pengaturan**. Pelanggan mengunggah bukti, Anda klik **Konfirmasi**.
- **Otomatis (VA, QRIS, e-wallet)**: daftar di Midtrans atau Xendit, isi `MIDTRANS_SERVER_KEY` (+`MIDTRANS_PRODUCTION=true`) atau `XENDIT_SECRET_KEY` + `XENDIT_CALLBACK_TOKEN`. Pasang URL notifikasi di dashboard penyedia: `https://domain-anda/api/billing/webhooks/midtrans` atau `.../webhooks/xendit`.

### 6d. Sinkron marketplace
Pelanggan menyambungkan tokonya di **Integrasi › Sinkron otomatis**. Agar tombol aktif, Anda (pemilik layanan) harus terdaftar sebagai partner/developer di marketplace terkait lalu mengisi kuncinya:
| Marketplace | Variabel `.env` | Pendaftaran |
|---|---|---|
| Shopee | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | open.shopee.com |
| TikTok Shop / Tokopedia | `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` | partner.tiktokshop.com |
| Lazada | `LAZADA_APP_KEY`, `LAZADA_APP_SECRET` | open.lazada.com |

URL redirect yang diminta saat mendaftar ditampilkan di halaman Sinkron otomatis. Pesanan ditarik setiap 15 menit; hanya pesanan yang sudah dikirim yang dibukukan.

---

## 7. Sebelum menerima pelanggan berbayar

- [ ] Email (SMTP) aktif & email uji diterima (cek juga folder spam).
- [ ] Rekening transfer diisi / gerbang pembayaran aktif & diuji dengan transaksi kecil.
- [ ] Salinan offsite aktif & sudah dicoba dipulihkan.
- [ ] Notifikasi Telegram aktif.
- [ ] Syarat & Ketentuan dan Kebijakan Privasi (UU No. 27/2022 tentang Pelindungan Data Pribadi).
- [ ] Pendaftaran **PSE Lingkup Privat** di Komdigi (wajib bagi layanan online yang mengolah data pengguna di Indonesia).
- [ ] Bila pendaftaran mandiri belum ingin dibuka untuk umum: `ALLOW_SIGNUP=false` di `.env`.
