/**
 * Form produk per jenis usaha. Semua isian bersifat PILIHAN dari daftar (kategori, satuan) — tidak ada ketik bebas —
 * agar data seragam (laporan, filter, stock opname, kasir, impor) dan tidak terpecah oleh salah ketik.
 * Daftar bawaan per jenis usaha; kategori tambahan ditambahkan Admin lewat "Kelola kategori" (bukan di form produk).
 */
import type { BusinessModel } from './apps.js';

/** Katalog satuan (kode huruf besar → nama). Satuan dasar dan satuan bertingkat dipilih dari sini. */
export const UOM_CATALOG: Record<string, string> = {
  // jumlah
  PCS: 'Pcs (buah)', UNIT: 'Unit', SET: 'Set', PASANG: 'Pasang', BIJI: 'Biji', BUTIR: 'Butir', LEMBAR: 'Lembar', BATANG: 'Batang', IKAT: 'Ikat', ROLL: 'Roll',
  // kemasan eceran
  SACHET: 'Sachet', BUNGKUS: 'Bungkus', BOTOL: 'Botol', KALENG: 'Kaleng', TUBE: 'Tube', GELAS: 'Gelas', CUP: 'Cup', PORSI: 'Porsi', LOYANG: 'Loyang', BOX: 'Box', KOTAK: 'Kotak', PAK: 'Pak', POUCH: 'Pouch', JERIGEN: 'Jerigen',
  // kemasan grosir
  RENTENG: 'Renteng', LUSIN: 'Lusin (12)', KODI: 'Kodi (20)', GROSS: 'Gross (144)', DUS: 'Dus', KARTON: 'Karton', KRAT: 'Krat', BAL: 'Bal', SAK: 'Sak', KARUNG: 'Karung', PALET: 'Palet', DRUM: 'Drum', TONG: 'Tong',
  // berat / isi / ukuran
  GRAM: 'Gram', KG: 'Kilogram', ONS: 'Ons', TON: 'Ton', ML: 'Mililiter', LITER: 'Liter', M: 'Meter', CM: 'Sentimeter', M2: 'Meter persegi', M3: 'Meter kubik',
  // jasa & waktu
  JAM: 'Jam', HARI: 'Hari', MINGGU: 'Minggu', BULAN: 'Bulan', TAHUN: 'Tahun', SESI: 'Sesi', PAKET: 'Paket', KUNJUNGAN: 'Kunjungan', ORANG: 'Orang', PROYEK: 'Proyek', LAPORAN: 'Laporan', DOKUMEN: 'Dokumen', TITIK: 'Titik', LISENSI: 'Lisensi', KILOMETER: 'Kilometer', TRIP: 'Trip', PEKERJAAN: 'Pekerjaan',
};

export interface ProductFormProfile {
  /** Satuan dasar yang ditawarkan (urut sesuai kebiasaan jenis usaha); bawaan = yang pertama */
  baseUoms: string[];
  /** Satuan bertingkat yang ditawarkan (DUS, KARTON, ...) */
  packUoms: string[];
  /** Kategori bawaan */
  categories: string[];
  barcode: boolean;
  /** Satuan bertingkat (1 DUS = n satuan dasar) */
  packs: boolean;
  /** Menu dibuat saat dipesan (bahan terpotong sesuai resep di kasir) */
  menu: boolean;
  /** Barang setengah jadi */
  semi: boolean;
  /** Umur simpan hasil produksi */
  shelfLife: boolean;
  skuLabel: string;
  nameLabel: string;
  baseUomLabel: string;
  priceLabel: string;
  /** Penjelasan singkat yang tampil di atas form */
  note: string | null;
}


