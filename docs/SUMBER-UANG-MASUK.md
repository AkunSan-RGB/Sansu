# Uang masuk di luar penjualan: otomatis, bukan tugas Keuangan membuat jurnal

Pembukuan (akun, jurnal) bukan pekerjaan Keuangan. Karena itu untuk uang masuk yang bukan dari penjualan, Keuangan memilih **sumber uang** dalam bahasa kegiatan usaha; sistem yang menentukan akun dan membuat jurnalnya.

| Sumber uang | Akun otomatis | Bukti wajib | Diberi tahu |
|---|---|---|---|
| Modal dari pemilik | 3-1000 Modal Disetor | Ya | Pemilik, Akuntan |
| Pinjaman bank diterima | 2-1800 Utang Bank Jangka Pendek | Ya | Pemilik, Akuntan |
| Pinjaman dari pihak lain / pemilik | 2-1150 Utang Lain-lain | Ya | Pemilik, Akuntan |
| Bunga / jasa giro bank | 4-9100 Pendapatan Bunga | Tidak | — |
| Pendapatan sewa | 4-2200 Pendapatan Sewa | Ya | — |
| Pendapatan lain-lain | 4-9000 Pendapatan Lain-lain | Ya | Pemilik, Akuntan |

## Di mana dipakai
- **Kas & Bank › Uang masuk & keluar › Kas masuk:** kolom "Sumber uang masuk".
- **Kas & Bank › Cocokkan dengan bank › Buat jurnal (mutasi masuk):** pilih sumber uang.
- **Pembayaran pelanggan TIDAK dicatat di sini.** Lewat Faktur & piutang (atau kasir) agar piutang dan stok ikut benar.

## Aturan pengamanan
- **Keuangan wajib memakai sumber**; memilih akun pembukuan langsung hanya untuk Pemilik/Admin. Sumber dan akun tidak boleh diisi bersamaan.
- Sumber yang mengubah modal/utang/pendapatan wajib nomor bukti (bukti setor, perjanjian pinjaman, nota).
- Pemilik dan Akuntan menerima pemberitahuan atas modal, pinjaman, dan pendapatan lain-lain agar bisa memverifikasi.
- Panel **Uang masuk per sumber** (halaman Uang masuk & keluar) memisahkan penjualan dari non-penjualan. Penjualan yang dicatat lewat kas masuk/mutasi bank ke akun penjualan ditandai "perlu diperiksa" (melewati faktur/kasir).

## Batasan
- Daftar sumber tetap (6). Sumber lain (mis. pengembalian dari pemasok, penjualan aset) memakai jalurnya sendiri (retur, Aset Tetap › Jual) atau dicatat Pemilik/Admin lewat akun.
- Pengaturan akun mengikuti kode bagan akun bawaan; bila akun tersebut diubah/dihapus, sumbernya menampilkan pesan agar Admin/Akuntan memperbaiki.
- Uang keluar belum memakai kategori otomatis (Keuangan masih memilih akun beban).
