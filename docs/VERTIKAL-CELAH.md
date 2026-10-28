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

### Jasa untuk jenis perusahaan jasa lain
Jenis usaha Jasa semula paling cocok untuk konsultan/agensi (proyek, timesheet, retainer). Empat tambahan membuat jenis lain dapat memakainya. Semuanya memakai faktur jasa yang sama (piutang pembantu = buku besar).

**Kasir & katalog layanan** (bengkel, salon, klinik non-medis): `products.is_service` (layanan tanpa stok), kasir untuk Jasa, petugas per baris (`pos_order_lines.staff_id`) dan laporan kinerja petugas. Layanan tidak boleh masuk dokumen barang. Bahan habis pakai opsional lewat resep (dipotong saat dijual).

**Kontraktor** (`0123`): retensi per proyek (`retention_pct`, `retention_days`). Termin proyek beretensi otomatis dipecah satu transaksi menjadi faktur jalan (100−r%) dan **faktur retensi** terpisah (`retention_of_invoice_id`) yang jatuh tempo setelah masa pemeliharaan. Keduanya faktur biasa sehingga umur piutang dan pembayaran bekerja apa adanya; pendapatan/PPN tetap diakui saat termin. Pencairan = memajukan jatuh tempo faktur retensi (Admin/Keuangan, alasan tercatat). BoQ/RAB (`project_boq_items`): item, volume, harga satuan; volume selesai kumulatif per item (tidak boleh turun/melebihi volume) menghitung persentase kemajuan dari nilai item lalu dicatat lewat alur kemajuan yang sudah ada.
- **Belum ada**: kemajuan subkontraktor, addendum nilai kontrak berversi, jaminan pelaksanaan/bank garansi, pemecahan retensi pada faktur selain termin proyek.

**Pendidikan/kursus** (`0124`): kelas (kode, SPP, kuota), peserta terdaftar yang ditagih ke wali, SPP bulanan: satu faktur per wali dengan satu baris per peserta (`edu_fee_invoices` unik per peserta-periode, jadi tidak bisa ditagih dua kali walau serentak). Diskon saudara/beasiswa per peserta; peserta keluar berhenti ditagih mulai bulan berikutnya.
- **Belum ada**: prorata bulan masuk/keluar (bulan itu ditagih penuh), uang pangkal/registrasi sebagai komponen terpisah, absensi/nilai/rapor, portal wali, pembayaran SPP tahunan dimuka (pendapatan ditangguhkan).

**Kontrak per lokasi** (kebersihan/keamanan/alih daya, `0125`): kontrak per lokasi dengan pos (jumlah petugas × tarif), jadwal jaga harian (satu petugas satu pos per hari, di dalam masa kontrak), cakupan per hari, dan tagihan bulanan satu faktur per kontrak (satu baris per pos). Bila dipilih, tagihan dipotong sebesar kekurangan petugas (hari-orang ÷ hari dalam bulan) dan jumlah kekurangan tercatat di kontrak.
- **Belum ada**: absensi nyata petugas (jadwal = rencana, bukan kehadiran), penggantian shift/lembur, tagihan per jam/penjagaan khusus, penggajian otomatis dari jadwal jaga.

**Sengaja tidak dipaksakan**: klinik dengan rekam medis (data kesehatan memerlukan persetujuan, retensi, dan kontrol akses tersendiri) dan jasa keuangan (kewajiban regulator yang berbeda). Untuk jenis ini sistem hanya cocok sebagai pembukuan jasa biasa.

### Profil layanan (menu Jasa mengikuti jenis pekerjaan)
Karena Jasa kini melayani banyak jenis pekerjaan, perusahaan Jasa memilih satu atau lebih **profil layanan** di Pengaturan › Jenis usaha: Konsultan/agensi, Kontraktor, Pendidikan, Alih daya per lokasi, Bengkel/salon/kasir. Disimpan di pengaturan perusahaan (`serviceProfiles`), dibaca lewat `/auth/me` dan `GET/PUT /settings/business/service-profiles` (hanya Admin, hanya jenis usaha Jasa).
- **Hanya tampilan**: menu (`profiles` pada item/grup di `menuData.tsx`), Ruang kerja (tautan ikut tersaring), dan artikel bantuan. Backend tidak memblokir fitur profil lain, akun/pajak/SDM tidak berbeda per profil, dan data profil yang tidak dicentang tidak hilang.
- **Bawaan**: perusahaan Jasa baru = Konsultan; perusahaan lama yang belum memilih = semua profil (menu tidak tiba-tiba hilang); demo Jasa = semua profil.
- **Menu Persediaan Jasa** disederhanakan: Katalog jasa & bahan, Stok bahan, Hitung stok bahan, laporan. Lokasi bahan, Persediaan per lokasi, dan Transfer antar lokasi disembunyikan untuk Jasa (halamannya masih dapat dibuka lewat alamat langsung). Grup Persediaan hanya tampil untuk profil Kontraktor, Alih daya, Bengkel; Kasir layanan hanya untuk Bengkel.
- **Tidak berubah**: SDM (Karyawan, Cuti, Upah jasa) dan Pajak tampil sama untuk semua profil Jasa.

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
