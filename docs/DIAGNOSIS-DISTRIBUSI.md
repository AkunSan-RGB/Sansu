# Demo FMCG untuk "Cek Kebocoran Distribusi"

Demo FMCG (tombol Lihat Demo → Distribusi/FMCG) berisi contoh yang cocok dipakai saat sesi diagnosis dengan calon pelanggan distributor. Data dibuat ulang tiap kali demo dibuka dan dihapus otomatis setelah 3 hari.

| Titik di checklist | Di demo ada apa | Di mana dilihat |
|---|---|---|
| Stok | Stock opname dengan dua barang berselisih, sudah diposting | Persediaan › Stock opname |
| Kedaluwarsa dan lot | Biskuit (lot BSK-2409A) dan Teh Kotak (TEH-2410B) hampir kedaluwarsa, semua barang ber-lot | Persediaan › Kedaluwarsa bahan |
| Retur | Tiga retur berulang dari satu outlet (Grosir Sumber Rezeki), alasan seragam "Barang rusak di perjalanan", ditambah satu retur lain | Penjualan › Retur penjualan |
| Kanvas / setoran | Sales kanvas Andi Pratama: satu setoran **kurang Rp 180.000** (selisih otomatis jadi Piutang Karyawan, akun 1-1600), satu pas, satu masih **menunggu verifikasi** | Penjualan › Kanvas (van sales) |
| Piutang | Faktur Supermarket Maju Bersama belum dibayar dan jatuh tempo | Penjualan › Faktur |
| Pemisahan tugas | Setoran kanvas hanya bisa diverifikasi orang lain dari sales dan dari pencatatnya; penjualan ke outlet yang punya faktur jatuh tempo ditolak sistem | Coba langsung di demo |
| Syarat dagang minimarket | Rebate dan listing fee yang diakru bulanan | Penjualan › Modern trade & klaim prinsipal |

## Yang tidak ada di demo (jangan dijanjikan)
- **Klaim trade promo ke prinsipal** yang terlambat atau tidak tertagih: demo hanya memuat syarat dagangnya, belum klaim yang bermasalah.
- **Penjualan di bawah daftar harga atau diskon liar**: di SANSU harga dan potongan dikunci server (daftar harga dan promo), jadi justru dijadikan contoh kontrol, bukan kebocoran.
- Angka rupiah di demo hanya contoh; nilai kebocoran untuk calon pelanggan dihitung dari data mereka sendiri dan disebut "indikasi, perlu verifikasi".

## Cara menjalankan di sesi 60 menit
1. Jalani 9 titik checklist dengan data calon pelanggan.
2. Untuk tiga titik teratas, buka halaman yang bersangkutan di demo dan tunjukkan bagaimana sistem menangkapnya.
3. Akhiri dengan tawaran masa uji 60–90 hari memakai data mereka sendiri.
