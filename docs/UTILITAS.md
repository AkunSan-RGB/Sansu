# Jenis usaha Utilitas (air, listrik, internet)

Jenis usaha ketujuh SANSU: penyedia layanan berlangganan yang dipakai terus-menerus dan **ditagih tiap bulan** berdasarkan meter atau paket.
Contoh: air bersih (PDAM/pengelola air kawasan), listrik komunitas, internet RT-RW Net/ISP lokal, TV kabel, gas pipa, iuran kebersihan & keamanan.

## Yang dibedakan dari jenis usaha lain

| Bagian | Utilitas |
|---|---|
| Aplikasi bawaan | Layanan Utilitas, Penjualan, Pembelian, Inventori, Akuntansi, Kas & Bank |
| Pendapatan | Akun khusus: 4-2300 Pemakaian, 4-2310 Abonemen, 4-2320 Denda, 4-2330 Biaya sambung baru; beban 5-1550/1560/1570 |
| Alur kerja | Sambungan baru (permintaan → survei → bayar → pasang → aktif), Penagihan tunggakan, Bahan jaringan, Retur pembelian |
| CRM | Calon pelanggan sambungan: tahap permintaan → survei → penawaran biaya sambung → bayar & jadwal pasang |
| Pajak | Daftar periksa: PPN berbeda per layanan, denda & biaya sambung, deposit pelanggan |
| SDM | Upah petugas lapangan: borongan (pasang) dan per shift |
| Menu | Tidak ada Surat jalan, Daftar belanja harian, Marketplace, Kedaluwarsa bahan |

## Alur bulanan

1. **Tarif** (Layanan utilitas → Tarif & aturan): abonemen, biaya admin, pemakaian minimum, dan **blok tarif progresif** (mis. 0–10 m³ Rp3.000, 10–20 m³ Rp4.500, selebihnya Rp7.000). Layanan tetap (internet, TV kabel, iuran) hanya memakai biaya tetap.
2. **Sambungan**: pelanggan + tarif + alamat + nomor meter + angka awal. Alamat atau nomor meter ganda untuk layanan yang sama ditolak.
3. **Catat meter** oleh petugas lapangan (Gudang) → status *Menunggu verifikasi*.
4. **Verifikasi** oleh orang lain (Keuangan/Admin). Angka janggal (lonjakan, nol, meter diganti) wajib catatan pemeriksa.
5. **Tagihan bulanan**: Keuangan melihat pratinjau lalu menerbitkan. Setiap sambungan menjadi satu faktur jasa di Penjualan (piutang, pembayaran, jurnal, PPN mengikuti alur biasa). Denda keterlambatan dari tagihan lama ikut di tagihan baru.
6. **Tunggakan**: daftar sambungan lewat jatuh tempo; yang melewati batas diusulkan putus sementara. Sambung kembali oleh orang lain setelah lunas.

## Layanan air (khusus jenis usaha Utilitas)

Perusahaan Utilitas (penyedia air bersih) memakai satu grup sidebar **Layanan air**; jenis usaha lain tetap dengan menu **Layanan utilitas** lama dan perilakunya tidak berubah. CRM, Penjualan, dan Kasir (POS) disembunyikan untuk Utilitas; Pelanggan dan Faktur & piutang pindah ke grup Layanan air. Tiap menu membuka satu halaman fokus (bukan deretan tab).

