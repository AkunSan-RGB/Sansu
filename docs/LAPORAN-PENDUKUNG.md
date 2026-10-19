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

## Letak di menu

Setiap laporan ada di menu bidangnya, tepat di atas menu kontrolnya: Penjualan › Laporan penjualan (di atas Kontrol penjualan), Pembelian › Laporan pembelian, Inventori › Laporan persediaan, Kas & Bank › Laporan kas & bank, Akuntansi › Laporan akun lainnya. Halaman Akuntansi › Laporan pendukung (semua) tetap ada sebagai ringkasan semua tab. Peran yang boleh membuka: Pemilik, Admin, Keuangan, Akuntan.

## Laporan khusus jenis usaha

| Laporan | Untuk | Isi | Pencocokan buku besar |
|---|---|---|---|
| Kasir (Kasir (POS) › Laporan kasir) | Ritel, F&B | Penjualan per kasir, per metode bayar, per sesi (uang seharusnya, dihitung, selisih) | Penjualan neto vs akun pendapatan; pembayaran vs total pesanan; pembayaran tunai/non-tunai vs debit laci kas & rekening; selisih sesi vs akun Selisih Kas Kasir |
| F&B (Kasir (POS) › Laporan F&B) | F&B | Penjualan per menu dan jenis pesanan, pajak (PB1/PBJT atau PPN), pesanan online per kanal dan pencairan, bahan terpakai vs resep | Pajak daerah vs akun pajak daerah; pesanan online belum cair vs Piutang Platform; HPP pesanan vs akun HPP; jumlah bahan yang pemakaiannya sama dengan resep |

Batasan: bahan terpakai dihitung dengan resep aktif saat laporan dibuka (resep yang diubah setelah penjualan menimbulkan selisih), dan retur kasir tidak dikurangkan dari pemakaian bahan. Jenis usaha lain (Jasa, FMCG, Manufaktur, Utilitas) belum punya laporan khusus.

### FMCG (Penjualan › Laporan FMCG)

Isi: penjualan per sales, target dan komisi, pemakaian promo dan klaim prinsipal, rebate/trade promo outlet, tukar-guling, sisa titipan konsinyasi, dan setoran tagihan kanvas per sales.

Pencocokan buku besar: komisi ditutup pada periode vs beban komisi; komisi belum dibayar vs utang komisi; sisa rebate outlet vs utang rebate; klaim disetujui belum cair vs piutang prinsipal; biaya tukar-guling vs akun kerugian; kurang setor kanvas vs piutang karyawan.

Batasan: pencocokan saldo (utang komisi, utang rebate, piutang klaim) dibandingkan per hari ini karena status dokumen tidak menyimpan riwayat; sisa titipan konsinyasi memakai saldo stok gudang konsinyasi tanpa nilai rupiah.

### Manufaktur (Produksi › Laporan produksi)

Isi: perintah produksi selesai (rencana, hasil, rendemen, bahan, upah, overhead, biaya per unit), pemakaian bahan vs resep per bahan (jumlah dan nilai), dan barang dalam proses per tanggal akhir beserta umurnya.

Pencocokan buku besar: bahan masuk produksi vs debit Barang Dalam Proses; biaya perintah selesai vs jurnal selesai; perintah berjalan vs saldo Barang Dalam Proses; biaya konversi dibebankan vs upah dan overhead aktual. Yang terakhir selisihnya wajar (selisih biaya produksi, dianalisis di Analisis selisih), bukan kesalahan pembukuan.

Batasan: pemakaian bahan memakai kebutuhan resep yang tersimpan pada perintah; barang setengah jadi berjenjang tidak diuraikan per tingkat.

### Jasa (Penjualan › Laporan jasa & proyek)

Isi: proyek (kontrak, % selesai, pendapatan diakui, ditagih, sisa kontrak, aset/liabilitas kontrak), faktur termin, dan uang muka pelanggan (diterima, dipakai, sisa).

Pencocokan buku besar: faktur proyek vs akun pendapatan; kemajuan pekerjaan vs Pendapatan Belum Ditagih/Diterima Dimuka; uang muka vs saldo Uang Muka Pelanggan.

### Utilitas (Utilitas › Laporan utilitas)

Isi: pencatatan meter per periode (dicatat, terverifikasi, ditagih, ditolak, ditandai), tagihan per periode, tunggakan per tanggal akhir, dan sambungan per tarif.

Pencocokan buku besar: tagihan vs akun pendapatan; pemakaian pada catatan meter vs pemakaian pada tagihan; denda ditagih vs akun pendapatan denda.

Batasan Jasa dan Utilitas: jam kerja dan upah jasa tidak masuk laporan ini (ada di Upah jasa); piutang utilitas tidak dicocokkan dengan akun piutang karena akun itu dapat memuat piutang lain.
