# Celah vertikal Jasa, Ritel, Manufaktur: yang dibangun dan batasnya

Dokumen ini mencatat apa yang ditambahkan untuk menutup celah tiga jenis usaha, cara kerjanya, dan yang **belum** dikerjakan.
Semua fitur memakai lapisan yang sudah ada (controller → service → repository), migrasi maju-saja (0116–0119), dan dicakup tes.

## Manufaktur

### Versi resep (BOM)
- `boms.version` naik 1 hanya bila isi resep benar-benar berubah (nama, produk jadi, hasil per batch, upah, overhead, catatan, status aktif, bahan, takaran). Simpan tanpa perubahan tidak menaikkan versi (`bom-revision.ts`, murni dan diuji).
- Versi yang digantikan disimpan utuh di `bom_revisions` (snapshot JSON) bersama alasan perubahan (`changeReason`, opsional).
- `GET /production/boms/:id/revisions` mengembalikan riwayat (terbaru dulu) dengan daftar perubahan menuju versi berikutnya.
- Perintah produksi mencatat `bom_version` saat dibuat. Perintah lama (sebelum fitur ini) berversi kosong.
- Halaman Resep: kolom versi, isian alasan perubahan, dan riwayat di laci resep.

### Subkontrak (maklon)
- Perintah produksi dapat menunjuk pemasok jasa (`subcontractorId`). Bahan tetap dikeluarkan ke Barang dalam Proses seperti biasa.
- Upah langsung **bukan diketik**: Keuangan mencatat Tagihan biaya dari pemasok itu (PPN dan PPh 23 ikut aturan pembelian biasa) dengan seluruh baris ke akun *Upah Langsung Produksi*, lalu menautkannya ke perintah (`POST /production/orders/:id/subcontract-bill`).
- Saat produksi selesai, DPP tagihan itu menjadi upah langsung yang dibebankan ke harga pokok barang jadi (akun upah yang didebit tagihan diimbangi *Biaya Produksi Dibebankan*, sama seperti upah dari penggajian).
- Pengendalian: tagihan harus dari pemasok maklon yang sama, berjenis Tagihan biaya, jurnal belum dibalik, belum dipakai perintah lain (indeks unik), semua baris ke akun upah langsung; produksi subkontrak tidak bisa selesai tanpa tagihan; tidak bisa dibatalkan setelah tagihan menempel; upah tidak dapat diketik.
- Perintah subkontrak tidak menyalin operasi pusat kerja internal dari resep.
- **Belum ada**: pelacakan stok yang berada di tangan maklon sebagai lokasi terpisah (bahan yang dikirim tetap tercatat di Barang dalam Proses, bukan gudang pemasok); pembayaran sebagian per tahap; satu tagihan untuk beberapa perintah.

## Jasa

### Anggaran biaya proyek
- `projects.cost_budget` (0 = tanpa anggaran). Status pemakaian dihitung dari biaya langsung proyek yang sudah ada (tagihan biaya, kas keluar, jurnal, gaji): **OK**, **WARN** mulai 80%, **OVER** di atas 100% (`service-limits.ts`, diuji).
- Tampil di detail proyek; bisa diatur saat membuat/mengubah proyek.
- **Sifatnya pemantauan, bukan pemblokir**: pencatatan biaya yang melewati anggaran tidak ditolak.

### Retainer berjatah jam
- `service_retainers.included_hours` + `overage_rate`. Saat menagih periode, sistem menghitung jam tertagih yang sudah **disetujui** pada bulan itu (proyek retainer bila ada, jika tidak seluruh pelanggan); kelebihan dari jatah ditambahkan di faktur dengan tarif kelebihan.
- Catatan waktu yang tercakup ditandai *BILLED* pada faktur retainer, jadi tidak dapat ditagih ulang lewat penagihan timesheet. Catatan yang masih draf/diajukan pada bulan itu menahan penagihan sampai diputuskan.
- Perubahan jatah/tarif hanya berlaku untuk periode yang belum ditagih.

## Ritel

### Daftar harga toko dan promo di kasir
- `warehouses.price_list_id`: toko (gudang) dapat memakai daftar harga. Pelanggan terdaftar yang punya daftar harga sendiri memakai miliknya.
- `POST /pos/quote` menghitung harga dan potongan promo diskon yang aktif dengan mesin harga yang sama dengan pesanan penjualan (`pricing-engine.ts`). Layar kasir menampilkan angka ini (nama promo di keranjang).
- Server memakai perhitungan yang sama saat transaksi: baris tanpa harga/diskon diisi server; **kasir/sales hanya boleh menjual dengan harga dan potongan persis hasil hitungan server** (aturan anti-fraud lama "harus harga master" diganti "harus harga yang berlaku"). Supervisor tetap boleh mengubah manual.
- Menu *Daftar harga* dan *Promo* kini muncul untuk Ritel.
- **Belum ada**: promo bonus barang di kasir (hanya potongan harga); stok minimum/harga yang berbeda per toko di luar daftar harga; pengelolaan perangkat kasir (printer, laci kas, EDC) dan mode luring.

### Uji beban kasir
`backend/scripts/uji-beban-serentak.mjs --ritel N` menambah N perusahaan ritel (3 kasir tiap perusahaan, harga toko + promo aktif). Setelah beban diperiksa: stok = awal − terjual, jumlah transaksi kasir = yang berhasil, total transaksi = pembayarannya, jurnal seimbang.
Satu uji singkat (30 pengguna maya, 30 detik, 2 perusahaan dagang + 2 ritel) lulus semua pemeriksaan tanpa galat 5xx; angka itu **bukan** klaim kapasitas produksi.

## Yang sengaja tidak dikerjakan
Retur ke pemasok, transfer antar toko, dan saran pemesanan ulang sudah ada sebelumnya; persetujuan batas jam/tarif timesheet sudah ada sebagian. Tidak diubah di sini.
