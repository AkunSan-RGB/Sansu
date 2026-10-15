# Pemisahan fungsi (segregation of duties) di SANSU

Tujuan: satu orang tidak memegang seluruh rantai sebuah transaksi (memulai, menyetujui, mencatat, menyimpan aset),
sehingga kesalahan dan kecurangan tertangkap oleh orang lain. Aturan ini ditegakkan di server (`@Roles` pada setiap endpoint),
bukan hanya dengan menyembunyikan tombol. Tes `backend/test/segregation.e2e-spec.ts` membaca matriks hak akses
seluruh endpoint dan gagal bila ada peran yang memegang dua fungsi yang harus terpisah.

## Tugas tiap peran (job desk)

| Peran | Tugas utama | Tidak boleh |
|---|---|---|
| **Pemilik** | Seluruh akses, persetujuan akhir, pengaturan keamanan, persetujuan selisih hitung kas | — |
| **Admin** | Pengelola sistem: pengguna, pengaturan, persetujuan transaksi, data master | Menyetujui permintaannya sendiri; mengubah akun Pemilik |
| **Keuangan** | Memegang uang: kas & bank, kas kecil, hitung kas, penerimaan & pembayaran, rekonsiliasi bank (impor & pencocokan), setor pajak, bayar gaji, faktur penjualan & pembelian | **Membukukan** (jurnal manual, bagan akun, kunci periode, aset tetap, penyusutan, penurunan nilai, revaluasi, posting gaji, mengesahkan rekonsiliasi); menerima barang, mengirim barang, menyusun gaji |
| **Akuntan** | Pembukuan: jurnal manual & pembalik, bagan akun, jurnal berulang, saldo awal, kunci periode & tutup buku, aset tetap & penyusutan, penurunan nilai persediaan, revaluasi valas, anggaran, koreksi fiskal & catatan laporan, pengaturan pelaporan, mengesahkan rekonsiliasi bank, memposting jurnal gaji | **Memegang uang** (mencatat kas, menerima/membayar, setor pajak, bayar gaji, kas kecil, impor rekening koran); hanya melihat dokumen penjualan, pembelian, stok, kas, dan gaji |
| **Pembelian** | Memesan: mendaftarkan pemasok baru, membuat permintaan beli, mengonversi permintaan yang sudah disetujui menjadi pesanan, membuat/mengonfirmasi/membatalkan pesanan pembelian (semua jenis usaha); melihat pemasok, penerimaan, dan tagihan pemasok | **Tidak menerima barang** (Gudang), **tidak membayar atau memasukkan tagihan pemasok** (Keuangan), tidak menyetujui permintaan beli (Admin), tidak mengubah data pemasok yang sudah ada atau menandainya preferred/persetujuan otomatis, tidak menyentuh jurnal, stok, atau laporan keuangan |
| **Sales** | Prospek (CRM), pesanan penjualan, pelanggan baru, kasir bila perlu | Mengirim barang, membuat faktur, menerima pembayaran, mengubah limit kredit, melihat biaya pembelian |
| **Gudang** | Permintaan beli, penerimaan barang, pengiriman barang, mutasi & penghitungan stok, penyesuaian stok | Membuat PO, supplier, faktur, atau pembayaran; membukukan hasil opname sendiri |
| **Kasir** | Penjualan di kasir (POS) | Semua transaksi di luar kasir; membaca faktur, pembelian, atau mutasi stok bernilai |
| **SDM** | Data karyawan, penyusunan gaji | Membayar gaji; membaca penjualan, pembelian, atau kas |

Pemilik selalu lolos semua pemeriksaan peran (dan tidak terkena batas persetujuan).

## Rantai transaksi dan siapa memegang tiap langkah

| Rantai | Langkah → peran |
|---|---|
| **Pembelian** | Permintaan beli (Gudang/Pembelian/Keuangan/Admin) → disetujui (Admin/Pemilik) → PO (Pembelian/Keuangan/Admin) → **penerimaan barang (Gudang/Admin)** → faktur supplier (Keuangan/Admin) → pembayaran (Keuangan/Admin; di atas batas menunggu persetujuan) |
| **Penjualan** | Pesanan (Sales/Admin) → konfirmasi (Sales/Keuangan/Admin) → **pengiriman (Gudang/Admin)** → faktur (Keuangan/Admin) → pembayaran diterima (Keuangan/Admin) |
| **Stok** | Hitung (Gudang) → **dibukukan (Keuangan/Admin)**; penyesuaian stok bernilai besar menunggu persetujuan |
| **Kas & bank** | Catat kas & cocokkan rekening koran (Keuangan/Admin) → di atas batas menunggu persetujuan → pembatalan hanya Pemilik/Admin dengan alasan; hitung kas fisik berselisih besar disetujui Pemilik; **rekonsiliasi bulanan disahkan Akuntan/Admin** (bukan pengimpor rekening koran) |
| **Kas kecil** | Juru kas mencatat bukti → pengisian kembali menunggu persetujuan → pembatalan Pemilik/Admin |
| **Gaji** | Disusun SDM → **jurnalnya diposting Akuntan/Admin (atau otomatis oleh sistem)** → dibayar Keuangan |
| **Komisi sales (FMCG)** | Target diatur Admin (terkunci setelah bulan lewat) → komisi ditutup/dijurnal Akuntan/Admin → dibayar Keuangan/Admin (orang berbeda dari penutup) |
| **Upah jasa (Jasa)** | Tarif diatur Keuangan/Admin → catatan kerja dibuat HR → disetujui Keuangan/Admin (orang lain; pegawai tidak memutuskan upahnya sendiri) → otomatis ke slip → diposting Akuntan/Admin → dibayar Keuangan. Lihat `docs/GAJI-JASA.md` |
| **Konsinyasi / tukar-guling / setoran kanvas (FMCG)** | Dicatat Sales/Gudang → diperiksa dan disahkan Keuangan/Admin (orang berbeda dari pencatat) sebelum menjadi faktur, stok keluar, atau pelunasan |
| **Aset tetap** | Dicatat dan disusutkan oleh Akuntan/Admin → pelepasan di atas batas menunggu persetujuan |
| **Pembukuan** | Jurnal manual, penyesuaian, kunci periode, tutup buku: Akuntan/Admin (jurnal di atas batas `manualJournal` menunggu persetujuan). Keuangan hanya membaca laporan |

