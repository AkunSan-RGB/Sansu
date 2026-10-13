/**
 * Definisi kolom impor data awal. Satu sumber untuk: templat Excel, pengenalan judul kolom
 * (termasuk nama kolom dari Accurate / Jurnal / Excel buatan sendiri), dan petunjuk pengisian.
 */
export type ImportKind = 'products' | 'customers' | 'suppliers' | 'stock' | 'receivables' | 'payables' | 'accounts' | 'assets';

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
  {
    kind: 'assets',
    title: 'Aset tetap lama',
    description:
      'Aset yang sudah Anda miliki sebelum memakai SANSU (kendaraan, mesin, peralatan, bangunan). Tidak membuat jurnal: isi juga nilai akun asetnya di impor "Saldo awal akun". Penyusutan dilanjutkan mulai bulan setelah tanggal saldo awal.',
    needsDate: true,
    link: '/fixed-assets',
    linkLabel: 'Lihat aset tetap',
    columns: [
      { key: 'kode', label: 'Kode aset', hint: 'Opsional. Kosong = dibuat otomatis (AT-0001)', example: ['KDR-001', 'MSN-001', ''], aliases: ['kode', 'no aset', 'nomor aset', 'asset code', 'kode barang'] },
      { key: 'nama', label: 'Nama aset', required: true, hint: 'Nama atau deskripsi aset', example: ['Truk Colt Diesel B 9123 XY', 'Mesin Jahit Industri', 'Laptop Kantor'], aliases: ['nama', 'asset name', 'deskripsi', 'keterangan'] },
      { key: 'kategori', label: 'Kategori', required: true, hint: 'Nama kategori persis seperti di Aset Tetap › Kategori', example: ['Kendaraan', 'Mesin & Peralatan', 'Peralatan Kantor'], aliases: ['kategori aset', 'jenis aset', 'category', 'kelompok'] },
      { key: 'tanggal_perolehan', label: 'Tanggal perolehan', required: true, hint: 'Tanggal beli, format 31/12/2025', example: ['15/03/2022', '01/07/2023', '10/01/2025'], aliases: ['tanggal beli', 'tgl perolehan', 'tanggal', 'acquisition date', 'tgl beli'] },
      { key: 'harga_perolehan', label: 'Harga perolehan', required: true, hint: 'Harga beli awal (bukan nilai buku)', example: [240000000, 45000000, 12000000], aliases: ['harga beli', 'harga', 'nilai perolehan', 'cost', 'harga perolehan awal'] },
      { key: 'akumulasi_penyusutan', label: 'Akumulasi penyusutan', hint: 'Total penyusutan sampai tanggal saldo awal; kosong = 0', example: [90000000, 9375000, 0], aliases: ['akumulasi', 'akm penyusutan', 'penyusutan terakumulasi', 'accumulated depreciation'] },
      { key: 'masa_manfaat_bulan', label: 'Masa manfaat (bulan)', hint: 'Opsional. Kosong = ikut kategori', example: [96, 96, 48], aliases: ['masa manfaat', 'umur ekonomis', 'umur', 'useful life'] },
      { key: 'nilai_residu', label: 'Nilai residu', hint: 'Opsional. Kosong = 0 (SAK EMKM tidak memakai residu)', example: ['', '', ''], aliases: ['residu', 'nilai sisa', 'salvage value'] },
      { key: 'lokasi', label: 'Lokasi', hint: 'Opsional', example: ['Gudang Bandung', 'Pabrik', 'Kantor'], aliases: ['lokasi aset', 'location', 'penempatan'] },
      { key: 'catatan', label: 'Catatan', hint: 'Opsional', example: ['', '', ''], aliases: ['catatan aset', 'notes'] },
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

const MONEY_KEYS = new Set(['harga_jual', 'limit_kredit', 'harga_pokok', 'sisa_piutang', 'sisa_utang', 'debit', 'kredit']);
const NUM_KEYS = new Set(['isi2', 'isi3', 'qty', 'termin_hari']);

/** Susun berkas templat (lembar Data berformat + lembar Petunjuk) */
export async function buildTemplate(spec: KindSpec, ExcelJS: typeof import('exceljs')): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SANSU';
  const font = { name: 'Calibri', size: 11 };
  const thin = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  // ── Lembar Data: baris 1 = judul kolom, lalu contoh; kolom kode/nomor berformat teks agar nol di depan tidak hilang
  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = spec.columns.map((c) => ({
    key: c.key,
    width: Math.min(40, Math.max(14, c.label.length + 6, ...c.example.map((e) => String(e).length + 4))),
  }));
  const head = ws.addRow(spec.columns.map((c) => c.label));
  head.height = 24;
  head.eachCell((cell, n) => {
    const c = spec.columns[n - 1];
    cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FF1F3A5F' : 'FF6B7B93' } };
    cell.alignment = { vertical: 'middle', horizontal: MONEY_KEYS.has(c.key) || NUM_KEYS.has(c.key) ? 'right' : 'left', wrapText: true };
    cell.border = box;
    cell.note = { texts: [{ text: `${c.required ? 'WAJIB' : 'Opsional'}${c.hint ? ' — ' + c.hint : ''}`, font: { size: 10 } }] };
  });
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.numFmt = MONEY_KEYS.has(c.key) ? '#,##0' : NUM_KEYS.has(c.key) ? '#,##0' : '@';
    col.alignment = { horizontal: MONEY_KEYS.has(c.key) || NUM_KEYS.has(c.key) ? 'right' : 'left', vertical: 'middle' };
  });
  const rows = Math.max(...spec.columns.map((c) => c.example.length));
  for (let r = 0; r < rows; r++) {
    const row = ws.addRow(spec.columns.map((c) => c.example[r] ?? ''));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...font, italic: true, color: { argb: 'FF7F7F7F' } };
      cell.border = box;
    });
  }
  // baris kosong berbingkai di bawah contoh sebagai ruang isian
  for (let r = 0; r < 20; r++) {
    const row = ws.addRow(spec.columns.map(() => ''));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = font;
      cell.border = box;
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };

  // ── Lembar Petunjuk
  const hs = wb.addWorksheet('Petunjuk', { views: [{ showGridLines: false }] });
  hs.columns = [{ width: 24 }, { width: 12 }, { width: 90 }];
  const title = hs.addRow([`Templat impor ${spec.title}`]);
  title.font = { ...font, size: 16, bold: true, color: { argb: 'FF1F3A5F' } };
  hs.addRow([spec.description]).font = font;
  hs.addRow([]);
  const steps = [
    '1. Isi lembar "Data" mulai dari baris pertama di bawah judul; baris abu-abu miring hanyalah CONTOH — hapus atau timpa sebelum diunggah.',
    '2. Jangan mengubah, menambah, atau menghapus baris judul kolom (baris 1). Urutan kolom boleh berbeda.',
    '3. Judul biru tua = kolom WAJIB; abu-abu = opsional. Arahkan kursor ke judul untuk melihat catatan.',
    '4. Angka boleh ditulis 1250000 atau 1.250.000, tanpa simbol Rp. Tanggal ditulis 31/12/2025.',
    '5. Satu baris = satu data. Kode (SKU, pelanggan, supplier) tidak boleh kembar dalam satu berkas.',
  ];
  for (const t of steps) {
    const r = hs.addRow([t]);
    r.font = font;
    hs.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true, vertical: 'top' };
    r.height = 32;
  }
  hs.addRow([]);
  const th = hs.addRow(['Kolom', 'Wajib?', 'Keterangan']);
  th.eachCell((cell) => {
    cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    cell.border = box;
  });
  for (const c of spec.columns) {
    const r = hs.addRow([c.label, c.required ? 'Wajib' : 'Opsional', c.hint || '—']);
    r.eachCell((cell, n) => {
      cell.font = n === 2 && c.required ? { ...font, bold: true, color: { argb: 'FFC0392B' } } : font;
      cell.border = box;
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Buat & unduh templat Excel */
export async function downloadTemplate(spec: KindSpec) {
  const ExcelJS = await import('exceljs');
  const bytes = await buildTemplate(spec, (ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS);
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `templat-impor-${spec.kind}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
