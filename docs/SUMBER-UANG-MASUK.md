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

## Pemberitahuan real-time ke Keuangan (Telegram)
Uang masuk di luar penjualan langsung dikabarkan ke pengguna **Keuangan** lewat Telegram (dan email bila dikonfigurasi), supaya tidak terlewat:
- Kas masuk baru dicatat (oleh siapa pun selain Keuangan yang bersangkutan).
- Mutasi bank masuk yang dijurnal lewat "Buat jurnal".
- Impor mutasi bank berisi uang masuk yang belum cocok dengan pembayaran mana pun.

Syarat: `TELEGRAM_BOT_TOKEN` terpasang dan pengguna Keuangan sudah menghubungkan Telegram (Keamanan akun › Hubungkan Telegram). Pelaku sendiri tidak dikirimi. Tanpa Telegram terhubung, pemberitahuan hanya lewat email/Tugas saya.

## Penutup celah anti-fraud
- **Pembayaran pelanggan dibelokkan:** uang masuk lewat sumber (kas masuk atau mutasi bank) yang jumlahnya persis sama dengan sisa piutang suatu faktur, atau yang keterangan/bukti-nya menyebut nama pelanggan/nomor faktur yang masih berutang, **ditolak untuk Keuangan** (diarahkan ke Faktur & piutang). Pemilik/Admin boleh melanjutkan, tetapi tercatat di jejak audit (`CASH_IN_LOOKALIKE_RECEIVABLE`) dan Pemilik + Akuntan diberi tahu.
- **Eskalasi:** uang masuk di rekening yang lebih dari 1 hari belum dicocokkan/dijelaskan dikabarkan ke Pemilik dan Akuntan (sekali per hari, lewat penjadwal pengingat).
- **Batas yang jujur:** pencocokan memakai jumlah persis dan nama (≥4 huruf); pembayaran sebagian atau tanpa nama tidak terdeteksi. Uang tunai yang tidak pernah dicatat tetap tidak terlihat sistem (hanya selisih hitung kas dan rekonsiliasi bank).

## Uang keluar: jenis biaya otomatis
Kas keluar memakai prinsip yang sama: pilih **jenis biaya** (Listrik/air/telepon, Sewa, Bensin, ATK, Perbaikan, Iklan, Asuransi, Jasa profesional, Biaya lain-lain) dan sistem menentukan akun beban serta jurnalnya. Sewa, asuransi, jasa profesional, dan biaya lain-lain wajib bukti. Aturan tambahan: **Keuangan hanya boleh mengeluarkan uang untuk biaya atau pembelian aset**; prive, bayar utang/pajak, dan modal dicatat Pemilik/Admin atau lewat dokumennya. Batas bukti, persetujuan, anggaran, dan saldo negatif tetap berlaku seperti biasa. Pemilik/Admin tetap bisa memilih akun langsung.
