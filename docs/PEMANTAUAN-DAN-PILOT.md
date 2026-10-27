# Pemantauan produksi dan persiapan pilot

## Yang sudah ada di kode (bisa dipakai sekarang)

- **Pembatas antrean (load shedding):** `MAX_INFLIGHT` menolak dini dengan 503 + `Retry-After`; `/api/health` dan `/api/ingest/` dikecualikan. Hitungan penolakan muncul di log.
- **Penangan galat proses:** `unhandledRejection` dicatat; `uncaughtException` dicatat lalu proses keluar (pengawas proses/orkestrator harus memulai ulang).
- **Galat kolam koneksi database** dicatat (dibatasi 10 dtk sekali) agar server tidak mati saat PostgreSQL berhenti.
- **Batas waktu database:** `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`; hasilnya 503 yang jelas, bukan data setengah tersimpan.
- **Pelacak galat bawaan (ErrorMonitor)** dan endpoint `/api/health` untuk pemeriksaan hidup.

## Peringatan operasional (Telegram, bila `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` diisi)

Selain error 5xx per permintaan (sudah ada: tabel `error_logs` + Telegram/surel, dibatasi satu peringatan per 15 menit), kini ada `opsAlert` (`backend/src/common/monitor/ops-alert.ts`) untuk kejadian
tingkat proses, juga dibatasi per kunci agar tidak membanjir dan selalu dicatat di log:

| Kunci | Dipicu oleh |
|---|---|
| `unhandledRejection` | penolakan promise tak tertangani |
| `uncaughtException` | pengecualian tak tertangkap (proses berhenti setelah peringatan dikirim) |
| `db-pool` | koneksi database terputus (PostgreSQL mati/restart) |
| `load-shed` | server menolak permintaan karena melebihi `MAX_INFLIGHT` |
| `billing-job` | tagih bulanan berlatar gagal |

Tanpa konfigurasi Telegram, peringatan hanya masuk ke log. Ini peringatan dari dalam aplikasi; bila prosesnya mati total, tidak ada yang mengirim apa pun, jadi pemeriksa dari luar (di bawah) tetap wajib.

## Yang harus dipasang di lingkungan produksi (tidak bisa dibuktikan dari sini)

1. Pemeriksa `GET /api/health` tiap 30 dtk dari luar jaringan (mis. UptimeRobot) dengan peringatan ke WhatsApp/surel penanggung jawab.
2. Peringatan pada pola log: `Koneksi database terputus`, `503`, `unhandledRejection`, `Tagih berlatar … gagal`, `klaim tanpa faktur dilepas`.
3. Pengawas proses (systemd/PM2/orkestrator) dengan mulai-ulang otomatis; `npm run start:cluster` untuk multi-proses (penjadwal hanya di satu pekerja).
4. Cadangan `pg_dump` terjadwal dan uji pemulihan berkala (lihat `MIGRASI-DAN-DEPENDENSI.md`).

## Pilot

Pilot sungguhan dengan satu perusahaan air nyata **tidak dapat dikerjakan dalam sesi ini**; tidak ada pengguna, data, atau infrastruktur produksi di sini. Yang ada hanya
panduan dan uji pendukung (`UTILITAS-SKALA-DAN-PILOT.md`, `UJI-BEBAN-SERENTAK.md`). Bukti pemakaian nyata tetap nol sampai pilot berjalan.
