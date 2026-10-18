# Serah terima dokumen antar bagian, otomatisasi, notifikasi, dan anti-fraud per alur

Hasil tinjauan alur lintas bagian (Penjualan → Gudang → Keuangan; Pembelian → Gudang → Keuangan; Produksi; Kasir; Penggajian) dan perbaikannya.

## Temuan tinjauan
| Alur | Sebelumnya | Sekarang |
|---|---|---|
| Pesanan dikonfirmasi → Gudang | Gudang baru tahu bila membuka daftar pesanan | Pemberitahuan ke Gudang + antrean "pesanan menunggu dikirim" |
| Barang terkirim → Keuangan | Hanya pengingat setelah berhari-hari ("surat jalan belum difaktur") | Pemberitahuan ke Keuangan saat terkirim + antrean sampai difakturkan |
| PO dikonfirmasi → Gudang | Tidak ada | Pemberitahuan + antrean "PO menunggu penerimaan" |
| Barang diterima → Keuangan | Pengingat setelah lama (GRNI) | Pemberitahuan + antrean "sudah diterima, belum ditagih" (3-way match) |
| Permintaan beli disetujui → Pembelian | Pengingat umum | Pemberitahuan ke Pembelian + antrean sampai jadi PO |
| Produksi selesai → Gudang/Sales | Tidak ada | Pemberitahuan |
| Sesi kasir ditutup → Keuangan/Admin | Tidak ada | Pemberitahuan (menyebut selisih kas) + antrean sesi berselisih 7 hari |
| Gaji diposting → Keuangan | Tidak ada | Pemberitahuan + antrean "diposting, belum dibayar" |
| Persetujuan, permintaan beli, upah kerja, kontrak harga, perubahan data karyawan, cuti, kasus alur kerja | Sebagian | Satu kotak **Tugas saya** menurut pemisahan fungsi (lihat `VERTIKAL-LANJUTAN.md`) |

Antrean dihitung dari **status dokumen** (selalu mutakhir; tidak ada tabel tugas yang bisa basi). Pemberitahuan (Telegram/email bila terhubung) dikirim ke peran penerima dan **tidak ke pelaku** yang baru bertindak; gagal kirim tidak pernah menggagalkan proses utama.

## Dikurangi (agar tidak dobel)
Lonceng tidak lagi menampilkan pengingat yang sudah tercakup antrean tugas pengguna itu (persetujuan, permintaan beli, surat jalan belum difaktur, PO belum diterima, barang belum ditagih). Pengingat tetap dipakai untuk eskalasi/ringkasan email.

## Kontrol anti-fraud per alur (`/controls`, menu Akuntansi → Kontrol anti-fraud)
Melengkapi Kontrol pembelian (PO dipecah, pembayaran akhir pekan, supplier baru langsung dibayar, dst.). Periode 60 hari (30 hari untuk pola berulang):
- **Penjualan**: diskon baris ≥ 25%; faktur di bawah harga pokok; faktur diretur ≥ 50%; pelanggan dengan ≥ 3 retur/30 hari; piutang melebihi batas kredit.
- **Kasir**: kasir dengan selisih kas di ≥ 3 sesi; kasir dengan ≥ 5 retur/30 hari; sesi dibuka dini hari.
- **Kas**: kas keluar berulang (≥ 3×) tepat di bawah batas persetujuan (memecah transaksi); transaksi dibatalkan oleh pembuatnya sendiri.
- **SDM**: rekening bank dipakai > 1 karyawan; karyawan tetap digaji tanpa satu pun absensi hadir padahal sebagian besar rekannya punya (dugaan karyawan fiktif).
Hanya menandai pola dan menyebut dokumen/orangnya; bukan bukti kesalahan.

## Batasan yang ditemukan dan belum diubah
- Faktur, pembayaran piutang, dan retur penjualan tidak menyimpan "dibuat oleh" di tabelnya (hanya di jejak audit), sehingga kontrol per pembuat untuk penjualan belum bisa seketat kasir/kas.
- Ambang kontrol (25%, 50%, 3×, 5×) bawaan dan belum bisa diatur per perusahaan.
- Pemberitahuan memakai Telegram/email yang sudah dikonfigurasi; tanpa itu hanya antrean Tugas saya dan lonceng.
- Belum diuji pengguna nyata; ambang dan frekuensi pemberitahuan perlu disesuaikan dari pengalaman pilot.
