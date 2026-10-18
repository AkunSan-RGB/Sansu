# Kontrol alur penjualan (Sales → Gudang → Faktur → Tagih)

Cerminan kontrol alur PO (lihat `KONTROL-ALUR-PO.md`). Pemesan, pengirim barang, dan penagih adalah orang yang berbeda; tiap tahap dicocokkan dengan tahap sebelumnya.

| Kontrol | Cara kerja |
|---|---|
| **Pencocokan tiga arah** (pesanan ↔ surat jalan ↔ faktur) | Faktur lewat menu Penjualan hanya atas barang yang sudah dikirim Gudang. Keuangan ditolak ("belum dikirim Gudang") untuk pesanan yang belum punya surat jalan; jalur "langsung faktur" hanya untuk Pemilik/Admin. Alur internal (kanvas, konsinyasi, integrasi marketplace) tidak terkena karena memang membuat dokumennya sendiri. |
| **Pengiriman buta** (Pengaturan › Persetujuan; mati bawaan) | Gudang tidak melihat jumlah pesanan dan wajib mengisi jumlah yang dikemas. Pengiriman tidak parsial, jadi bila tidak sama dengan pesanan, pengiriman **ditahan** dan Penjualan/Admin/Pemilik diberi tahu. |
| **Pembatalan** | Pesanan yang sudah dikonfirmasi dan surat jalan yang dibatalkan oleh staf (selain Pemilik/Admin) **wajib alasan**; tercatat di jejak audit dan dikabarkan ke Pemilik/Admin/Gudang. Pembatalan otomatis oleh proses internal (kanvas/konsinyasi gagal) tetap jalan dengan alasan otomatis. |
| **Notifikasi** | Pesanan dikonfirmasi → Gudang ("siap disiapkan dan dikirim"); surat jalan dibuat → Keuangan/Admin ("siap ditagih") dan Sales ("sudah dikirim"). Tugas saya: Gudang/Admin "N pesanan menunggu dikirim", Keuangan/Admin "N surat jalan menunggu ditagih". |
| **Tinjauan Pemilik** (menu **Penjualan › Kontrol penjualan**, halaman terpisah dari Kontrol pembelian; dijaga aplikasi Penjualan) | Pesanan dibatalkan setelah dikonfirmasi; surat jalan dibatalkan; diskon besar (≥ 20% per baris); surat jalan belum difakturkan. |

## Kontrol lanjutan (harga, pelanggan, retur, komisi)
Semua ambang diatur di **Pengaturan › Perusahaan › Kebijakan** dan bernilai 0 (mati) secara bawaan; Pemilik/Admin tidak dibatasi tetapi tercatat.

| Kontrol | Cara kerja |
|---|---|
| **Pesanan besar** (`salesOrder`) | Konfirmasi pesanan oleh staf (Sales/Keuangan) dengan total ≥ batas menunggu persetujuan Pemilik/Admin. Pesanan besar yang dikonfirmasi pemilik/admin masuk temuan "Pesanan besar dikonfirmasi tanpa persetujuan terpisah". |
| **Diskon besar** (`salesDiscountMaxPct`) | Diskon per baris di atas batas → konfirmasi menunggu persetujuan. Alur kanvas/konsinyasi tidak dikenai (harga dan potongan sudah dikunci server). Batasan: yang diperiksa adalah kolom diskon; harga yang diubah langsung (di luar daftar harga) belum dibandingkan dengan harga pokok. |
| **Syarat pelanggan** | Menaikkan limit kredit, memperpanjang termin, atau melepas wajib PO oleh selain Pemilik/Admin → butuh persetujuan (memperketat langsung berlaku). Perubahan tercatat dan Pemilik diberi tahu; temuan "Limit kredit / termin pelanggan diubah". |
| **Pelanggan ganda/fiktif** | NPWP sama (angka) atau nama sangat mirip → ditahan (409) sampai dikonfirmasi; konfirmasi tercatat di jejak audit (sama seperti supplier). |
| **Retur penjualan = kredit nota** (`salesReturn`) | Retur bernilai ≥ batas oleh staf menunggu persetujuan sebelum piutang dikurangi. |
| **Pembayaran dicatat terlambat** | Temuan: pembayaran pelanggan dicatat ≥ 3 hari setelah tanggal terima (tanda uang tertahan atau dipakai menutup piutang pelanggan lain). |
| **Komisi** | Temuan: retur terjadi setelah komisi periodenya ditutup (komisi sudah dihitung sebelum retur). Pemotongan komisi tetap manual. |

## Penguatan: harga di bawah pokok, Pemilik diberi tahu, status aktif
- **Harga di bawah harga pokok** (`salesBelowCost`, mati bawaan): pesanan dengan harga jual (setelah diskon) di bawah HPP rata-rata gudang butuh persetujuan saat dikonfirmasi staf. Menutup celah menembus batas diskon lewat harga yang diketik langsung dengan diskon 0%. Baris bonus (harga 0) dan gudang tanpa HPP tidak dihitung.
- **Pemilik diberi tahu (Telegram/email) saat Admin melewati batas:** konfirmasi pesanan besar/diskon besar/di bawah pokok oleh Admin tetap jalan, tetapi tercatat (`CONFIRM_RISKY`) dan Pemilik dikabari; begitu juga retur besar yang dicatat Admin.
- **Banner "Persetujuan penjualan belum aktif"** di halaman Kontrol penjualan bila semua ambang masih 0, dengan tombol **Terapkan rekomendasi** (pesanan ≥ Rp50 juta, diskon > 15%, retur ≥ Rp5 juta, harga di bawah pokok) untuk Pemilik/Admin. Nilainya bisa diubah di Pengaturan › Perusahaan › Kebijakan.

