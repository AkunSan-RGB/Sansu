# Skor per kriteria per jenis usaha

Penilaian ini berdasar bukti yang bisa dihitung ulang (menu, artikel bantuan, tes, uji beban), ditambah pertimbangan saya. Angkanya **bukan hasil audit pihak luar** dan
selisih setengah poin antar jenis usaha bisa terbalik oleh satu audit. Skala 0–10 per kriteria; 10 berarti setara sistem khusus yang sudah teruji bertahun-tahun.

## Kriteria dan cara menilai

| # | Kriteria | Yang dilihat |
|---|---|---|
| K1 | Cakupan alur inti | Apakah alur dari awal sampai laporan ada utuh di menu dan tes (mis. beli → stok → jual → tagih → laporan). |
| K2 | Kedalaman fitur khas | Fitur yang hanya masuk akal untuk jenis usaha itu, dan seberapa dalam. |
| K3 | Kontrol dan pemisahan tugas | Pembuat ≠ penyetuju, batas nilai, verifikasi orang kedua, kontrol kas/stok khas jenis usaha. |
| K4 | Akuntansi dan pajak sesuai jenis | Bagan akun, pajak (PPN, PB1, PPh 23/4(2)), perlakuan khas. |
| K5 | Laporan khusus | Laporan kerja per bagian dan laporan pendukung yang relevan. |
| K6 | Data contoh (demo) | Demo terisi di tiap menu supaya pengguna bisa mencoba. |
| K7 | Bantuan | Artikel khusus + panduan jenis usaha (setelah perubahan ini). |
| K8 | Pengaturan | Daftar pengaturan khas dengan status terisi/belum (setelah perubahan ini). |
| K9 | Tes otomatis | Jumlah dan relevansi tes e2e/unit untuk jenis usaha itu. |
| K10 | Ketahanan dan skala teruji | Diuji beban, serentak, dan jaringan buruk untuk alur jenis usaha itu. |
| K11 | Bukti pemakaian nyata | Pilot atau pelanggan sungguhan. **Nol untuk semua jenis usaha**, tidak dimasukkan ke rata-rata tetapi menjadi batas (lihat bawah). |

## Bukti terukur

| Jenis usaha | Menu terlihat | Menu khusus | Artikel terlihat | Artikel khusus | Pengaturan terdaftar | Tes e2e (perkiraan) | Uji beban |
|---|---|---|---|---|---|---|---|
| Dagang | 81 | 0 | 34 | 4 | 6 | 72 | alur dagang diuji serentak (penjualan, pembayaran, jurnal, kas) |
| Ritel | 79 | 0 | 35 | 5 | 6 | 33 | belum (kasir tidak masuk skrip) |
| Jasa | 74 | 7 | 37 | 7 | 5 | 50 | belum |
| FMCG | 89 | 9 | 40 | 10 | 7 | 62 | belum (sebagian alur dagang) |
| Manufaktur | 89 | 5 | 36 | 6 | 6 | 30 | belum |
| F&B | 87 | 5 | 40 | 10 | 6 | 22 (+ uji acak) | belum (kasir tidak masuk skrip) |
| Utilitas | 91 | 0* | 36 | 6 | 6 | 60 | 10.000 sambungan, tagih berlatar, serentak |

\* Menu Utilitas dibatasi lewat aplikasi `utility`, bukan lewat penanda jenis usaha, jadi hitungan "menu khusus" tidak mencerminkannya.
"Tes e2e" dihitung dari berkas yang namanya terkait jenis usaha, sehingga kasar.

## Skor

| Kriteria | Dagang | Ritel | Jasa | FMCG | Manufaktur | F&B | Utilitas |
|---|---|---|---|---|---|---|---|
| K1 Cakupan alur inti | 8 | 7 | 7 | 8 | 7 | 8 | 9 |
| K2 Kedalaman fitur khas | 6 | 6 | 7 | 9 | 7 | 8 | 9 |
| K3 Kontrol dan pemisahan tugas | 7 | 7 | 6 | 7 | 6 | 7 | 8 |
| K4 Akuntansi dan pajak | 8 | 7 | 8 | 7 | 7 | 8 | 7 |
| K5 Laporan khusus | 7 | 6 | 6 | 7 | 7 | 6 | 8 |
| K6 Data contoh | 7 | 7 | 6 | 7 | 6 | 7 | 8 |
| K7 Bantuan | 7 | 7 | 7 | 8 | 6 | 8 | 7 |
| K8 Pengaturan | 7 | 7 | 6 | 7 | 6 | 7 | 7 |
| K9 Tes otomatis | 8 | 6 | 7 | 7 | 6 | 6 | 8 |
| K10 Ketahanan dan skala | 7 | 5 | 5 | 5 | 5 | 5 | 7 |
| **Rata-rata K1–K10** | **7,2** | **6,5** | **6,5** | **7,2** | **6,3** | **7,0** | **7,8** |
| K11 Bukti pemakaian nyata | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Batas kesiapan produksi:** tanpa pilot nyata, tidak ada jenis usaha yang layak dinilai di atas ±7 untuk "siap dipakai sungguhan", berapa pun rata-ratanya.
Nilai kelengkapan Utilitas (7,8) berarti fiturnya paling lengkap, bukan paling siap produksi.

