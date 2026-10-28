# Celah vertikal Jasa, Ritel, Manufaktur: yang dibangun dan batasnya

Dokumen ini mencatat apa yang ditambahkan untuk menutup celah tiga jenis usaha, cara kerjanya, dan yang **belum** dikerjakan.
Semua fitur memakai lapisan yang sudah ada (controller → service → repository), migrasi maju-saja (0116–0121), dan dicakup tes.

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
- **Satu tagihan untuk beberapa perintah**: saat menautkan, isi jumlah alokasi (kosong = seluruh sisa tagihan). Jumlah alokasi semua perintah tidak boleh melebihi DPP tagihan (baris tagihan dikunci saat menautkan); upah langsung tiap perintah = alokasinya.
- **Bahan di tangan maklon**: `GET /production/subcontract/holdings` dan kartu di halaman Perintah produksi menampilkan bahan yang sudah dikeluarkan untuk perintah maklon yang masih berjalan, per pemasok, beserta nilainya. Ini **turunan dari perintah produksi** (nilainya tetap di Barang dalam Proses), bukan gudang fisik terpisah; belum ada pencatatan bahan kembali sebagian atau sisa bahan dari maklon.
- **Pembayaran bertahap**: tagihan maklon adalah tagihan biasa, jadi dibayar sebagian lewat pembayaran pemasok yang sudah ada; tidak ada jadwal termin khusus maklon.

## Jasa

### Anggaran biaya proyek
- `projects.cost_budget` (0 = tanpa anggaran). Status pemakaian dihitung dari biaya langsung proyek yang sudah ada (tagihan biaya, kas keluar, jurnal, gaji): **OK**, **WARN** mulai 80%, **OVER** di atas 100% (`service-limits.ts`, diuji).
- Tampil di detail proyek; bisa diatur saat membuat/mengubah proyek.
- **Kendali**: mengikuti *Kendali anggaran* di Persetujuan (OFF / Persetujuan / Blokir). Pada Blokir, Tagihan biaya dan Kas keluar bertanda proyek yang membuat biaya langsung melewati anggaran ditolak (Pemilik dapat menembus dengan alasan, tercatat di audit); pada Persetujuan, staf menunggu persetujuan. Pada OFF hanya pemantauan. **Jurnal umum manual bertanda proyek tidak diperiksa.**

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
- **Promo bonus barang di kasir**: kutipan menampilkan barang gratis; saat transaksi server menambah baris harga 0 (`pos_order_lines.is_bonus`), stok terpotong dan biayanya masuk HPP. Bonus hanya untuk barang stok biasa (bukan menu/setengah jadi) dan dibatasi sisa stok toko setelah barang yang dibeli; klien tidak mengirim baris bonus.
- **Belum ada, dengan alasan**: mode luring kasir (butuh rancangan tanggal transaksi, harga yang berubah, dan stok saat sinkron; tidak ditambal setengah-setengah); pengelolaan perangkat keras kasir (printer, laci kas, EDC) yang memerlukan lapisan aplikasi/peranti yang tidak dapat diverifikasi di sini. Cetak struk lewat peramban tetap seperti sebelumnya.

### Uji beban kasir
`backend/scripts/uji-beban-serentak.mjs --ritel N` menambah N perusahaan ritel (3 kasir tiap perusahaan, harga toko + promo aktif). Setelah beban diperiksa: stok = awal − terjual, jumlah transaksi kasir = yang berhasil, total transaksi = pembayarannya, jurnal seimbang.
Satu uji singkat (30 pengguna maya, 30 detik, 2 perusahaan dagang + 2 ritel) lulus semua pemeriksaan tanpa galat 5xx; angka itu **bukan** klaim kapasitas produksi.

## Yang sengaja tidak dikerjakan
Retur ke pemasok, transfer antar toko, dan saran pemesanan ulang sudah ada sebelumnya; persetujuan batas jam/tarif timesheet sudah ada sebagian. Tidak diubah di sini.
