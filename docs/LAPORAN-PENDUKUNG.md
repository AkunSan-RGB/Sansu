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

Piutang usaha dan piutang lain dipisahkan: akun Piutang Usaha hanya berisi piutang dari faktur (jurnal manual ke akun itu ditolak), sehingga Laporan utilitas mencocokkan sisa semua faktur dengan akun tersebut dan memisahkan tagihan utilitas dari faktur lain. Piutang lain (karyawan, platform, klaim prinsipal, retensi, antar cabang, dan akun piutang lain) dilaporkan sendiri di Laporan akun lainnya, bagian "Piutang lain-lain", terpisah dari aset lain.

Batasan Jasa dan Utilitas: jam kerja dan upah jasa tidak masuk laporan ini (ada di Upah jasa); piutang valas ikut pencocokan piutang usaha pada nilai rupiah tercatat.

## Alur surat jalan dan penerimaan barang (Dagang dan jenis usaha yang membeli/menjual barang)

- **Laporan penjualan**: bagian P5 umur piutang usaha per pelanggan (belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari; rupiah) dan P6 surat jalan belum difaktur beserta nilai HPP. Barang yang sudah keluar tetapi belum ditagih sudah menanggung HPP, tetapi pendapatannya belum diakui.
- **Laporan pembelian**: bagian P4 umur utang usaha per pemasok, P5 barang diterima belum ditagih, dan pencocokan baru "Barang diterima belum ditagih vs akun GRNI" (penerimaan − yang sudah ditagih vs saldo akun Barang Diterima Belum Ditagih).

Batasan: pencocokan GRNI dan daftar penerimaan dibandingkan per hari ini karena status penagihan penerimaan tidak menyimpan riwayat; surat jalan belum difaktur tidak punya akun buku besar sendiri sehingga hanya berupa daftar, bukan pencocokan.

## Penanganan batasan (pembaruan)

| Batasan sebelumnya | Sekarang |
|---|---|
| Piutang/utang valas tidak ikut pencocokan dan umur | Ikut, memakai nilai rupiah tercatat (piutang/utang usaha dibawa pada kurs faktur; penilaian ulang kurs memakai akun terpisah) |
| Pendapatan kasir/jasa/lain tanpa rincian di laporan penjualan | Bagian P7 menampilkan pendapatan menurut sumber jurnal dengan pencocokan ke seluruh akun pendapatan |
| Daftar dipotong 100/300/500 baris | Tabel "teratas" menggabungkan sisanya jadi satu baris Lainnya sehingga jumlah tetap lengkap; tabel lain memuat sampai 2.000 baris dan diberi catatan bila terpotong |
| Pencocokan komisi dan klaim prinsipal hanya per hari ini | Dihitung per tanggal akhir dari tanggal jurnal (termasuk pembalikan dan pembayaran) |
| Bahan terpakai F&B memakai resep saat ini; retur tidak dikurangkan | Memakai resep yang berlaku saat pesanan dibuat; retur memang tidak mengembalikan bahan (sudah diolah), jadi tidak dikurangkan |
| Konsinyasi tanpa nilai rupiah | Menampilkan nilai pada harga pokok rata-rata |
| Barang setengah jadi tidak diuraikan | Kolom Induk pada perintah produksi selesai |
| Jam kerja/upah jasa tidak masuk | Bagian J4 (menunggu persetujuan, disetujui belum digaji, sudah digaji) |
| Surat jalan belum difaktur tanpa pencocokan | Pencocokan baru HPP surat jalan vs akun HPP; daftar belum difaktur tetap berupa daftar karena tidak ada akun tersendiri |

Batasan yang masih ada:
- Pencocokan "barang diterima belum ditagih" (GRNI) dan "rebate outlet belum dilunasi" dibandingkan per hari ini: penagihan penerimaan dan pelunasan rebate hanya menyimpan angka kumulatif, bukan riwayat per tanggal. Menghitungnya per tanggal memerlukan tabel riwayat baru.
- Laporan ini belum ditinjau akuntan eksternal.

## Kesimpulan dan saran otomatis

Setiap laporan pendukung ditutup dengan bagian **Kesimpulan dan saran** di bagian paling bawah, setelah seluruh tabel: satu kalimat ringkasan (berapa pencocokan buku besar cocok, berapa temuan kritis/perlu perhatian) diikuti uraian bernomor dalam paragraf, dikelompokkan menjadi "Perlu ditindaklanjuti" (kritis dan perhatian), "Catatan", dan "Kondisi baik". Tiap uraian berisi temuan, keterangan dengan angka, dan saran tindak lanjut.

Semuanya dihitung otomatis dari angka yang tersaji pada laporan itu sendiri dengan aturan tetap (`backend/src/modules/insights/support-insights.ts`), tanpa data tambahan dan tanpa AI. Bagian ini ikut tercetak dan diekspor ke Excel (bagian terakhir lembar laporan).

| Laporan | Contoh aturan |
|---|---|
| Semua | Selisih pencocokan buku besar = kritis (selisih biaya konversi produksi hanya info) |
| Penjualan | Piutang lewat 90 hari ≥ 20% (perhatian) / ≥ 40% (kritis), konsentrasi piutang/penjualan, margin kotor tipis atau negatif, retur ≥ 5%, surat jalan belum difaktur > 14 hari, pendapatan dari jurnal manual |
| Pembelian | Utang lewat 90 hari, konsentrasi pemasok, retur ≥ 5%, barang diterima belum ditagih > 30 hari |
| Persediaan | Saldo stok negatif, stok tidak bergerak |
| Kas & bank | Saldo kas negatif, rekening koran berselisih/belum cocok/belum diimpor |
| Akun lainnya | Saldo tidak sesuai sifat akun, ekuitas negatif, piutang lain |
| Kasir | Selisih uang laci (kurang/lebih, % dari penjualan), selisih berulang pada satu kasir, sesi terbuka lama, retur kasir ≥ 3% |
| F&B | Bahan menyimpang > 5% dari resep, pesanan online belum cair, selisih pencairan platform |
| FMCG | Capaian di bawah target, uang kanvas di tangan sales/kurang setor/ditolak, klaim prinsipal tertahan atau ditolak, rebate belum dilunasi, tukar-guling ≥ 2% penjualan |
| Produksi | Rendemen < 90%, bahan melebihi resep, barang dalam proses > 30/60 hari |
| Jasa | Proyek tanpa catatan kemajuan, ditagih melebihi kontrak, pekerjaan lebih cepat dari tagihan, uang muka belum terpakai, upah menunggu persetujuan |
| Utilitas | Catatan meter janggal ≥ 10%, tingkat pembayaran < 70%, tunggakan > 90 hari |

Batasan: ambang di atas bersifat umum dan belum dapat diubah per perusahaan; kesimpulan membantu menemukan hal yang perlu diperiksa, bukan pengganti pertimbangan akuntan.

### Ambang dapat diatur per perusahaan

Ambang kesimpulan di atas (mis. 20% piutang lewat 90 hari, retur 5%, surat jalan 14 hari) dapat diubah di **Pengaturan perusahaan › Pelaporan & PPh › Ambang kesimpulan laporan pendukung**. Perubahan berlaku langsung di semua laporan perusahaan itu. Pemilik, Admin, dan Akuntan dapat mengubah; Keuangan hanya melihat. Setiap ambang dibatasi rentang yang wajar (mis. persen 0,1–100, hari 1–365), batas kritis tidak boleh lebih kecil dari batas perhatian, dan tombol "Kembalikan semua ke standar" tersedia. Tersimpan di pengaturan perusahaan (`supportInsights`), terisolasi antar perusahaan.