## Pembaruan setelah perbaikan ketahanan dan antarmuka

K10 naik karena ada bukti baru: server tidak lagi mati saat PostgreSQL berhenti, klaim tagihan yatim dilepas setelah restart paksa (uji kegagalan `db` 5/5 dan `restart` 10/10 pada 10.000 sambungan), pembatas beban, dan banner galat. Dagang dan Utilitas naik 1 poin pada K10
(alur yang diuji beban/kegagalan); lima jenis usaha lain naik tipis karena hanya mendapat perbaikan lintas sistem tanpa uji sendiri. K7 (Bantuan) dan K8 (Pengaturan) tidak berubah. Ruang kerja per jenis usaha (`/vertikal`, menunya disembunyikan dulu; halaman tetap ada) memberi semua jenis usaha pintu masuk alur khasnya, tetapi tidak menambah fitur baru,
jadi K2 tidak dinaikkan.

| | Dagang | Ritel | Jasa | FMCG | Manufaktur | F&B | Utilitas |
|---|---|---|---|---|---|---|---|
| Rata-rata K1–K10 (sebelum) | 7,2 | 6,5 | 6,5 | 7,2 | 6,3 | 7,0 | 7,8 |
| Rata-rata K1–K10 (sekarang) | 7,3 | 6,6 | 6,6 | 7,3 | 6,4 | 7,1 | 7,9 |

Rata-rata ketujuhnya ±7,0 (sebelumnya ±6,9). Ini penilaian saya, bukan audit pihak luar; K11 tetap nol.

## Perubahan dari taksiran saya sebelumnya

Taksiran lisan sebelumnya: Utilitas 7,5, F&B 7,5, FMCG 7, Manufaktur 7, Jasa 6,5, Ritel 6,5, Dagang 6,5.
Setelah bukti dihitung: Dagang naik (7,2) karena alurnya yang paling banyak diuji, termasuk uji beban serentak dan jaringan buruk.
Manufaktur turun (6,3) dan F&B turun (7,0) karena tes dan uji skalanya paling tipis dibanding kedalaman fiturnya.

## Celah utama dan langkah yang menaikkan nilai

| Jenis usaha | Celah terbesar | Langkah |
|---|---|---|
| Dagang | Fitur khas relatif sedikit (dekat dengan inti generik) | Pendalaman rute dan armada, kontrak harga, kredit pelanggan terpadu |
| Ritel | Kasir belum diuji serentak; tes e2e paling sedikit; belum ada integrasi perangkat kasir | Masukkan alur kasir ke skrip beban; tes e2e tutup kasir dan retur |
| Jasa | Kontrol tipis, belum diuji serentak | Kontrol batas jam/tarif, persetujuan lembar waktu, uji beban |
| FMCG | Belum diuji skala; alur sangat kompleks | Uji beban pesanan sales dan kanvas; validasi dengan distributor nyata |
| Manufaktur | Tes dan bantuan paling tipis | Tes e2e produksi bertingkat dan QC; artikel bantuan lanjutan |
| F&B | Kasir F&B tidak diuji serentak; tes sedikit | Skrip beban kasir (meja, dapur, online), uji pada satu kafe nyata |
| Utilitas | Belum ada pilot; VA dan pesan baru diuji dengan tiruan; daftar dibatasi 500/1.000 baris | Pilot satu wilayah (lihat UTILITAS-SKALA-DAN-PILOT.md), paginasi sejati |

Untuk semua jenis usaha, langkah yang paling menaikkan nilai adalah satu: **dipakai oleh pengguna sungguhan di satu usaha nyata selama beberapa siklus**.
