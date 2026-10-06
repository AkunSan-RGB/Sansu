/**
 * Definisi kolom impor data awal. Satu sumber untuk: templat Excel, pengenalan judul kolom
 * (termasuk nama kolom dari Accurate / Jurnal / Excel buatan sendiri), dan petunjuk pengisian.
 */
export type ImportKind = 'products' | 'customers' | 'suppliers' | 'stock' | 'receivables' | 'payables' | 'accounts';

export interface ColumnSpec {
  key: string;
  label: string;
  required?: boolean;
  hint: string;
  example: (string | number)[];
  aliases?: string[];
}

export interface KindSpec {
  kind: ImportKind;
  title: string;
  description: string;
  /** butuh tanggal saldo awal */
  needsDate?: boolean;
  needsWarehouse?: boolean;
  /** halaman untuk melihat hasil */
  link: string;
  linkLabel: string;
  columns: ColumnSpec[];
}

export const IMPORT_SPECS: KindSpec[] = [
  {
    kind: 'products',
    title: 'Produk',
    description: 'Daftar barang beserta harga jual, satuan, dan barcode. SKU yang sudah ada akan diperbarui.',
    link: '/products',
    linkLabel: 'Lihat produk',
    columns: [
      { key: 'sku', label: 'SKU', required: true, hint: 'Kode barang unik, maks. 40 karakter', example: ['MIE-GRG-85', 'KOPI-SCH'], aliases: ['kode', 'kode barang', 'kode produk', 'kode item', 'item code', 'no barang', 'sku'] },
      { key: 'nama', label: 'Nama', required: true, hint: 'Nama barang', example: ['Mie Goreng 85g', 'Kopi Sachet 20g'], aliases: ['nama barang', 'nama produk', 'nama item', 'deskripsi', 'item name', 'name'] },
      { key: 'kategori', label: 'Kategori', hint: 'Opsional', example: ['Makanan', 'Minuman'], aliases: ['kategori barang', 'jenis', 'category', 'grup'] },
      { key: 'satuan', label: 'Satuan', hint: 'Satuan terkecil, mis. PCS (default PCS)', example: ['PCS', 'PCS'], aliases: ['satuan dasar', 'unit', 'uom'] },
      { key: 'harga_jual', label: 'Harga jual', required: true, hint: 'Per satuan terkecil, belum PPN', example: [3500, 1250], aliases: ['harga', 'harga jual satuan', 'price', 'harga satuan'] },
      { key: 'barcode', label: 'Barcode', hint: 'Opsional, untuk kasir', example: ['8991234567890', ''], aliases: ['ean', 'upc', 'kode barcode'] },
      { key: 'satuan2', label: 'Satuan besar', hint: 'Opsional, mis. DUS', example: ['DUS', 'RENCENG'], aliases: ['satuan 2', 'satuan besar 1'] },
      { key: 'isi2', label: 'Isi satuan besar', hint: 'Jumlah satuan terkecil per satuan besar', example: [40, 10], aliases: ['isi', 'isi 2', 'konversi', 'konversi 2', 'faktor'] },
      { key: 'satuan3', label: 'Satuan besar 2', hint: 'Opsional, mis. BAL', example: ['', ''], aliases: ['satuan 3'] },
      { key: 'isi3', label: 'Isi satuan besar 2', hint: 'Jumlah satuan terkecil', example: ['', ''], aliases: ['isi 3', 'konversi 3'] },
    ],
  },
  {
    kind: 'customers',
    title: 'Pelanggan',
    description: 'Daftar pelanggan dengan limit kredit dan termin. Kode yang sudah ada akan diperbarui.',
    link: '/customers',
    linkLabel: 'Lihat pelanggan',
    columns: [
      { key: 'kode', label: 'Kode', required: true, hint: 'Kode pelanggan unik, maks. 30 karakter', example: ['TK-SUMBER', 'TK-MAKMUR'], aliases: ['kode pelanggan', 'id pelanggan', 'customer code', 'no pelanggan'] },
      { key: 'nama', label: 'Nama', required: true, hint: 'Nama toko / perusahaan', example: ['Toko Sumber Rejeki', 'CV Makmur Jaya'], aliases: ['nama pelanggan', 'customer', 'customer name'] },
      { key: 'telepon', label: 'Telepon', hint: 'Untuk WhatsApp', example: ['081234567890', ''], aliases: ['telp', 'hp', 'no hp', 'no telepon', 'phone', 'whatsapp'] },
      { key: 'alamat', label: 'Alamat', hint: '', example: ['Jl. Pasar Baru 12, Bandung', ''], aliases: ['address', 'alamat lengkap'] },
      { key: 'npwp', label: 'NPWP / NIK', hint: '15–16 digit, untuk e-Faktur', example: ['0123456789012000', ''], aliases: ['npwp pelanggan', 'nik', 'tin'] },
      { key: 'limit_kredit', label: 'Limit kredit', hint: '0 = tanpa batas', example: [10000000, 0], aliases: ['limit', 'plafon', 'credit limit', 'batas kredit'] },
      { key: 'termin_hari', label: 'Termin (hari)', hint: 'Lama tempo pembayaran, default 30', example: [30, 14], aliases: ['termin', 'top', 'tempo', 'jatuh tempo hari', 'payment term'] },
    ],
  },
  {
    kind: 'suppliers',
    title: 'Supplier',
    description: 'Daftar pemasok. Kode yang sudah ada akan diperbarui.',
    link: '/suppliers',
    linkLabel: 'Lihat supplier',
    columns: [
      { key: 'kode', label: 'Kode', required: true, hint: 'Kode supplier unik, maks. 30 karakter', example: ['SUP-PANGAN', 'SUP-KOPI'], aliases: ['kode supplier', 'kode pemasok', 'vendor code', 'id supplier'] },
      { key: 'nama', label: 'Nama', required: true, hint: '', example: ['PT Sumber Pangan', 'CV Kopi Nusantara'], aliases: ['nama supplier', 'nama pemasok', 'vendor', 'supplier'] },
      { key: 'telepon', label: 'Telepon', hint: '', example: ['0215551234', ''], aliases: ['telp', 'hp', 'phone', 'no telepon'] },
      { key: 'alamat', label: 'Alamat', hint: '', example: ['Kawasan Industri Pulogadung', ''], aliases: ['address'] },
      { key: 'npwp', label: 'NPWP', hint: '', example: ['0987654321098000', ''], aliases: ['tin'] },
      { key: 'termin_hari', label: 'Termin (hari)', hint: 'Default 30', example: [45, 30], aliases: ['termin', 'top', 'tempo', 'payment term'] },
    ],
  },
  {
    kind: 'stock',
    title: 'Stok awal',
    description: 'Jumlah & harga pokok persediaan per tanggal mulai. Produk harus sudah ada. Jurnal persediaan dibuat otomatis.',
    needsDate: true,
    needsWarehouse: true,
    link: '/inventory',
    linkLabel: 'Lihat stok',
    columns: [
      { key: 'sku', label: 'SKU', required: true, hint: 'Harus sama dengan SKU di daftar produk', example: ['MIE-GRG-85', 'KOPI-SCH'], aliases: ['kode', 'kode barang', 'kode produk', 'kode item'] },
      { key: 'gudang', label: 'Gudang', hint: 'Kode/nama gudang; kosong = gudang yang dipilih di layar', example: ['', ''], aliases: ['kode gudang', 'lokasi', 'warehouse'] },
      { key: 'qty', label: 'Qty', required: true, hint: 'Dalam satuan terkecil', example: [1200, 500], aliases: ['jumlah', 'kuantitas', 'stok', 'saldo qty', 'quantity', 'kuantitas akhir'] },
      { key: 'harga_pokok', label: 'Harga pokok', required: true, hint: 'Per satuan terkecil (HPP rata-rata)', example: [2800, 900], aliases: ['hpp', 'harga beli', 'cost', 'biaya satuan', 'harga pokok satuan', 'nilai satuan'] },
    ],
  },
  {
    kind: 'receivables',
    title: 'Piutang awal',
    description: 'Faktur penjualan yang belum lunas dari sistem lama, per faktur — agar umur piutang & penagihan berjalan.',
    needsDate: true,
    link: '/invoices',
    linkLabel: 'Lihat faktur',
    columns: [
      { key: 'kode_pelanggan', label: 'Kode pelanggan', required: true, hint: 'Harus sama dengan kode di daftar pelanggan', example: ['TK-SUMBER', 'TK-MAKMUR'], aliases: ['kode', 'pelanggan', 'customer code', 'kode customer'] },
      { key: 'no_faktur', label: 'No. faktur', required: true, hint: 'Nomor faktur lama', example: ['INV-2025-0812', 'INV-2025-0840'], aliases: ['nomor faktur', 'no invoice', 'invoice', 'no bukti', 'nomor'] },
      { key: 'tanggal', label: 'Tanggal faktur', required: true, hint: 'Format 31/12/2025', example: ['15/11/2025', '02/12/2025'], aliases: ['tgl', 'tanggal', 'tgl faktur', 'date', 'tanggal invoice'] },
      { key: 'jatuh_tempo', label: 'Jatuh tempo', hint: 'Kosong = tanggal + termin pelanggan', example: ['', '01/01/2026'], aliases: ['tgl jatuh tempo', 'due date', 'jth tempo'] },
      { key: 'sisa_piutang', label: 'Sisa piutang', required: true, hint: 'Yang BELUM dibayar (termasuk PPN)', example: [2500000, 1750000], aliases: ['sisa', 'saldo', 'piutang', 'outstanding', 'sisa tagihan', 'terutang'] },
    ],
  },
  {
    kind: 'payables',
    title: 'Utang awal',
    description: 'Faktur pembelian yang belum dibayar ke supplier, per faktur — agar jatuh tempo pembayaran terpantau.',
    needsDate: true,
    link: '/purchase-invoices',
    linkLabel: 'Lihat faktur pembelian',
    columns: [
      { key: 'kode_supplier', label: 'Kode supplier', required: true, hint: 'Harus sama dengan kode di daftar supplier', example: ['SUP-PANGAN'], aliases: ['kode', 'supplier', 'kode pemasok', 'vendor code'] },
      { key: 'no_faktur', label: 'No. faktur supplier', required: true, hint: 'Nomor faktur dari supplier', example: ['SP/2025/12/0091'], aliases: ['nomor faktur', 'no invoice', 'invoice', 'no bukti'] },
      { key: 'tanggal', label: 'Tanggal faktur', required: true, hint: 'Format 31/12/2025', example: ['20/12/2025'], aliases: ['tgl', 'tgl faktur', 'date'] },
      { key: 'jatuh_tempo', label: 'Jatuh tempo', hint: 'Kosong = tanggal + termin supplier', example: [''], aliases: ['tgl jatuh tempo', 'due date'] },
      { key: 'sisa_utang', label: 'Sisa utang', required: true, hint: 'Yang BELUM dibayar (termasuk PPN)', example: [18500000], aliases: ['sisa', 'saldo', 'utang', 'hutang', 'outstanding', 'sisa tagihan'] },
    ],
  },
  {
    kind: 'accounts',
    title: 'Saldo awal akun',
    description: 'Saldo neraca lainnya (kas, bank, aset tetap, utang lain, modal). Piutang, utang usaha & persediaan diisi lewat impor di atas.',
    needsDate: true,
    link: '/opening-balance',
    linkLabel: 'Lihat saldo awal',
    columns: [
      { key: 'kode_akun', label: 'Kode akun', required: true, hint: 'Sesuai Bagan Akun SANSU, mis. 1-1200', example: ['1-1100', '1-1200', '2-1600', '3-1000'], aliases: ['kode', 'no akun', 'nomor akun', 'akun', 'account'] },
      { key: 'nama_akun', label: 'Nama akun', hint: 'Hanya pengingat — tidak dibaca', example: ['Kas', 'Bank', 'Beban Masih Harus Dibayar', 'Modal Disetor'], aliases: ['nama', 'keterangan'] },
      { key: 'debit', label: 'Debit', hint: 'Saldo normal aset', example: [5000000, 150000000, '', ''], aliases: ['saldo debit', 'debet', 'dr'] },
      { key: 'kredit', label: 'Kredit', hint: 'Saldo normal utang & modal', example: ['', '', 2000000, 100000000], aliases: ['saldo kredit', 'cr', 'credit'] },
    ],
  },
];

