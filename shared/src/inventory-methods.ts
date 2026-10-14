/**
 * Metode penentuan biaya persediaan.
 *  - SAK EP Bab 13 (13.18) dan ED SAK EMKM Bab 9 sama-sama hanya membolehkan MPKP/FIFO atau rata-rata tertimbang.
 *  - LIFO tidak diakui kedua standar (dan tidak diterima untuk pajak penghasilan), sehingga tidak disediakan.
 * Metode berlaku untuk seluruh persediaan perusahaan (konsistensi kebijakan akuntansi).
 */
import { FRAMEWORK_REFS, type ReportingFramework } from './accounting.js';
import type { BusinessModel } from './apps.js';

export const INVENTORY_METHODS = ['AVERAGE', 'FIFO'] as const;
export type InventoryMethod = (typeof INVENTORY_METHODS)[number];

export const INVENTORY_METHOD_INFO: Record<InventoryMethod, { label: string; short: string; policy: string; how: string }> = {
  AVERAGE: {
    label: 'Rata-rata bergerak (weighted average)',
    short: 'rata-rata bergerak',
    how: 'Setiap barang masuk menghitung ulang biaya rata-rata; barang keluar memakai rata-rata saat itu.',
    policy: 'Biaya perolehan ditentukan dengan metode rata-rata tertimbang (moving average) yang dihitung ulang setiap terjadi pembelian.',
  },
  FIFO: {
    label: 'Masuk pertama keluar pertama (MPKP / FIFO)',
    short: 'MPKP (FIFO)',
    how: 'Barang yang dijual atau dipakai dihitung dari pembelian paling lama lebih dulu; sisa stok bernilai pembelian terbaru.',
    policy: 'Biaya perolehan ditentukan dengan metode masuk pertama keluar pertama (MPKP/FIFO): barang yang keluar dibebankan pada biaya lapisan pembelian paling awal.',
  },
};

export const isInventoryMethod = (v: unknown): v is InventoryMethod => (INVENTORY_METHODS as readonly string[]).includes(v as string);

export const DEFAULT_INVENTORY_METHOD: InventoryMethod = 'AVERAGE';

/** Saran per jenis usaha (kedua metode sah untuk SAK EP maupun SAK EMKM; yang berbeda hanya kecocokan dengan kegiatan usaha) */
export function inventoryMethodGuide(model: BusinessModel, framework: ReportingFramework): { recommended: InventoryMethod | null; notes: string[] } {
  const std = FRAMEWORK_REFS[framework].inventory;
  const base = [`${std} membolehkan MPKP (FIFO) dan rata-rata tertimbang; LIFO ${framework === 'IFRS' ? 'dilarang (IAS 2.25)' : 'tidak diakui'}.`];
  switch (model) {
    case 'JASA':
      return { recommended: null, notes: ['Usaha jasa umumnya tidak menyimpan persediaan dagang; metode hanya berlaku bila Inventori dipakai untuk bahan atau perlengkapan.', ...base] };
    case 'RITEL':
      return { recommended: 'AVERAGE', notes: ['Toko dengan banyak SKU dan transaksi harian lebih praktis memakai rata-rata bergerak. Pilih FIFO untuk barang cepat kedaluwarsa atau harga beli sering berubah.', ...base] };
    case 'FNB':
      return { recommended: 'AVERAGE', notes: ['Bahan makanan dan minuman dengan banyak resep lebih praktis memakai rata-rata bergerak. Pilih FIFO bila harga bahan sering berubah dan bahan cepat basi, agar biaya mengikuti urutan pembelian.', ...base] };
    case 'PRODUKSI':
    case 'MANUFAKTUR':
      return { recommended: 'AVERAGE', notes: ['Bahan baku yang dicampur dalam satu gudang lazim memakai rata-rata bergerak. FIFO cocok untuk bahan bermasa simpan terbatas.', ...base] };
    default:
      return { recommended: 'AVERAGE', notes: ['Usaha dagang lazim memakai rata-rata bergerak. FIFO memberi HPP yang mengikuti urutan pembelian, cocok bila barang dijual sesuai urutan masuk.', ...base] };
  }
}
