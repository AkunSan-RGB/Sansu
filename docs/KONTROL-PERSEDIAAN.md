# Kontrol persediaan

Menu **Persediaan › Kontrol persediaan** (`/inventory-controls`) menampilkan temuan 60 hari terakhir. Pengaturannya di **Pengaturan › Perusahaan › Kebijakan** (Pemilik/Admin).

| Kontrol | Cara kerja |
|---|---|
| **Penyesuaian stok / selisih opname besar butuh persetujuan** (`stockAdjustment`, bawaan mati) | Penyesuaian stok (masuk + keluar) oleh staf bernilai ≥ batas menunggu persetujuan Pemilik/Admin (sudah ada). **Baru:** batas yang sama kini berlaku untuk **selisih stock opname** (|selisih| × HPP rata-rata) saat diposting Keuangan; sebelumnya opname lolos tanpa persetujuan. |
| **Pemilik diberi tahu** (`stockAlertValue`, bawaan Rp5 juta) | Telegram/email ke Pemilik bila penyesuaian stok keluar atau selisih opname bernilai ≥ batas, siapa pun pelakunya selain Pemilik. Tidak memblokir; murni pemberitahuan. 0 = mati. |
| **Penghitung ≠ pemosting** (`stockCountSod`, mati bawaan) | Yang terakhir mengisi jumlah fisik opname tidak boleh memposting selisihnya sendiri (selain Pemilik). Nyalakan bila ada lebih dari satu Admin/Keuangan. |
| **Opname buta** (`blindCount`, mati bawaan) | Gudang yang menghitung tidak melihat stok sistem (kolom stok sistem, selisih, dan nilai selisih disembunyikan) selama opname berjalan; Keuangan/Admin tetap melihat. |
| **Gudang lewat jadwal opname** | Temuan + tugas "N gudang belum diopname > 35 hari" untuk gudang utama yang berisi stok dan sudah punya mutasi lebih dari 35 hari. |
| **Transfer menggantung** | Temuan + tugas untuk transfer berstatus di perjalanan > 3 hari. |

Temuan di halaman: penyesuaian stok keluar berulang (dipindah dari Kontrol pembelian), penyesuaian stok keluar bernilai besar, stock opname dengan kekurangan besar, gudang lewat jadwal opname, transfer menggantung.

## Yang sudah ada sebelumnya
Stok tidak boleh negatif; alasan wajib saat penyesuaian; tanggal masa depan ditolak; selisih opname dibukukan terhadap stok saat diposting dan dijaga dari posting ganda; lot dan kedaluwarsa; penurunan nilai persediaan oleh Akuntan; penerimaan buta (pembelian) dan pengiriman buta (penjualan).

## Batas yang jujur
- Persetujuan penyesuaian/opname dan opname buta mati secara bawaan; hanya pemberitahuan Pemilik (Rp5 juta) yang menyala.
- Opname buta menyembunyikan stok sistem di respons API untuk peran Gudang pada opname yang berjalan, tetapi Gudang masih bisa melihat stok di halaman Persediaan.
- Nilai selisih memakai HPP rata-rata saat ini, bukan biaya per lot.
- Jadwal opname per kategori/barang bernilai tinggi (opname siklus) belum ada; saat ini per gudang, 35 hari.

Migrasi `0083` menambah kolom pencatat jumlah fisik opname; dijalankan otomatis saat start.

## Penguatan lanjutan

- **Harga pokok stok masuk**: penyesuaian stok MASUK (selain saldo awal) oleh staf dengan harga pokok di atas rata-rata stok + toleransi (`stockInCostTolerancePct`, Pengaturan › Perusahaan › Kebijakan) menunggu persetujuan Pemilik/Admin. Mencegah penggelembungan nilai persediaan.
- **Stok masuk besar** (≥ batas pemberitahuan nilai stok) oleh bukan Pemilik: Pemilik diberi tahu; muncul sebagai temuan `ADJ_IN_LARGE`.
- **Pemecahan penyesuaian**: dua penyesuaian keluar atau lebih dalam 3 hari di gudang yang sama, masing-masing di bawah batas persetujuan tetapi jumlahnya melewati batas → temuan `ADJ_OUT_SPLIT`.
- **Transfer antar gudang**: saklar `transferSod` — pembuat transfer tidak boleh menerimanya sendiri (kecuali Pemilik).
- **Selisih opname besar** (≥ batas pemberitahuan) wajib diisi catatan alasan (minimal 5 huruf) sebelum diposting.
- **Banner "Pengaman belum aktif"** di Kontrol persediaan dan Kontrol penjualan, dengan tombol *Terapkan rekomendasi*.

Belum dikerjakan: opname siklus terjadwal dan rekonsiliasi stok vs buku besar.
