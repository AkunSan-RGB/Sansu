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
| **Sales** | Prospek (CRM), pesanan penjualan, pelanggan baru, kasir bila perlu | Mengirim barang, membuat faktur, menerima pembayaran, mengubah limit kredit, melihat biaya pembelian |
| **Gudang** | Permintaan beli, penerimaan barang, pengiriman barang, mutasi & penghitungan stok, penyesuaian stok | Membuat PO, supplier, faktur, atau pembayaran; membukukan hasil opname sendiri |
| **Kasir** | Penjualan di kasir (POS) | Semua transaksi di luar kasir; membaca faktur, pembelian, atau mutasi stok bernilai |
| **SDM** | Data karyawan, penyusunan gaji | Membayar gaji; membaca penjualan, pembelian, atau kas |

Pemilik selalu lolos semua pemeriksaan peran (dan tidak terkena batas persetujuan).

## Rantai transaksi dan siapa memegang tiap langkah

| Rantai | Langkah → peran |
|---|---|
| **Pembelian** | Permintaan beli (Gudang/Keuangan/Admin) → disetujui (Admin/Pemilik) → PO (Keuangan/Admin) → **penerimaan barang (Gudang/Admin)** → faktur supplier (Keuangan/Admin) → pembayaran (Keuangan/Admin; di atas batas menunggu persetujuan) |
| **Penjualan** | Pesanan (Sales/Admin) → konfirmasi (Sales/Keuangan/Admin) → **pengiriman (Gudang/Admin)** → faktur (Keuangan/Admin) → pembayaran diterima (Keuangan/Admin) |
| **Stok** | Hitung (Gudang) → **dibukukan (Keuangan/Admin)**; penyesuaian stok bernilai besar menunggu persetujuan |
| **Kas & bank** | Catat kas & cocokkan rekening koran (Keuangan/Admin) → di atas batas menunggu persetujuan → pembatalan hanya Pemilik/Admin dengan alasan; hitung kas fisik berselisih besar disetujui Pemilik; **rekonsiliasi bulanan disahkan Akuntan/Admin** (bukan pengimpor rekening koran) |
| **Kas kecil** | Juru kas mencatat bukti → pengisian kembali menunggu persetujuan → pembatalan Pemilik/Admin |
| **Gaji** | Disusun SDM → **jurnalnya diposting Akuntan** → dibayar Keuangan |
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