## Pengendali pembuat–penyetuju (maker-checker)

Batas nilai diatur di **Pengaturan › Persetujuan**. Isi 0 untuk mematikan. Yang melewati batas oleh peran selain Pemilik/Admin
membuat permintaan (Telegram + email) dan dijalankan **atas nama pemohon** setelah disetujui. Pemohon tidak bisa menyetujui permintaannya sendiri.

| Transaksi | Batas |
|---|---|
| Pesanan pembelian | `purchaseOrder` |
| Jurnal manual | `manualJournal` |
| Kas keluar, transfer, dan **pembayaran ke supplier** | `cashOut` |
| Penyesuaian stok (masuk + keluar) | `stockAdjustment` |
| Pelepasan aset tetap | `assetDisposal` |
| Pengisian kembali kas kecil | selalu (peran selain Pemilik/Admin) |
| Selisih harga faktur terhadap PO | `priceControl` |

## Pemisahan Keuangan dan Akuntan

Satu orang tidak boleh sekaligus **memegang uang** dan **membukukannya**: yang bisa membayar/menerima uang bisa menutupi kecurangan lewat jurnal,
dan yang bisa membuat jurnal bisa menyembunyikan uang yang diambil.

| | Keuangan | Akuntan |
|---|---|---|
| Kas, bank, kas kecil, hitung kas, impor & pencocokan rekening koran | **tulis** | baca |
| Terima pembayaran pelanggan, bayar pemasok, setor pajak, bayar gaji | **tulis** | baca |
| Jurnal manual, bagan akun, saldo awal, kunci periode, tutup buku | baca | **tulis** |
| Aset tetap, penyusutan, penurunan nilai, revaluasi valas, anggaran, koreksi fiskal | baca | **tulis** |
| Posting jurnal gaji · pengesahan rekonsiliasi bank | — | **tulis** |
| Laporan keuangan, pajak, pengingat | baca | baca |

Pemilik dan Admin memegang keduanya sebagai pengelola (tindakan mereka tercatat di jejak audit). Pada perusahaan kecil yang hanya punya Keuangan,
jurnal manual, kunci periode, dan posting gaji dikerjakan Pemilik/Admin sampai ada Akuntan. **Pengguna Keuangan yang sudah ada tidak berpindah otomatis**:
Pemilik perlu menetapkan peran Akuntan bagi yang bertugas membukukan.

### Peralihan perusahaan yang sudah berjalan

Pengguna Keuangan lama **tidak dipindahkan otomatis** (memindahkan diam-diam justru melanggar pemisahan fungsi). Sebagai gantinya:

- Halaman **Pengguna** menampilkan peringatan selama ada pengguna Keuangan tetapi belum ada Akuntan, dan **Cek kesehatan** memuat temuan "Pemisahan fungsi: Keuangan dan Akuntan".
- Memindahkan pengguna antara Keuangan dan Akuntan tercatat di jejak audit beserta peran lamanya dan **ditandai di Cek kesehatan selama 180 hari** ("Tidak ada pengguna berpindah antara Keuangan dan Akuntan"), karena dua peran yang saling mengawasi tidak boleh sekadar dipertukarkan orang yang sama.
- Pesan penolakan (403) menyebut peran yang berhak, jadi pengguna tahu harus meminta tolong ke siapa.
- Selama belum ada Akuntan, **Pemilik/Admin dianggap akuntan** (jurnal manual, kunci periode, tutup buku, penyusutan, posting gaji) dan Cek kesehatan hanya memberi informasi. Pekerjaan rutinnya dikerjakan sistem (lihat berikut).

### Pembukuan otomatis (menggantikan Akuntan yang belum ada)

Pekerjaan Akuntan yang berbasis aturan tetap dikerjakan sistem atas nama Pemilik, idempoten, dan tercatat di jejak audit (`AUTO_*`). Pengaturan di **Tutup Buku › Pembukuan otomatis**
(diubah Admin/Akuntan):

