# Laporan pendukung

Menu **Akuntansi › Laporan › Laporan pendukung** (`/support-reports`; API `GET /accounting/support/:kind?from=&to=`, kind = `sales`, `purchases`, `inventory`, `cash`, `other`; Pemilik, Admin, Keuangan, Akuntan). Dipakai untuk mempertanggungjawabkan angka laporan keuangan: tiap laporan memuat **rincian dari dokumen/kartu pembantu** dan **pencocokan dengan buku besar** yang selisihnya ditampilkan apa adanya. Bisa diekspor ke Excel/CSV dan dicetak.

| Laporan | Isi | Pencocokan dengan buku besar |
|---|---|---|
| **Penjualan** | rekap per bulan (faktur, DPP, PPN, retur, HPP, laba kotor), per pelanggan, per produk, daftar faktur | (1) penjualan neto faktur − retur vs akun pendapatan pada jurnal faktur/retur; (2) sisa tagihan faktur vs saldo Piutang Usaha |
| **Pembelian** | rekap per bulan (DPP, PPN masukan, PPh dipotong, retur), per pemasok, daftar faktur | (1) total faktur vs kredit Utang Usaha pada jurnal faktur; (2) sisa tagihan vs saldo Utang Usaha |
| **Persediaan** | mutasi per produk (awal, masuk, keluar, akhir: jumlah dan nilai), per gudang | nilai kartu stok vs saldo akun Persediaan; vs saldo stok saat ini bila sampai hari ini |
| **Kas & Bank** | mutasi per akun, per sumber transaksi, kecocokan rekening koran terbaru | saldo akun kas/bank vs buku besar; tiap rekening koran vs saldo buku pada tanggal yang sama (+ jumlah mutasi belum cocok) |
| **Akun lainnya** | mutasi semua akun di luar yang di atas: aset lain, liabilitas, ekuitas, pendapatan/beban lain, saldo pajak | neraca saldo seimbang (debit = kredit) |

**Cara membaca selisih**: tiap kotak pencocokan menampilkan angka rincian, angka buku besar, dan kemungkinan penyebab selisih (mis. jurnal manual ke akun piutang/utang/persediaan, faktur valas, persediaan awal lewat jurnal, mutasi bank belum dicocokkan). Selisih bukan berarti salah otomatis, tetapi harus bisa dijelaskan sebelum laporan dipakai.

**Batas yang jujur**
- Piutang/utang yang dibandingkan hanya faktur rupiah; faktur valas tidak ikut dan dapat menimbulkan selisih.
- Penjualan lewat kasir (POS), jasa, dan pendapatan lain tidak punya rincian per dokumen di laporan Penjualan ini; bila ada jurnalnya di akun pendapatan faktur, mereka tampil sebagai selisih pencocokan.
- Daftar dipotong 100 teratas (pelanggan/pemasok/produk) dan 500 faktur pertama per periode.
- Daftar umur piutang/utang dan daftar aset tetap tetap ada di Lampiran Laporan Keuangan.
- Laporan ini belum ditinjau akuntan eksternal; format dan batas toleransi (Rp1) dapat disesuaikan.