- **Pendapatan air vs non-air**: penjualan air = pemakaian + abonemen (tagihan bulanan). Layanan non-air (sambung baru, sambung kembali, ganti meter/material, administrasi, lain-lain) punya katalog harga sendiri dan ditagih sesekali lewat *Layanan non-air*; tiap jenis dicatat di akun pendapatan tersendiri (4-23xx) sehingga laba rugi menunjukkan keduanya terpisah. Laporan layanan air memuat bagian U6 (pendapatan air dan non-air per akun) dan U7 (penerimaan per loket per hari).
- **Loket**: perusahaan dapat memiliki beberapa loket (kode, lokasi, rekening bank). Tiap penerimaan dicatat atas nama loket dan kanalnya (transfer, QRIS, virtual account, EDC, dompet digital).
- **Non-tunai**: bawaan untuk perusahaan Utilitas (aturan `cashless`, dapat dimatikan Admin di Tarif air & aturan). Bila aktif, pembayaran tunai di loket ditolak dan tidak ada setoran kas. Keuangan mencocokkan **rekap harian per loket** dengan mutasi bank lalu mengonfirmasi atau menandai selisih (wajib catatan). Konfirmasi harus dilakukan orang lain dari penerima pembayaran (Pemilik dikecualikan), satu kali per loket per hari.
- **Ringkasan**: daftar "Perlu tindakan", pendapatan air vs non-air bulan ini, penerimaan loket hari ini, dan rekap yang belum dicek.
- **Peran (khusus Utilitas, peran dasar tetap sama)**: Petugas lapangan = Gudang (catat meter, mode lapangan, impor); Kasir loket = Kasir (terima pembayaran air dan non-air di loket, melihat penerimaan terakhirnya saja); Pelayanan pelanggan = Sales (pelanggan, sambungan baru, tagih layanan non-air); Keuangan = verifikasi meter, tagihan, rekap loket, tunggakan; Akuntan = laporan dan kontrol (tidak menulis di luar pembukuan, jadi tidak mengonfirmasi rekap); Pemilik/Admin = semuanya. Kasir tidak melihat rekap harian maupun ringkasan; yang mengonfirmasi rekap selalu orang lain dari kasirnya.
- **Alur kerja bernomor** di halaman Ringkasan (9 langkah, siapa mengerjakan apa, langkah peran yang masuk ditandai); setiap halaman memuat nomor langkah dan pelakunya di bawah judul.
- **Laporan layanan non-air** (Laporan bagian): pendapatan per jenis, per bulan (dibanding pendapatan air), per layanan, daftar tagihan rinci, per pelanggan, umur piutang non-air, penerimaan pembayaran (loket dan kanal), denda keterlambatan, dan pencocokan dengan buku besar; dapat diekspor ke Excel/CSV/PDF.
- Loket menerima pembayaran tagihan air **dan** tagihan layanan non-air; tanpa kata kunci, daftar tagihan terbuka tampil dengan yang paling lama jatuh tempo di atas.
- Data demo air: 24 pelanggan di 3 zona, 4 tarif, meter 4 bulan dari sumber campuran (manual, lapangan, impor, alat meter), 3 loket dengan penerimaan non-tunai bertanggal mundur oleh 3 kasir, rekap yang sudah dikonfirmasi Keuangan (satu ditandai selisih, dua hari terakhir sengaja dibiarkan), tunggakan dengan satu sambungan diputus, 16 tagihan layanan non-air, dan pasokan zona (zona Griya Asri sengaja bocor tinggi).
- Migrasi 0110: tabel `utility_counters`, `utility_counter_closings`, `utility_charges`; kolom `counter_id` dan `channel` pada penerimaan loket.

### Layanan air lanjutan (migrasi 0111)

Semua menu di bawah hanya muncul untuk jenis usaha Utilitas dan memakai modul `utility-ops` (tiap fitur punya dto/repository/service/controller; semua kueri di repositori). Dokumen bernomor lewat `SequenceService` (PGD pengaduan, PKJ perintah kerja, PSB permohonan, KRK koreksi, JMN jaminan, ANG angsuran).

| Menu | Aturan utama |
| --- | --- |
| Permohonan sambungan baru | permohonan → survei → tagihan biaya sambung (faktur non-air, pelanggan dibuat bila belum ada) → dibayar → pemasangan → aktif (membuat sambungan sungguhan). Pengaktif ≠ pemasang. |
| Pengaduan & gangguan | SLA jam per kategori (separuhnya untuk prioritas tinggi), status BARU → DITUGASKAN → DIKERJAKAN → SELESAI → DITUTUP; penutup ≠ pelaksana; petugas lapangan hanya tiketnya sendiri; pelanggan dapat mengadu lewat portal (maks. 3 tiket belum tuntas). |
| Aset jaringan, perintah kerja | perintah kerja terhubung ke pengaduan (mengubah status pengaduan otomatis) dan memperbarui kondisi aset; biaya upah + bahan dicatat saat selesai. |
| Balik nama, ganti golongan, pindah alamat, tutup permanen | diajukan pelayanan, disetujui orang lain; balik nama/tutup butuh tanpa tunggakan; ganti golongan hanya antar tarif berjenis meter sama. |
| Koreksi tagihan & pemutihan denda | maker-checker; ≥ Rp500.000 wajib Admin/Pemilik; menyetujui = nota kredit (retur tanpa barang) + jurnal pendapatan terbalik; pemutihan ≤ denda pada tagihan; invarian: saldo piutang buku besar = jumlah sisa faktur. |
| Deposit / jaminan | akun 2-1180 Utang Jaminan Pelanggan (bukan pendapatan); pemakaian melunasi tunggakan = pembayaran metode JAMINAN oleh orang lain dari penerima; pengembalian ditahan bila masih ada tunggakan. |
| Angsuran tunggakan | jadwal cicilan dari tunggakan terpilih; status dihitung dari pembayaran sebenarnya; selama AKTIF sambungan tidak diusulkan/tidak boleh diputus; telat > 14 hari = MACET. |
| Rute baca & tagih | rute memiliki pembaca dan kolektor; progres meter terbaca per rute; daftar petugas lapangan dapat disaring per rute. |
| Inventaris & tera meter | meter dengan status stok/terpasang/rusak/pensiun, riwayat kejadian, tera ulang tiap 5 tahun, ganti meter mengubah nomor meter sambungan. |
| Tagihan taksiran | pemakaian = rata-rata ≤ 3 periode nyata terverifikasi; maksimal 2 periode berturut-turut; pencatatan nyata berikutnya mengoreksi selisihnya otomatis (tanda TAKSIRAN / TAKSIRAN_LEBIH). |
| Cetak & kirim massal | rekening, pengingat, SP1 (terlambat ≥ 7 hari), SP2 (≥ 21), SP3 (≥ 35) menurut tagihan tertua; cetak satu surat per halaman atau tautan WhatsApp; setiap pengiriman dicatat (`utility_notices`). |
| Penagihan lapangan | daftar tunggakan per rute; hasil kunjungan; janji bayar maks. 30 hari, lewat tanpa lunas = ingkar; petugas lapangan hanya rutenya sendiri. |
| Portal pelanggan | tautan pribadi per sambungan (token acak, dapat diputar/dicabut), tanpa login, dibatasi laju; hanya data satu sambungan; token tidak valid dijawab 404. |
| Produksi air & NRW | produksi/distribusi harian per sumber (satu baris per hari per sumber); NRW = dialirkan − ditagih, wajar ≤ 30%; belum dihitung bila bulan itu belum ada tagihan. |
| Kualitas air | hasil uji dievaluasi terhadap baku mutu (pH 6,5–8,5; kekeruhan ≤ 5; klor 0,2–1,0; coliform 0; TDS ≤ 500). |
| Laporan kinerja PAM | efisiensi penagihan, umur piutang per golongan, per rute/kolektor, pengaduan tepat waktu, NRW, kualitas air; ekspor Excel/CSV/PDF. |