| Otomatis | Bawaan | Aturan |
|---|---|---|
| Penyusutan aset, jurnal berulang & jurnal balik terjadwal, aturan bank | menyala | sudah ada di menu masing-masing |
| Posting jurnal gaji | menyala | draf yang lewat tanggal bayar dan >24 jam (jeda koreksi SDM) diposting; pembayaran tetap oleh Keuangan |
| Penilaian ulang valas | menyala | akhir bulan lalu, bila ada piutang/utang valas dan semua kurs sudah diisi; dibalik otomatis |
| Kunci periode | mati | tanggal yang dipilih (bawaan 10) mengunci bulan lalu; hanya maju; ditunda bila ada gaji draf atau persetujuan menunggu |
| Tutup buku tahunan | mati | setelah Februari, bila periodenya sudah terkunci sampai 31 Desember |

Kunci periode dan tutup buku sengaja tidak menyala sendiri pada perusahaan yang sudah berjalan (mengubah perilaku pencatatan mundur); tombol **Nyalakan semua** menyalakannya sekaligus.
Kegagalan memberi tahu Pemilik lewat Telegram. Jurnal penutup tahun boleh dibuat sesudah periodenya terkunci (hanya memindahkan saldo pendapatan/beban ke Laba Ditahan).

### Peran khusus (hanya mempersempit)

Di **Pengaturan › Pengguna › Peran khusus**, Pemilik dapat membuat peran turunan dari peran bawaan dengan **mencabut** hak tulis tertentu
(mis. "Admin Tanpa Bayar": Admin tanpa hak menerima/membayar dan menjurnal), lalu menetapkannya ke pengguna.

- **Hanya mempersempit**: tidak pernah memberi hak di luar peran dasarnya, sehingga pemisahan fungsi Keuangan/Akuntan tidak bisa dilanggar lewat peran khusus. Pemilik tidak bisa dibatasi dan tidak bisa dijadikan peran dasar.
- **Hanya Pemilik** yang membuat, mengubah, menghapus, dan menetapkan peran khusus. Admin tidak bisa melepas batas dirinya atau pengguna lain, dan tidak bisa mengubah peran pengguna berperan khusus.
- **Ditegakkan di server** (satu pemeriksaan di RolesGuard, bukan per tombol); `/auth/permissions` ikut mengurangi hak sehingga tombol tersembunyi. Aksi akun sendiri (`/auth`) tidak bisa dicabut.
- Mengganti peran dasar pengguna melepas peran khusus lamanya. Sesi pengguna dicabut saat peran khususnya berubah. Semua perubahan tercatat di jejak audit; perpindahan Keuangan ↔ Akuntan tetap terdeteksi memakai peran dasar.
- Peran khusus yang masih dipakai tidak bisa dihapus.

### Tampilan mengikuti server

Tombol tulis ditampilkan berdasarkan izin dari server (`GET /auth/permissions`, diturunkan dari `@Roles` tiap endpoint), bukan daftar peran yang
ditulis ulang di tampilan. Tes `segregation` memeriksa izin tiap peran sama persis dengan matriks server dan memeriksa semua kunci `can(...)` di kode
tampilan terhadap matriks rute (salah ketik gagal di tes, tidak diam-diam menyembunyikan tombol). Server tetap menolak yang tidak berhak.

## Hak baca (need-to-know)

Data biaya dan stok bernilai tidak terbuka untuk semua peran:
pembelian, supplier, dan mutasi stok hanya untuk Pemilik/Admin/Keuangan/Gudang; faktur dan pesanan penjualan tidak untuk SDM dan Kasir;
pelanggan dan produk tetap terbuka untuk peran yang butuh di kasir dan penjualan.

## Risiko yang tersisa (diterima atau perlu dipantau)

1. **Admin dan Pemilik tidak terkena batas persetujuan** — tindakan mereka dianggap persetujuannya. Penangkalnya jejak audit dan
   verifikasi 2 langkah; pertimbangkan hanya satu Admin, dan Pemilik meninjau jejak audit berkala.
2. **Keuangan memegang PO, faktur, dan pembayaran** karena SANSU tidak punya peran Pembelian terpisah. Dikompensasi dengan pembayaran di atas batas
   menunggu persetujuan, kontrol selisih harga faktur–PO, dan penerimaan barang oleh Gudang.
3. **Sales mengonfirmasi pesanannya sendiri.** Pemeriksaan limit kredit dan blokir pelanggan menunggak berjalan otomatis; limit hanya diubah Keuangan/Admin.
4. **Perusahaan kecil dengan satu atau dua pengguna** tidak bisa memisahkan semua fungsi. Gunakan Pemilik sebagai penyetuju dan aktifkan semua batas persetujuan.

## Memeriksa

```
cd backend
npx jest --config test/jest-e2e.json --runInBand test/segregation
```

Matriks lengkap (semua endpoint beserta peran yang boleh): `backend/scripts/rbac-matrix.ts` (fungsi `routeMatrix`).
