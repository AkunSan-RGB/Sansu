# Menu bertahap dan laporan per bagian

## Aturan susunan
- Menu atas: **Dashboard → Cek kesehatan → Tugas saya**. Cek kesehatan berdiri sendiri (bukan di dalam Akuntansi).
- Di dalam tiap bagian, submenu dibagi tiga judul kecil yang berurutan: **Persiapan** (data induk dan aturan) → **Proses** (langkah kerja dari awal sampai akhir) → **Laporan & kontrol**. Akuntansi memakai Persiapan → Pencatatan → Laporan → Akhir periode.
- Urutan bagian mengikuti alur utama jenis usaha (`GROUP_ORDER` di `frontend/src/layout/menuData.tsx`):

| Jenis usaha | Urutan bagian usaha |
|---|---|
| Dagang, FMCG | Penjualan (CRM → Penjualan → Kasir) → Pembelian → Persediaan |
| Ritel | Penjualan (**Kasir** → Penjualan → CRM) → Pembelian → Persediaan |
| F&B | Penjualan (**Kasir** → …) → Pembelian bahan → Persediaan bahan → Produksi |
| Manufaktur | Pembelian bahan → Persediaan pabrik → **Produksi** → Penjualan |
| Jasa | Pendapatan jasa (CRM → …) → Pembelian → Bahan habis pakai |
| Utilitas | **Layanan utilitas** → Penjualan/penagihan → Pembelian → Persediaan |

  Sesudahnya selalu: Kas & Bank → Akuntansi → Pajak → SDM → Administrasi.
- Langkah di bagian Penjualan: pesanan → (Jasa: proyek → jadwal → lembar waktu → retainer) → uang muka → surat jalan → rute → (FMCG: kanvas) → faktur → retur → (FMCG: tukar-guling, konsinyasi, modern trade). Pembelian: daftar belanja → permintaan beli → pesanan → penerimaan → faktur → retur.
- Pengaturan akses per peran tidak berubah; hanya nama, urutan, dan tempat menu. Alamat halaman lama tetap berlaku.

## Istilah Sales Order / Purchase Order per jenis usaha
| Jenis usaha | Sales Order | Purchase Order |
|---|---|---|
| Dagang, Ritel | Pesanan penjualan | Pesanan pembelian |
| FMCG | Pesanan outlet | Pesanan ke prinsipal |
| Manufaktur | Pesanan pelanggan | Pesanan bahan |
| F&B | Pesanan katering | Pesanan bahan |
| Jasa | Pesanan kerja | Pesanan pembelian |
| Utilitas | Pesanan pasang baru | Pesanan bahan |

Diterapkan lewat `shared/src/ui-terms.ts` pada menu, judul halaman, petunjuk halaman, dan pesan. Pesan galat dari server (backend) yang masih menulis "Purchase Order" belum dilokalkan.

## Laporan per bagian (`/laporan/<bagian>`)
Menu "Laporan <bagian>" membuka **laporan kerja bagian itu**, bukan laporan pendukung. Satu halaman per bagian: ringkasan angka di atas + tab rincian + rentang tanggal + ekspor Excel/CSV/cetak. Backend: `GET /api/dept-reports/<bagian>?from&to` (Admin, Keuangan, Akuntan; SDM juga HR; aplikasi terkait harus aktif; data per perusahaan).

| Bagian | Tab |
|---|---|
| Penjualan | Per periode · pelanggan · produk (laba kotor) · sales · umur piutang · faktur lewat jatuh tempo · retur · surat jalan belum difakturkan |
| Pembelian | Per periode · pemasok · produk · umur utang · selisih harga beli · pesanan belum diterima · penerimaan belum difakturkan |
| Persediaan | Nilai per gudang · per produk · perputaran · di bawah stok minimum · kedaluwarsa |
| Kas & Bank | Saldo per akun · arus per hari · menurut sumber · pencocokan bank |
| Kasir | Per periode · kasir · sesi (selisih laci) · metode bayar · produk terlaris · per jam · pencairan QRIS/kartu · retur |
| F&B | Per menu · jenis pesanan · pajak restoran · saluran online · bahan terpakai |
| FMCG | Per sales · outlet · komisi · bonus per promo · klaim prinsipal · setoran kanvas · tukar-guling · konsinyasi · umur piutang |
| Produksi | Biaya per produk · hasil per perintah (rendemen) · perintah menggantung · pemakaian pusat kerja · tingkat gagal QC |
| Jasa & proyek | Proyek · jam belum ditagih · utilisasi · retainer · tagihan per periode · uang muka klien · umur piutang |
| Utilitas | Sambungan per status · tagihan per periode · tunggakan · pemakaian per tarif · temuan pencatatan meter |
| SDM | Karyawan per bagian · status · absensi · cuti · penggajian · rekap PPh 21/BPJS |

Berbeda dari usulan awal: laporan FMCG tetap menu sendiri di samping Laporan penjualan; "Harga pokok produksi" dan "Analisis selisih" tetap menu di Produksi (halaman rincian standar); "Perputaran persediaan" kini tab di Laporan persediaan (halamannya masih ada); Laporan utilitas kini memuat kehilangan per zona (lihat bawah); Laporan F&B memuat bahan terpakai dan bagian "Selisih bahan vs resep".

## Laporan pendukung dan Cek kesehatan
- **Laporan pendukung** kini hanya satu menu di Akuntansi › Laporan (tepat sesudah Laporan keuangan). Tab per bidang ada di dalam halamannya; "Laporan akun lainnya" menjadi tab. Tiap halaman Laporan bagian punya tautan ke tab pendukung yang sesuai.
- **Cek kesehatan** menjadi menu mandiri di bawah Dashboard untuk Pemilik, Admin, Keuangan, dan Akuntan.

## Lanjutan: zona utilitas, selisih bahan F&B, istilah
- **Kehilangan per zona (Utilitas)**: sambungan diberi *zona* (mis. Zona A). Admin/Keuangan mengisi *pasokan* tiap zona per bulan (angka meter induk/sumber) di tab "Zona & kehilangan". Kehilangan = pasokan − pemakaian terverifikasi/tertagih; di atas 20% ditandai tinggi, pemakaian melebihi pasokan ditandai janggal, dan zona dengan catatan belum terverifikasi/belum dicatat ditandai belum lengkap. Zona dengan satuan layanan berbeda ditolak. Muncul di Laporan utilitas dan tab Kontrol; perubahan pasokan masuk jejak audit. Pencatat meter tidak bisa mengisi pasokan (pemisahan tugas).
- **Selisih bahan vs resep (F&B)**: Laporan F&B membandingkan bahan yang seharusnya terpakai menurut resep dan penjualan menu dengan bahan yang benar-benar keluar lewat kasir, plus susut (penyesuaian keluar).
- **Istilah**: satu-satunya teks server yang masih memuat "Purchase Order" (saran stok) kini "pesanan pembelian".
