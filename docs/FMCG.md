# Jenis usaha FMCG (barang konsumen cepat laku)

FMCG menggantikan jenis usaha **Produksi**. FMCG adalah model *distribusi*: membeli dari prinsipal/pabrik, menyimpan per lot,
menjual ke toko/outlet lewat sales dengan harga per segmen dan promo, menagih piutang outlet.

## Perusahaan lama bermodel Produksi
Perusahaan yang memilih "Produksi" memang mengolah bahan baku (resep, perintah produksi), jadi migrasi `0058_model_fmcg.sql`
memindahkannya ke **Manufaktur** yang mempertahankan seluruh fitur produksinya. Tidak ada data yang berubah selain pilihan model;
istilah menu dan nama akun bawaan ikut Manufaktur. Pemilik dapat mengganti jenis usaha di Pengaturan bila perlu.

## Yang disesuaikan untuk FMCG
| Area | Perubahan |
|---|---|
| Istilah | Pembelian → "Pembelian dari prinsipal", Supplier → "Prinsipal / pemasok", Pelanggan → "Outlet", Produk → "Produk (SKU)" |
| Bagan akun | Persediaan barang jadi, penjualan produk konsumen, **Beban Trade Promo, Listing Fee & Merchandising (6-2150)**, **Beban Barang Kedaluwarsa & Retur Rusak (6-2160)**, Beban Distribusi & Pengiriman ke Outlet (6-2700); tanpa akun pabrik |
| Laporan | Penjualan neto, HPP (termasuk barang bonus), CALK distribusi barang konsumen |
| Kontrol | Barang terkirim belum difaktur 3 hari, penerimaan belum ditagih 14 hari, selisih margin cabang 8 poin; saran anggaran FMCG |
| Persediaan | Perputaran stok jendela 60 hari, ambang barang lambat/mati lebih ketat (risiko kedaluwarsa) |
| Menu | Penjualan: Daftar harga, Promo & bonus barang, Target & komisi sales. Persediaan: Telusuri lot (recall). Menu Produksi tidak tampil |
| Demo | Distributor makanan/minuman/perawatan dengan 6 outlet, 2 daftar harga, 2 promo, 3 prinsipal, pembelian ber-lot, mobil kanvas |

## Fitur baru
1. **Daftar harga per segmen** (`/price-lists`): harga per satuan dasar, bisa bertingkat menurut jumlah beli. Pelanggan menunjuk satu daftar. Pesanan penjualan memakainya untuk baris tanpa harga; harga yang diisi manual tidak pernah ditimpa.
2. **Promo** (`/promos`): potongan % bertingkat (dipakai yang terbesar, tidak ditumpuk, tidak menimpa potongan manual) dan **bonus barang** (tiap kelipatan jumlah beli). Bisa dibatasi periode dan segmen. Bonus masuk sebagai baris harga Rp 0 → stok terpotong, biaya masuk HPP. Pratinjau lewat `POST /pricing/quote` (dipakai tombol di formulir pesanan).
3. **Telusuri lot / recall** (`GET /inventory/lots/trace`): setiap pengeluaran dari lot dicatat (`stock_lot_issues`); satu nomor lot ditelusuri ke asal penerimaan, pelanggan penerima (surat jalan/faktur), kasir, transfer, pembuangan.
4. **Target & komisi sales** (`/sales-targets`): pesanan dikaitkan ke sales (`salesperson_id`); omzet neto = DPP faktur − DPP retur per bulan; komisi bersyarat ambang pencapaian.

## Pemisahan fungsi
Daftar harga, promo, dan target hanya dapat diubah **Pemilik/Admin** (Sales dan Keuangan hanya melihat); semua perubahan tercatat di jejak audit.
Sales hanya melihat angkanya sendiri di Target & komisi.

## Batasan yang jujur
- **Belum ada**: konsinyasi, retur tukar-guling, kanvas/van sales dengan rute & stok mobil sebagai alur sendiri (stok mobil dapat dipakai lewat gudang satelit dan transfer), integrasi modern trade (EDI/portal peritel), dan trade promo berbasis klaim ke prinsipal. Itu pekerjaan lanjutan.
- Jejak lot hanya mencatat pengeluaran sejak fitur ini aktif; stok lama tidak terlacak (muncul sebagai "tidak terlacak"). Retur pelanggan belum dikembalikan ke lot asal.
- Komisi sales hanya perhitungan; tidak ada jurnal komisi otomatis. Pembayarannya lewat penggajian/insentif manual.
- Perlakuan PPN atas barang bonus dan potongan harus dipastikan dengan konsultan pajak.
- Daftar harga/promo hanya berlaku pada pesanan penjualan Rupiah (pesanan valas diisi manual); kasir (POS) belum memakainya.
