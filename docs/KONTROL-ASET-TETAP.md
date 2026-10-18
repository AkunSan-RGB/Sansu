# Kontrol aset tetap & metode penyusutan

**Metode penyusutan komersial** (Kategori aset dan kartu aset): Garis lurus, Saldo menurun ganda (2×), **Saldo menurun 1,5×** (baru), **Jumlah angka tahun** (baru), Tidak disusutkan (tanah). Saldo menurun beralih ke garis lurus bila lebih besar; semua metode habis tepat di akhir masa manfaat dan tidak melewati nilai residu. Penyusutan **fiskal** tetap hanya garis lurus/saldo menurun sesuai Pasal 11 UU PPh (tidak terpengaruh). Metode unit produksi belum ada (butuh catatan pemakaian per periode).

**Pengaman baru**
- Banner **"Pengaman belum aktif"** di halaman Aset tetap bila batas persetujuan pelepasan aset masih 0; tombol *Terapkan rekomendasi* (≥ Rp5 juta) untuk Pemilik/Admin.
- **Pemilik diberi tahu** (Telegram/email) bila aset berharga perolehan ≥ Rp5 juta dilepas oleh selain Pemilik; jejak audit pelepasan kini memuat harga perolehan, nilai buku, dan harga lepas.
- Temuan `DISPOSE_QUICK` (dilepas ≤ 90 hari setelah dibeli) dan `DISPOSE_LOW_PRICE` (harga lepas < 50% nilai buku bernilai ≥ Rp1 juta, termasuk nol) untuk pelepasan 180 hari terakhir.
- **Jejak audit** perubahan nama/penanggung jawab/lokasi/catatan aset dan perubahan kategori aset (dari → ke).

**Belum dikerjakan**: deteksi pembelian aset yang dipecah di bawah batas kapitalisasi (barang kecil langsung menjadi beban tanpa penanda aset); pemeriksa fisik yang harus berbeda dari penanggung jawab (penanggung jawab disimpan sebagai teks bebas, bukan pengguna).

## Ubah metode penyusutan (berlaku ke depan)

- **Satu aset**: kartu aset › *Ubah metode penyusutan*. **Satu kategori**: Kategori aset › *Ubah metode semua aset* (semua aset aktif di kategori itu + menjadi metode bawaan aset baru).
- **Tidak pernah berlaku mundur**: bulan berlaku harus sesudah bulan yang sudah diposting. Penyusutan sampai bulan sebelum bulan berlaku diposting dulu dengan metode lama; mulai bulan berlaku, sisa nilai buku (dikurangi residu) disusutkan dengan metode baru selama sisa masa manfaat. Jurnal lama tidak berubah; total tetap habis tepat di akhir masa manfaat.
- Alasan wajib. Staf (Akuntan) menunggu persetujuan Pemilik/Admin; Pemilik diberi tahu bila diubah orang lain; tercatat di jejak audit (dari → ke, bulan berlaku, akumulasi, nilai buku).
- **Pratinjau** 12 bulan (metode sekarang vs baru) sebelum menyimpan. Jadwal penyusutan, estimasi bulanan, temuan "penyusutan tertinggal", dan penyusutan otomatis bulanan otomatis memakai metode baru.
- Mengubah metode di form kategori **tidak** mengubah aset lama (hanya aset baru); gunakan *Ubah metode semua aset*.
- Batas: tidak bisa diubah ke/dari "tidak disusutkan" (tanah); penyusutan fiskal tidak terpengaruh.

## Metode unit produksi & hubungan dengan penyusutan fiskal

**Unit produksi** (baru): penyusutan bulan itu = (harga perolehan − residu) × pemakaian bulan itu ÷ kapasitas total. Aset menyimpan **total unit** dan satuannya (km, jam, ...) — wajib diisi saat mendaftarkan aset dengan metode ini. Pemakaian dicatat per bulan di kartu aset (panel *Pemakaian*; Admin/Akuntan, tercatat di jejak audit). Aturan:
- Bulan tanpa catatan pemakaian tidak disusutkan; temuan `USAGE_MISSING` muncul bila pemakaian bulan lalu belum diisi.
- Pemakaian bulan yang sudah disusutkan tidak bisa diubah/ditambah; total pemakaian tidak boleh melebihi kapasitas; bulan depan belum bisa dicatat.
- Penyusutan tidak melewati nilai residu; tidak dibatasi umur (mengikuti pemakaian).
- Tidak bisa dipindah dari/ke metode lain pada aset yang sudah berjalan, dan tidak bisa diterapkan lewat "Ubah metode semua aset" (butuh total unit per aset). 

**Penyusutan fiskal** sengaja tidak mengikuti metode komersial: Pasal 11 UU PPh menetapkan metode fiskal per kelompok harta (garis lurus/saldo menurun per kategori). Yang otomatis ikut adalah **koreksi fiskal**: selisih penyusutan komersial (dari jurnal yang diposting) vs fiskal di Rekonsiliasi Fiskal, beda temporer, dan pajak tangguhan dihitung ulang dari penyusutan komersial terbaru, sehingga mengganti metode komersial langsung terlihat di koreksi fiskal. Metode fiskal tidak diubah lewat fitur ini (perubahan metode fiskal menurut aturan pajak perlu ketentuan tersendiri).

## Pembelian aset besar & pembelian dipecah di bawah batas kapitalisasi

- **Pemilik diberi tahu** (Telegram/email) bila aset berharga perolehan ≥ Rp5 juta didaftarkan atau dibeli oleh selain Pemilik, lewat semua jalur: Aset baru, faktur pembelian (baris aset, per baris), kas keluar (baris aset), dan pendaftaran dari jurnal. Impor massal tidak memberi tahu.
- Temuan **`ASSET_SPLIT`**: dua baris atau lebih pada pemasok yang sama dalam 14 hari, masing-masing 70–100% dari batas kapitalisasi (di bawahnya, jadi dibebankan sebagai "Beban Peralatan Kecil"), dengan jumlah ≥ batas. Bisa wajar (banyak barang kecil); tandanya pembelian aset yang dipecah agar tidak dikapitalisasi. Hanya berlaku bila batas kapitalisasi diisi (> 0).
- Batas: deteksi memakai nilai baris (bukan per unit) dan hanya melihat faktur pembelian; barang kecil yang dibayar kas langsung ditolak sistem (harus dicatat sebagai beban), jadi tidak masuk deteksi ini.

## Unit produksi di semua jalur pendaftaran

Kategori bermetode unit produksi kini bisa dipakai di semua jalur, asalkan **total unit** (dan satuan) diisi di jalur itu; tanpa itu pendaftaran ditolak dengan pesan jelas:
- **Faktur pembelian**: baris aset memunculkan kolom *Total unit per aset* dan *Satuan*; bila jumlah > 1 (satu aset per unit), tiap aset mewarisi kapasitas yang sama.
- **Kas keluar** ke akun aset: kolom *Total unit* dan *Satuan* pada baris aset.
- **Daftar dari jurnal** (pembelian yang belum jadi kartu): isian *Total unit* dan *Satuan* di jendela pendaftaran.
- **Impor aset lama**: kolom `total_unit` (wajib untuk kategori itu) dan `satuan_unit` di templat; baris tanpa total unit ditolak.
Untuk aset lama (impor/jurnal) yang sudah punya akumulasi penyusutan, isi total unit dengan **kapasitas penuh** aset; penyusutan tidak melewati sisa nilai, tetapi "sisa unit" di panel pemakaian hanya menghitung pemakaian yang dicatat di SANSU.