export const PRODUCT_FORM: Record<BusinessModel, ProductFormProfile> = {
  DAGANG: {
    baseUoms: ['PCS', 'UNIT', 'SET', 'PASANG', 'LEMBAR', 'BATANG', 'ROLL', 'KG', 'GRAM', 'LITER', 'ML', 'M', 'M2', 'BOTOL', 'BUNGKUS', 'PAK', 'BOX'],
    packUoms: ['PAK', 'LUSIN', 'KODI', 'BOX', 'DUS', 'KARTON', 'KRAT', 'BAL', 'SAK', 'KARUNG', 'PALET', 'ROLL'],
    categories: ['Makanan & Minuman', 'Alat Tulis & Kantor', 'Elektronik', 'Pakaian & Aksesori', 'Bahan Bangunan', 'Peralatan Rumah Tangga', 'Kesehatan & Kecantikan', 'Otomotif & Suku Cadang', 'Mainan & Olahraga', 'Lain-lain'],
    barcode: true, packs: true, menu: false, semi: false, shelfLife: false,
    skuLabel: 'SKU', nameLabel: 'Nama barang', baseUomLabel: 'Satuan dasar', priceLabel: 'Harga jual / satuan dasar (belum PPN)', note: null,
  },
  RITEL: {
    baseUoms: ['PCS', 'SACHET', 'BUNGKUS', 'BOTOL', 'KALENG', 'PAK', 'TUBE', 'KG', 'GRAM', 'LITER', 'ML', 'BUTIR'],
    packUoms: ['RENTENG', 'PAK', 'LUSIN', 'BOX', 'DUS', 'KARTON', 'KRAT'],
    categories: ['Sembako', 'Makanan Ringan', 'Minuman', 'Susu & Bayi', 'Perawatan Diri', 'Kebersihan Rumah Tangga', 'Frozen & Dingin', 'Bumbu & Penyedap', 'Alat Tulis', 'Obat Bebas', 'Lain-lain'],
    barcode: true, packs: true, menu: false, semi: false, shelfLife: false,
    skuLabel: 'SKU', nameLabel: 'Nama barang', baseUomLabel: 'Satuan jual', priceLabel: 'Harga jual / satuan jual (belum PPN)',
    note: 'Barcode dipakai untuk scan di kasir. Satuan lebih besar (renteng, dus) dipakai saat membeli dari pemasok.',
  },
  JASA: {
    baseUoms: ['JAM', 'HARI', 'SESI', 'PAKET', 'KUNJUNGAN', 'ORANG', 'PROYEK', 'BULAN', 'MINGGU', 'TAHUN', 'LAPORAN', 'DOKUMEN', 'TITIK', 'LISENSI', 'TRIP', 'PEKERJAAN', 'M2', 'PCS', 'UNIT', 'SET'],
    packUoms: ['HARI', 'MINGGU', 'BULAN', 'PAKET', 'SET'],
    categories: ['Konsultasi', 'Pelatihan & Kursus', 'Perawatan & Kecantikan', 'Perbaikan & Instalasi', 'Desain & Kreatif', 'Teknologi Informasi', 'Hukum, Akuntansi & Pajak', 'Kesehatan', 'Transportasi & Logistik', 'Konstruksi & Renovasi', 'Bahan Habis Pakai', 'Lain-lain'],
    barcode: false, packs: true, menu: false, semi: false, shelfLife: false,
    skuLabel: 'Kode layanan / bahan', nameLabel: 'Nama layanan / bahan', baseUomLabel: 'Satuan tarif', priceLabel: 'Tarif per satuan (belum PPN)',
    note: 'Layanan ditagih per satuan tarif (jam, sesi, paket). Bahan habis pakai (mis. suku cadang) memakai satuan barang. Upah pegawai per jam/sesi diatur di Penggajian → Upah jasa.',
  },
  FMCG: {
    baseUoms: ['PCS', 'SACHET', 'BUNGKUS', 'BOTOL', 'KALENG', 'PAK', 'TUBE', 'POUCH', 'KG', 'GRAM', 'LITER', 'ML'],
    packUoms: ['RENTENG', 'PAK', 'LUSIN', 'BOX', 'DUS', 'KARTON', 'KRAT', 'BAL', 'SAK', 'PALET'],
    categories: ['Mi & Pasta', 'Makanan Kemasan', 'Camilan & Biskuit', 'Minuman Kemasan', 'Kopi, Teh & Sirup', 'Susu & Produk Bayi', 'Bumbu & Penyedap', 'Minyak & Sembako', 'Perawatan Diri', 'Kebersihan Rumah Tangga', 'Obat Bebas & Suplemen', 'Produk Beku & Dingin', 'Rokok & Tembakau', 'Lain-lain'],
    barcode: true, packs: true, menu: false, semi: false, shelfLife: false,
    skuLabel: 'SKU (kode prinsipal)', nameLabel: 'Nama produk (SKU)', baseUomLabel: 'Satuan dasar (terkecil)', priceLabel: 'Harga jual standar / satuan dasar (belum PPN)',
    note: 'Stok dilacak per lot dan tanggal kedaluwarsa (Persediaan → Kedaluwarsa). Harga per segmen outlet diatur di Penjualan → Daftar harga, promo di Promo & bonus barang. Isi satuan besar (dus, karton) agar pembelian dari prinsipal dan penjualan ke outlet bisa memakai satuan itu.',
  },
  MANUFAKTUR: {
    baseUoms: ['PCS', 'KG', 'GRAM', 'LITER', 'ML', 'M', 'M2', 'M3', 'LEMBAR', 'BATANG', 'ROLL', 'UNIT', 'SET', 'PASANG', 'TON'],
    packUoms: ['LUSIN', 'BOX', 'DUS', 'KARTON', 'KRAT', 'BAL', 'SAK', 'KARUNG', 'PALET', 'DRUM', 'ROLL', 'TON'],
    categories: ['Bahan Baku', 'Bahan Penolong', 'Kemasan', 'Barang Jadi', 'Suku Cadang & Mesin', 'Alat Kerja', 'Lain-lain'],
    barcode: true, packs: true, menu: false, semi: true, shelfLife: true,
    skuLabel: 'SKU', nameLabel: 'Nama bahan / barang', baseUomLabel: 'Satuan dasar', priceLabel: 'Harga jual / satuan dasar (belum PPN, isi 0 untuk bahan baku)',
    note: 'Peran produk (bahan baku, setengah jadi, produk jadi) terbaca otomatis dari resep. Tandai "Barang setengah jadi" untuk hasil antara produksi.',
  },
  FNB: {
    baseUoms: ['PORSI', 'GELAS', 'CUP', 'PCS', 'BOTOL', 'LOYANG', 'BUNGKUS', 'KG', 'GRAM', 'LITER', 'ML', 'BUTIR', 'IKAT', 'PAK', 'BOX'],
    packUoms: ['PAK', 'LUSIN', 'BOX', 'DUS', 'KARTON', 'KRAT', 'KARUNG', 'SAK', 'JERIGEN', 'TONG'],
    categories: ['Makanan', 'Minuman', 'Roti & kue', 'Camilan', 'Paket', 'Bahan Makanan', 'Bumbu', 'Kemasan', 'Lain-lain'],
    barcode: true, packs: true, menu: true, semi: true, shelfLife: true,
    skuLabel: 'Kode menu / bahan', nameLabel: 'Nama menu / bahan', baseUomLabel: 'Satuan dasar', priceLabel: 'Harga jual / satuan dasar (belum pajak)',
    note: 'Menu = dibuat saat dipesan: bahan terpotong otomatis sesuai resep di kasir. Bahan dan barang kemasan memakai satuan beli (kg, liter, pak).',
  },
};

/** Kode satuan baku: huruf besar tanpa spasi, harus ada di katalog */
export const isKnownUom = (u: string) => Object.prototype.hasOwnProperty.call(UOM_CATALOG, u);
export const uomLabel = (u: string) => UOM_CATALOG[u] ?? u;
/** Opsi dropdown { value, label } dari daftar kode; kode di luar katalog (data lama) tetap ditampilkan apa adanya */
export const uomOptions = (codes: string[]) => codes.map((c) => ({ value: c, label: c === uomLabel(c) ? c : `${c} — ${uomLabel(c)}` }));