export const SPEC_BY_KIND = Object.fromEntries(IMPORT_SPECS.map((s) => [s.kind, s])) as Record<ImportKind, KindSpec>;

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Cocokkan judul kolom file dengan kolom templat. Mengembalikan indeks kolom per kunci. */
export function matchHeaders(spec: KindSpec, header: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  // 1) cocok persis dengan kunci / label; 2) cocok dengan alias
  for (const pass of [0, 1] as const) {
    for (const col of spec.columns) {
      if (out[col.key] !== undefined) continue;
      const names = pass === 0 ? [col.key, col.label] : (col.aliases ?? []);
      const want = names.map(norm);
      const idx = header.findIndex((h, i) => !used.has(i) && want.includes(norm(h)));
      if (idx >= 0) {
        out[col.key] = idx;
        used.add(idx);
      }
    }
  }
  return out;
}

/** Cari baris judul (baris pertama yang paling banyak cocok) — file ekspor sering diawali judul laporan */
export function findHeaderRow(spec: KindSpec, grid: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const score = Object.keys(matchHeaders(spec, grid[i] ?? [])).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** Buat & unduh templat Excel: lembar data (judul + contoh) dan lembar petunjuk */
export async function downloadTemplate(spec: KindSpec) {
  const XLSX = await import('xlsx');
  const rows = Math.max(...spec.columns.map((c) => c.example.length));
  const data = [spec.columns.map((c) => c.key), ...Array.from({ length: rows }, (_, i) => spec.columns.map((c) => c.example[i] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = spec.columns.map((c) => ({ wch: Math.max(14, c.key.length + 4) }));
  const help = XLSX.utils.aoa_to_sheet([
    [`Templat impor ${spec.title} — SANSU`],
    [spec.description],
    ['Ganti baris contoh dengan data Anda. Jangan ubah baris judul (baris 1). Angka boleh ditulis 1250000 atau 1.250.000.'],
    [],
    ['Kolom', 'Wajib?', 'Keterangan'],
    ...spec.columns.map((c) => [c.key, c.required ? 'Wajib' : 'Opsional', `${c.label}${c.hint ? ' — ' + c.hint : ''}`]),
  ]);
  help['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.utils.book_append_sheet(wb, help, 'Petunjuk');
  XLSX.writeFile(wb, `templat-impor-${spec.kind}.xlsx`);
}
