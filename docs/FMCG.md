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

## Fitur lanjutan (alur dan pencegahan kecurangan)
| Fitur | Alur | Kontrol anti-kecurangan |
|---|---|---|
| **Jurnal komisi** (`/sales-commissions`) | Tutup bulan (Akuntan/Admin) membekukan angka dan menjurnal Dr Beban Komisi \| Cr Utang Komisi; dibayar Keuangan/Admin (Dr Utang Komisi \| Cr Kas, PPh 21 opsional) | Penutup ≠ pembayar (Pemilik dikecualikan); angka tidak bisa diedit; target bulan lewat/ditutup terkunci; 1 komisi/sales/bulan; batal hanya sebelum dibayar dengan jurnal balik + alasan; penanda pesanan "diinput orang lain" |
| **Rekonstruksi jejak lot lama** (`POST /inventory/lots/rebuild-trace`) | Admin mengalokasikan pengeluaran lama ke lot (FEFO, hanya sisa yang belum terjelaskan) | Hasil ditandai *perkiraan*, tak menimpa jejak asli, aman diulang, tercatat di audit |
| **Tukar-guling** (`/goods-swaps`) | Usulan (Sales/Gudang/Admin) → disetujui Keuangan/Admin: stok pengganti keluar, Dr Beban Barang Kedaluwarsa & Retur Rusak \| Cr Persediaan; piutang tetap | Wajib acuan faktur outlet ≤ 180 hari; pengganti produk & jumlah sama; batas kumulatif per baris faktur (termasuk usulan menunggu); penyetuju ≠ pembuat |
| **Konsinyasi** (`/consignments`) | Kirim titipan ke gudang konsinyasi outlet → outlet lapor → diperiksa & ditagih (faktur dari gudang itu) → tarik sisa | Pelapor ≠ penagih; nomor laporan outlet unik; laporan ≤ sisa titipan (dikurangi laporan belum ditagih); nilai titipan ≤ limit kredit; titipan macet ditandai; tidak bisa dijual lewat pesanan biasa |
| **Kanvas / van sales** (`/canvass`) | Mobil per sales (muat/bongkar oleh gudang) → jual dari mobil → setoran tagihan → Keuangan menerima uang | Harga/potongan dikunci server (sales tak bisa mengubah); mobil milik sendiri; setoran = klaim sampai Keuangan memverifikasi (pencatat ≠ pemverifikasi); faktur dilunasi sebesar yang dicatat sales dan kekurangan setor menjadi **Piutang Karyawan** (Dr Piutang Karyawan \\| Cr Piutang Usaha) di pembukuan; Sales tidak melihat HPP; kunjungan 1/outlet/hari dengan jarak dari koordinat outlet; setoran > 2 hari ditandai |
| **Modern trade** (`/trade`, `/trade-terms`) | PO outlet wajib & unik; syarat dagang (rebate %, biaya tetap) diakru bulanan Dr Beban Trade Promo \| Cr Utang Rebate; dilunasi potong tagihan (Dr Utang Rebate \| Cr Piutang) atau dibayar | Syarat hanya diubah Admin; akru ≠ pelunasan; 1 syarat 1× per bulan; potongan ≤ sisa utang & sisa tagihan; batal hanya bila belum dilunasi |
| **Klaim ke prinsipal** (`/principal-claims`) | Promo dicatat prinsipal penanggung & persennya → klaim bulanan dari baris pesanan berpromo (potongan + biaya bonus) → diajukan → persetujuan prinsipal (Dr Piutang Klaim \| Cr Beban Trade Promo) → diterima (Dr Kas \| Cr Piutang Klaim) | Tiap baris pesanan hanya bisa diklaim sekali; pencatat persetujuan ≠ pembuat klaim; yang menerima uang = Keuangan; ditolak seluruhnya → baris dilepas |

## Kontrol tambahan (hasil tinjauan independen)
- Gudang konsinyasi/mobil hanya berpindah lewat menu Konsinyasi/Kanvas: transfer biasa, kasir, PO/permintaan beli, dan penyesuaian stok ke gudang itu ditolak (koreksi stok = stock opname).
- Retur penjualan tidak boleh melebihi sisa setelah tukar-guling (termasuk yang menunggu persetujuan).
- Pesanan dari mobil oleh Sales hanya lewat Kanvas (harga/potongan dikunci); Sales tidak dapat mengalihkan pesanan ke sales lain maupun menetapkan limit kredit/termin/daftar harga/wajib PO saat membuat outlet.
- Faktur konsinyasi memakai nomor laporan outlet sebagai acuan PO, tanpa promo/bonus tambahan; penawaran yang dikonversi dan pesanan marketplace tidak terkena promo.
- Penanggung promo (prinsipal & persen) dibekukan di baris pesanan; klaim dikurangi barang yang diretur.
- Pengganti tukar-guling tidak diambil dari lot yang ditarik. Gudang konsinyasi/mobil unik per outlet/sales dan tunduk pada kuota gudang paket.

## Batasan yang jujur
- Kirim titipan / tarik titipan / muat / bongkar memindahkan stok lalu mencatat dokumennya sebagai dua langkah; kegagalan di tengah (sangat jarang) dapat meninggalkan perpindahan stok tanpa dokumen — periksa Transfer gudang.
- Syarat dagang tidak diprorata bila masa berlaku parsial di tengah bulan (dihitung penuh per bulan). Harga daftar bertingkat disimpan 4 desimal per satuan dasar tetapi harga baris dibulatkan 2 desimal per satuan sehingga dapat selisih beberapa rupiah pada kuantitas sangat besar.
- Konsinyasi hanya arah **keluar** (kita menitipkan ke outlet). Konsinyasi masuk (prinsipal menitipkan ke kita) belum ada.
- Tukar-guling hanya untuk barang **tidak layak jual** (rusak/kedaluwarsa/ditarik) dengan pengganti identik; barang lama tidak masuk stok. Retur dengan uang kembali/nota kredit memakai Retur penjualan biasa.
- Kanvas: kunjungan memakai koordinat dari perangkat (GPS ponsel) yang dapat dimanipulasi; jarak hanya penanda untuk ditinjau. Tidak ada mode offline. Optimasi rute belum ada (urutan manual).
- Modern trade: tidak ada integrasi EDI/portal peritel; nomor PO diisi manual. Perlakuan PPN atas rebate, potongan, dan barang bonus harus dipastikan dengan konsultan pajak.
- Rekonstruksi jejak lot adalah **perkiraan** (alokasi FEFO), bukan catatan asli saat barang keluar; pembuangan lot tertentu di masa lalu mungkin teralokasi ke lot lain. Retur pelanggan belum dikembalikan ke lot asal.
- Komisi: PPh 21 atas komisi pegawai tetap harus diisi saat bayar atau dimasukkan ke penggajian; SANSU tidak menghitungnya otomatis.
- Daftar harga/promo berlaku pada pesanan penjualan Rupiah (termasuk kanvas dan konsinyasi); kasir (POS) dan pesanan valas belum memakainya.