Peran: Pelayanan pelanggan (Sales) mengajukan permohonan/mutasi/koreksi/angsuran dan mengirim surat; Petugas lapangan (Gudang) survei, memasang, mengerjakan pengaduan/perintah kerja, kunjungan kolektor, produksi dan kualitas air; Keuangan/Admin menyetujui; Akuntan hanya membaca. Data demo mengisi setiap menu ini (tiga rute, pengaduan di berbagai status termasuk yang lewat batas, permohonan di tiap tahap, mutasi, koreksi, jaminan, angsuran, tera jatuh tempo, kunjungan dan janji ingkar, SP, tautan portal, produksi 126 hari, dan uji kualitas dengan pelanggaran).

## Pencegahan kecurangan

- Pencatat meter ≠ pemverifikasi (Pemilik dikecualikan, dan terlihat di kontrol "Dicatat dan diverifikasi orang yang sama").
- Angka meter tidak boleh turun; meter diganti wajib angka akhir meter lama + angka awal meter baru + catatan.
- Satu sambungan hanya satu tagihan per periode (klaim periode di basis data); penagihan ulang tidak menggandakan faktur.
- Hanya catatan terverifikasi yang ditagih.
- Denda dihitung server: persen dari sisa tagihan, sekali per tagihan, dibatasi persentase maksimal; batas aturan divalidasi (denda ≤ 10%, batas ≤ 25%).
- Tarif hanya diubah Admin/Pemilik; sebelum/sesudah tercatat di jejak audit dan Keuangan/Pemilik diberi tahu.
- Pemutusan hanya untuk tunggakan melewati batas hari atau atas permintaan pelanggan; penyambungan kembali oleh orang lain dan hanya bila tunggakan lunas; pembongkaran permanen hanya Admin dan hanya bila lunas.
- Kontrol kebocoran pendapatan: sambungan aktif tanpa pencatatan 2+ bulan, pemakaian nol 3 bulan berturut-turut, pencatatan > 5 hari belum diverifikasi, angka janggal, alamat kembar.
- Kotak tugas: verifikasi menunggu, pencatatan siap ditagih, usulan pemutusan, dan sambungan yang belum dicatat (petugas).

## Batasan yang jujur

- Tarif, PPN per layanan, besaran denda, dan batas pemutusan **harus disesuaikan dengan ketentuan penyedia/regulator dan perjanjian pelanggan**; SANSU hanya menjalankan aturan yang Anda isi. Belum ditinjau konsultan pajak/hukum.
- Belum ada: pembacaan meter otomatis (AMR/IoT) langsung dari alat tanpa gateway, pembayaran lewat virtual account per pelanggan, pengiriman WhatsApp/SMS otomatis lewat penyedia (yang ada: tautan wa.me dan cetak), jadwal perawatan berulang otomatis, dan tagihan kolektif per pengelola.
- Faktur diterbitkan bertanggal hari penagihan (bukan akhir periode); koreksi tagihan lewat menu Koreksi tagihan (nota kredit berjurnal).
- Penagihan berjalan per sambungan; bila server berhenti di tengah proses, sambungan itu ditandai *tertahan* dan tidak ditagih ulang otomatis (perlu diperiksa Admin).
- Belum diuji di browser/HP dan belum dipakai pelanggan nyata.

## Skala dan pilot

Tagih berlatar, impor massal, virtual account, dan antrean pesan: lihat [UTILITAS-SKALA-DAN-PILOT.md](UTILITAS-SKALA-DAN-PILOT.md) (hasil uji beban, batas yang diketahui, rencana pilot).
