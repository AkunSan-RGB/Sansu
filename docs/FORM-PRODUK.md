# Form produk per jenis usaha

Semua isian **pilihan** di form produk dipilih dari daftar — tidak ada ketik bebas — supaya data seragam di laporan, filter,
stock opname, kasir, dan impor, dan tidak terpecah oleh salah ketik ("PCS"/"pcs"/"Pcs", "Minuman"/"minuman").

| Isian | Cara mengisi |
|---|---|
| Kategori | Pilih dari daftar: bawaan jenis usaha + tambahan Admin + kategori yang sudah dipakai produk. Kategori baru ditambahkan Admin di **Kelola kategori → Tambah kategori** (bukan di form produk) |
| Satuan dasar | Pilih dari katalog satuan (≈ 75 satuan baku: PCS, SACHET, BOTOL, KG, LITER, JAM, SESI, PAKET, …) |
| Satuan bertingkat | Pilih satuan (DUS, KARTON, RENTENG, …) lalu isi angka isi per satuan; satuan yang sama dengan satuan dasar atau ganda tidak bisa dipilih |
| Bidang lain | Nama, SKU, barcode, harga = data (diketik/scan), bukan pilihan |

## Bidang yang tampil menurut jenis usaha
| Jenis usaha | Barcode | Satuan besar | Menu (dibuat saat dipesan) | Setengah jadi | Umur simpan | Catatan |
|---|---|---|---|---|---|---|
| Dagang | ya | ya | — | — | — | |
| Ritel | ya | ya | — | — | — | satuan jual; renteng/dus untuk pembelian |
| Jasa | — | ya (mis. 1 HARI = 8 JAM) | — | — | — | label "Satuan tarif", "Tarif per satuan"; kode layanan/bahan |
| **FMCG** | ya | ya (renteng, pak, dus, karton, krat, bal, palet) | — | — | — | label SKU kode prinsipal; harga standar (harga segmen di Daftar harga); stok per lot & kedaluwarsa |
| Manufaktur | ya | ya | — | ya | ya | peran produk dari resep |
| F&B | ya | ya | ya | ya | ya | satuan PORSI/GELAS untuk menu |

Kategori bawaan tiap jenis usaha ada di `shared/src/product-form.ts` (mis. FMCG: Mi & Pasta, Makanan Kemasan, Camilan & Biskuit,
Minuman Kemasan, Kopi/Teh/Sirup, Susu & Bayi, Bumbu & Penyedap, Minyak & Sembako, Perawatan Diri, Kebersihan Rumah Tangga,
Obat Bebas & Suplemen, Produk Beku & Dingin, Rokok & Tembakau, Lain-lain).

## Validasi di server (bukan hanya tampilan)
- Kategori di luar daftar ditolak; ejaan disamakan dengan ejaan di daftar.
- Satuan di luar katalog ditolak (mis. "GR" → pilih GRAM, "BTL" → BOTOL, "LTR" → LITER).
- Menu hanya F&B; umur simpan hanya Manufaktur/F&B; barcode tidak untuk Jasa; satuan bertingkat tersedia untuk semua kecuali yang tidak memakainya.
- **Data lama tidak rusak**: kategori dan satuan yang sudah dipakai produk tetap muncul di pilihan dan boleh dipakai; produk lama bisa diedit tanpa mengganti keduanya.

## Batasan
- Impor Excel dan data demo tidak diblokir oleh daftar ini (kategori/satuan dari berkas tetap diterima, lalu muncul sebagai "sudah dipakai"). Rapikan lewat Kelola kategori.
- Mengganti nama kategori di Kelola kategori masih mengetik nama (itu pengelolaan daftar oleh Admin); nama tujuan otomatis masuk daftar pilihan.
