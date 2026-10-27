# Pemisahan uang keluar: Keuangan yang membayar, Admin yang mengatur

**Aturan (berlaku untuk semua jenis usaha):**

- **Mengeluarkan uang** hanya **Keuangan**. Pemilik selalu boleh sebagai cadangan (perusahaan kecil yang belum punya pengguna Keuangan).
- **Membatalkan pengeluaran uang** hanya **Pemilik**. Yang membayar tidak bisa menghapus jejaknya sendiri.
- **Admin** mengatur pengguna, peran, dan pengaturan; Admin **tidak** mengeluarkan uang dan tidak membatalkannya.
- **Akuntan** tetap hanya membukukan, tidak memegang uang.

Alasannya: bila Admin bisa membuat pengguna, memberi hak, dan juga membayar, satu orang dapat mengeluarkan uang tanpa orang kedua.

## Jalur yang tercakup

| Jalur | Peran (selain Pemilik) |
|---|---|
| Kas keluar dan kas valas (`POST /cash/transactions`, `/cash/foreign`) | Keuangan |
| Kas kecil: voucher, isi ulang, top-up | Keuangan |
| Bayar pemasok, uang muka pemasok, pengembalian uang muka | Keuangan |
| Setor pajak | Keuangan |
| Pengembalian (refund) transaksi kasir | Keuangan |
| Komisi sales dibayar | Keuangan |
| Pengembalian deposit atau jaminan pelanggan Utilitas | Keuangan |
| Bayar gaji | Keuangan (sudah demikian sebelumnya) |
| Pembatalan kas keluar, voucher kas kecil, pembayaran pemasok, uang muka pemasok, setoran pajak, komisi | Pemilik saja |

Admin tetap bisa **melihat** halaman kas, pembayaran, dan pajak, serta mengatur plafon dan juru kas kas kecil; hanya tindakan mengeluarkan dan membatalkan yang dicabut.

## Yang berubah bagi pengguna

- Perusahaan yang selama ini membayar lewat akun Admin sekarang ditolak (pesan 403 menyebut "Yang berhak: Pemilik, Keuangan"). Buat satu pengguna Keuangan, atau bayar lewat akun Pemilik.
- Tombol Bayar, Batalkan, dan Isi kembali disembunyikan untuk peran yang tidak berhak (izin tampilan mengikuti server).
- Daftar tugas "mutasi bank belum dicocokkan" dan "bukti kas kecil belum diganti" kini muncul untuk Keuangan (dan Pemilik), tidak lagi untuk Admin.

## Penjagaan

`backend/test/segregation.e2e-spec.ts` (bagian "uang keluar") memeriksa tiga hal: matriks hak akses tiap jalur di atas, penolakan langsung untuk Admin, Akuntan, dan Kasir, serta izin tampilan Admin dan Keuangan. Menambah jalur uang keluar baru berarti menambahkannya ke daftar di tes itu.

## Batas yang diketahui

- Daftar jalur disusun dari pemindaian peran di controller dan dari tinjauan manual; jalur uang keluar yang baru perlu ditambahkan ke tes secara manual.
- Pembatalan hanya Pemilik berarti Pemilik harus tersedia saat ada salah catat; belum ada peran "pembatal" khusus (mis. Akuntan) di luar Pemilik.
- Pembayaran langganan SANSU (`POST /billing/invoices/:id/pay`) tetap oleh Admin karena itu urusan akun layanan, bukan uang operasional perusahaan.
