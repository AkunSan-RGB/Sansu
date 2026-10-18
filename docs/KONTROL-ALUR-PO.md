# Kontrol alur PO (Pembelian → Gudang → Tagihan → Bayar)

Prinsip: pemesan, penerima barang, pencatat tagihan, dan pembayar adalah orang yang berbeda, dan tiap tahap dicocokkan dengan tahap sebelumnya.

| Kontrol | Cara kerja |
|---|---|
| **Pencocokan tiga arah** (PO ↔ penerimaan ↔ tagihan) | Faktur supplier hanya atas barang yang sudah diterima Gudang. Jalur "terima & faktur sekaligus" hanya untuk Pemilik/Admin; Keuangan ditolak ("belum diterima Gudang"). Harga faktur di atas toleransi/harga pasar tetap butuh persetujuan (sudah ada). |
| **Penerimaan buta** (Pengaturan › Persetujuan › Penerimaan buta; mati secara bawaan) | Gudang tidak melihat jumlah pesanan dan wajib mengisi hasil hitungannya. Selisih dengan pesanan langsung dikabarkan (Telegram/email) ke Pembelian, Admin, Pemilik. Jumlah lebih dari sisa pesanan tetap ditolak. |
| **PO tidak dapat diubah setelah dikonfirmasi** | Tidak ada fitur ubah PO; yang ada hanya batal lalu buat baru. Pembatalan PO terkonfirmasi oleh staf **wajib alasan**, tercatat, dan dikabarkan ke Pemilik/Admin/Gudang; muncul di Kontrol pembelian ("PO dibatalkan setelah dikonfirmasi"). |
| **Rekening supplier** | Rekening tersimpan di data supplier. Mengubah rekening yang sudah terisi oleh selain Pemilik/Admin → permintaan persetujuan (berlaku setelah disetujui orang lain). Pemilik diberi tahu setiap perubahan; tercatat di jejak audit. |
| **Tahan pembayaran setelah rekening berubah** | Pembayaran oleh staf ke supplier yang rekeningnya diubah ≤ 7 hari (bisa diatur, 0 = mati) menunggu persetujuan. |
| **Notifikasi** | PO dikonfirmasi → Gudang ("PO X dari Y akan datang"); barang diterima → Pembelian; selisih penerimaan → Pembelian/Admin/Pemilik; keputusan persetujuan (setuju/tolak) → pemohon. Tugas saya: "N PO menunggu barang diterima" untuk Gudang/Pembelian/Admin. |
| **Tinjauan Pemilik** (Kontrol pembelian) | PO bernilai di atas batas persetujuan yang dikonfirmasi tanpa persetujuan terpisah (pemilik/admin atau batas otomatis pemasok favorit); PO dibatalkan setelah dikonfirmasi; rekening supplier diubah. |

## Yang sengaja tidak dibuat
- **"Pesanan darurat tanpa persetujuan"** tidak dibuat sebagai jalur terpisah karena justru membuka celah menghindari persetujuan. Pemilik/Admin yang berwenang sudah bisa mengonfirmasi langsung, dan itu ditinjau lewat temuan "PO bernilai besar dikonfirmasi tanpa persetujuan terpisah".

## Batas yang jujur
- Penerimaan buta menyembunyikan jumlah pesanan di respons API untuk peran Gudang pada PO terkonfirmasi, tetapi Gudang tetap bisa menebak dari dokumen fisik/surat jalan.
- Nama pemilik rekening belum dicocokkan otomatis dengan nama supplier (hanya diisi dan ditampilkan).
- Pembayaran tidak otomatis memakai rekening tersimpan (belum ada integrasi transfer bank).

Migrasi `0081` menambah kolom rekening supplier dan alasan pembatalan PO; dijalankan otomatis saat start.