## Pembayaran pelanggan dan pemisahan fungsi Keuangan
- **Pembayaran transfer yang tidak ada di mutasi bank:** temuan bila pembayaran non-tunai (≥ 3 hari lalu) tidak cocok dengan baris mutasi bank, padahal mutasi bank periode itu sudah diimpor ke rekening yang sama. Bisa pembayaran fiktif atau salah rekening. Belum dinilai bila mutasi periodenya belum diimpor. Pembayaran **tunai** belum bisa diperiksa (belum ada pencatatan setoran ke bank yang terkait ke pembayaran).
- **Pemisahan fungsi penjualan** (`salesSeparateDuties`, mati bawaan; Pengaturan › Kebijakan): pembayaran pelanggan atau retur atas faktur oleh orang yang membuat faktur itu sendiri (selain Pemilik/Admin) menunggu persetujuan Pemilik/Admin; orang lain langsung boleh. Cocok bila ada lebih dari satu Keuangan; bila hanya satu, semua pembayaran akan menunggu persetujuan, jadi jangan dinyalakan.
- **Temuan** "Pembayaran/Retur dicatat oleh pembuat fakturnya sendiri" (info) muncul walau saklar mati, tetapi **hanya bila ada dua pengguna Keuangan aktif atau lebih**; dengan satu Keuangan temuan disembunyikan karena pasti terjadi dan hanya jadi kebisingan. Dengan satu Keuangan, pengawasnya adalah rekonsiliasi bank dan tinjauan Pemilik.
- **Blokir order pelanggan berfaktur jatuh tempo** sudah ada sejak awal (kontrol kredit): pesanan baru ditolak selama ada faktur lewat jatuh tempo, dan juga bila eksposur melebihi limit kredit.

## Yang belum dibuat
- **Pengiriman parsial** (kirim sebagian lalu sisanya menyusul): butuh perubahan besar pada faktur, surat jalan, dan jurnal; dikerjakan terpisah bila diperlukan.
- **Penghapusan piutang (write-off)**: belum ada fiturnya di SANSU (hanya penyisihan lewat jurnal penyesuaian). Bila fitur dibuat, harus butuh persetujuan Pemilik.

## Batas yang jujur
- Persetujuan khusus untuk pesanan besar atau diskon besar belum ada (hanya batas kredit pelanggan dan temuan tinjauan). Bila diperlukan, perlu jenis persetujuan baru.
- Pengiriman buta menyembunyikan jumlah di respons API untuk peran Gudang pada pesanan terkonfirmasi, tetapi Gudang tetap bisa menebak dari dokumen fisik.
- Retur/kredit nota untuk pelanggan baru belum diperiksa ulang di PR ini.

Migrasi `0082` menambah kolom alasan pembatalan; dijalankan otomatis saat start.

## Pengiriman parsial & hapus piutang

**Pengiriman parsial**
- Satu pesanan boleh dikirim bertahap (beberapa surat jalan). Tombol *Kirim sebagian* di halaman pesanan; *Kirim semua sisa* mengirim yang belum terkirim.
- Pesanan tetap *Dikonfirmasi* sampai semua barang terkirim, lalu *Dikirim*. Faktur baru bisa dibuat setelah semuanya terkirim dan menagih seluruh pesanan; HPP = jumlah HPP semua surat jalan. Belum ada faktur per surat jalan.
- Pesanan yang sudah terkirim sebagian tidak bisa dibatalkan atau difakturkan langsung (batalkan surat jalannya dulu). Membatalkan satu surat jalan mengembalikan pesanan ke *Dikonfirmasi*.
- Pengiriman buta: jumlah yang dikemas harus sama dengan *sisa* pesanan (Gudang pada mode buta tidak bisa mengirim sebagian).
- Temuan `PARTIAL_DELIVERY_STUCK` di Kontrol penjualan: terkirim sebagian dan sisanya belum dikirim > 14 hari.
- Belum ada "tutup sisa pesanan" (mengurangi jumlah pesanan); sisa yang tak akan dikirim harus dikirim atau seluruh surat jalan dibatalkan.

**Hapus piutang (write-off)**
- Tombol *Hapus piutang* di faktur. Syarat: lewat jatuh tempo ≥ 90 hari (Pemilik dikecualikan), alasan wajib (≥ 5 huruf), faktur rupiah.
- Pemilik/Admin langsung berlaku; Keuangan menunggu persetujuan Pemilik/Admin. Pemilik diberi tahu (Telegram/email).
- Jurnal: Dr Cadangan kerugian piutang (sebatas saldonya) + Dr Beban kerugian piutang (sisanya, akun 6-7300) | Cr Piutang usaha. Dicatat sebagai pembayaran bermetode "Hapus piutang" tanpa kas, sehingga sisa tagihan di semua laporan ikut berkurang; faktur berstatus Lunas.
- Temuan `AR_WRITE_OFF` di Kontrol penjualan menampilkan semua penghapusan 60 hari terakhir beserta pelakunya.
- Batas jujur: PPN keluaran atas piutang yang dihapus tidak dikoreksi otomatis (perlu nota retur/pembatalan PPN sesuai ketentuan pajak, tinjau dengan konsultan pajak); faktur valas belum didukung; piutang yang kemudian dibayar pelanggan dicatat manual sebagai pendapatan lain.
