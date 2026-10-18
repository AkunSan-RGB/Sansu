# Kontrol alur penjualan (Sales → Gudang → Faktur → Tagih)

Cerminan kontrol alur PO (lihat `KONTROL-ALUR-PO.md`). Pemesan, pengirim barang, dan penagih adalah orang yang berbeda; tiap tahap dicocokkan dengan tahap sebelumnya.

| Kontrol | Cara kerja |
|---|---|
| **Pencocokan tiga arah** (pesanan ↔ surat jalan ↔ faktur) | Faktur lewat menu Penjualan hanya atas barang yang sudah dikirim Gudang. Keuangan ditolak ("belum dikirim Gudang") untuk pesanan yang belum punya surat jalan; jalur "langsung faktur" hanya untuk Pemilik/Admin. Alur internal (kanvas, konsinyasi, integrasi marketplace) tidak terkena karena memang membuat dokumennya sendiri. |
| **Pengiriman buta** (Pengaturan › Persetujuan; mati bawaan) | Gudang tidak melihat jumlah pesanan dan wajib mengisi jumlah yang dikemas. Pengiriman tidak parsial, jadi bila tidak sama dengan pesanan, pengiriman **ditahan** dan Penjualan/Admin/Pemilik diberi tahu. |
| **Pembatalan** | Pesanan yang sudah dikonfirmasi dan surat jalan yang dibatalkan oleh staf (selain Pemilik/Admin) **wajib alasan**; tercatat di jejak audit dan dikabarkan ke Pemilik/Admin/Gudang. Pembatalan otomatis oleh proses internal (kanvas/konsinyasi gagal) tetap jalan dengan alasan otomatis. |
| **Notifikasi** | Pesanan dikonfirmasi → Gudang ("siap disiapkan dan dikirim"); surat jalan dibuat → Keuangan/Admin ("siap ditagih") dan Sales ("sudah dikirim"). Tugas saya: Gudang/Admin "N pesanan menunggu dikirim", Keuangan/Admin "N surat jalan menunggu ditagih". |
| **Tinjauan Pemilik** (Kontrol pembelian & penjualan) | Pesanan dibatalkan setelah dikonfirmasi; surat jalan dibatalkan; diskon besar (≥ 20% per baris). Surat jalan belum difakturkan dan jual rugi sudah ada sebelumnya. |

## Batas yang jujur
- Persetujuan khusus untuk pesanan besar atau diskon besar belum ada (hanya batas kredit pelanggan dan temuan tinjauan). Bila diperlukan, perlu jenis persetujuan baru.
- Pengiriman buta menyembunyikan jumlah di respons API untuk peran Gudang pada pesanan terkonfirmasi, tetapi Gudang tetap bisa menebak dari dokumen fisik.
- Retur/kredit nota untuk pelanggan baru belum diperiksa ulang di PR ini.

Migrasi `0082` menambah kolom alasan pembatalan; dijalankan otomatis saat start.
