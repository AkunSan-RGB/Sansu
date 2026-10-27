# Uji beban serentak

Skrip: `backend/scripts/uji-beban-serentak.mjs` (`npm run load:serentak -w backend -- --vus 100 --duration 60`).
Menjalankan banyak pengguna maya dari beberapa perusahaan sekaligus pada server yang sedang berjalan, lalu memeriksa bahwa
**pembukuan tetap benar**, bukan hanya cepat.

## Cara kerja

- **Beban campuran:** ±65% baca (faktur, pesanan, pelanggan, produk, neraca saldo, kas) dan ±35% tulis (pesanan → konfirmasi → faktur,
  pembayaran sebagian, jurnal manual, kas keluar, pelanggan baru). Perusahaan air 10.000 sambungan ikut (ringkasan, cari di loket,
  tunggakan, kontrol) dan menjalankan **tagih bulanan 10.000 sambungan di latar** bersamaan dengan beban lain.
- **Fase jaringan buruk (`--chaos N`):** permintaan tulis diputus klien sesaat setelah terkirim (server tetap memprosesnya), dikirim ulang dengan
  kunci idempotensi yang sama seperti peramban SANSU, sebagian diklik ganda serentak. Tiap operasi harus tercatat tepat satu kali.
- **Pemeriksaan sesudahnya (langsung ke database):** jurnal seimbang, nomor dokumen tidak ganda, stok tidak negatif dan sama dengan awal dikurangi terjual,
  terbayar tidak melebihi tagihan dan sama dengan jumlah pembayaran, neraca saldo seimbang, jumlah deadlock PostgreSQL.

## Hasil (satu mesin 4 inti 16 GB: server aplikasi, PostgreSQL, dan pembangkit beban berbagi inti yang sama)

| Pengguna maya | Permintaan/dtk | Latensi p50 | p95 | p99 | Galat 5xx | Waktu habis | Deadlock | Pemeriksaan pembukuan |
|---|---|---|---|---|---|---|---|---|
| 50 | 125 | 56 ms | 264 ms | 604 ms | 0 | 0 | 0 | lulus semua |
| 100 | 130 | 319 ms | 939 ms | 1,2 dtk | 0 | 0 | 0 | lulus semua |
| 200 | 133 | 750 ms | 2,4 dtk | 2,8 dtk | 0 | 0 | 0 | lulus semua |
| 600 | 135 | 2,5 dtk | 8,1 dtk | 9,5 dtk | 0 | 0 | 0 | lulus semua |
| 1.500 | 150 | 6,4 dtk | 17,6 dtk | 21,7 dtk | 0 | 0 | 0 | lulus semua |

Tagih 10.000 sambungan di latar saat beban 200–600 pengguna: selesai 224–231 dtk, 10.000 ditagih, 0 gagal.

**Jaringan buruk (300 operasi tulis, 258 permintaan diputus di tengah jalan, 30% diklik ganda):**
dengan kunci idempotensi 0 ganda, 0 hilang, 0 tak terselesaikan. Kontrol tanpa kunci: 149 dari 200 operasi tercatat ganda (225 baris berlebih).

## Cara membaca hasil

1. **Kapasitas satu proses ±130–150 permintaan/dtk** untuk campuran ini. Di atas itu permintaan antre: latensi naik, **galat tidak muncul**
   dan pembukuan tetap benar. Sistem melambat dengan anggun, tidak rusak.
2. **Penghambat adalah satu inti prosesor server aplikasi** (±1,1 inti terpakai; Node satu utas). Memperbesar kolam koneksi database dari 10 ke 30
   tidak mengubah apa pun (148 vs 150 permintaan/dtk). Dua proses aplikasi pada mesin yang sama menaikkan total ±30%, bukan dua kali, karena mesin uji sudah penuh
   (PostgreSQL ±1,4 inti). Skala nyata perlu diukur di perangkat keras terpisah.
3. **Perkiraan pengguna aktif:** dengan jeda 5–10 detik antar klik, 130 permintaan/dtk setara sekitar 600–1.300 pengguna aktif bersamaan per proses
   sebelum latensi di atas 1 dtk. Perusahaan air 10.000 pelanggan biasanya hanya puluhan staf aktif; beban terbesarnya adalah tagih bulanan, yang berjalan di latar.
4. **Penghematan kueri:** memoisasi pengaturan per permintaan menurunkan kueri dari 25 menjadi 23 pada permintaan tulis yang diukur (**bukan 14**; angka 14 yang
   sempat saya sebut berasal dari permintaan yang gagal dan sudah dikoreksi). Rata-rata awal **±12 kueri per permintaan** (±100 ribu commit untuk ±8 ribu permintaan). Ini peluang optimasi terbesar (gabungkan pemeriksaan izin, audit, kunci idempotensi).

## Batas yang jujur

- Mesin uji kecil dan dipakai bersama pembangkit beban. Angka mutlak di server produksi akan berbeda; **pola** (tanpa galat, antre, penghambat satu inti) yang bisa dipegang.
- Throttle per IP dimatikan di mode uji. Di produksi default 600 permintaan/menit per IP; pengguna di balik satu IP kantor bisa kena 429 pada beban tinggi.
- Tabel hasil di atas diukur **sebelum** pembatas antrean. Sekarang ada penolakan dini (`MAX_INFLIGHT`, 503 + `Retry-After`) dan mode multi-proses
  (`npm run start:cluster`, `WEB_CONCURRENCY`; penjadwal hanya di satu pekerja). Terukur: 2 pekerja + pembatas pada 600 pengguna → p95 2,2 dtk (sebelumnya 8,1 dtk satu proses).
- Skenario tulis mencakup penjualan, pembayaran, jurnal, kas, pelanggan. Modul lain (produksi, SDM, aset, pajak) belum ada di skrip.
- Belum diuji: instalasi multi-proses di perangkat keras terpisah.
- Uji kegagalan (`backend/scripts/uji-kegagalan.mjs`): skenario `db` (PostgreSQL dihentikan di tengah beban) lulus 5/5 setelah perbaikan penangan galat kolam
  (sebelumnya server mati). Skenario `restart` (server dimatikan paksa saat tagih berjalan) menemukan satu klaim tagihan tanpa faktur; perbaikannya
  (`releaseStaleClaims` + sapuan kedua) membuat uji ulang lulus 10/10: setelah `kill -9` pada ±255 sambungan tertagih, tagih ulang
  menyelesaikan 10.000 dari 10.000 sambungan, tanpa ganda, 0 klaim yatim, jurnal seimbang.

## Menjalankan ulang

```
npm run load:seed-air -w backend -- 10000   # perusahaan air 10.000 sambungan (menghasilkan /tmp/load/token)
npm run load:serentak -w backend -- --vus 100 --duration 60 --ramp 15 --tenants 4 \
     --utility-token /tmp/load/token --chaos 300
```
Opsi: `--base`, `--timeout` (ms), `--bill-period YYYY-MM`. Kode keluar 1 bila ada galat 5xx, waktu habis, atau pemeriksaan pembukuan gagal.
