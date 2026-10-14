/**
 * Istilah antarmuka menurut jenis usaha. Menu, judul halaman, dan ubin aplikasi diterjemahkan otomatis
 * (mis. perusahaan jasa membaca "Klien" dan "Tagihan", toko membaca "Barang" dan "Toko"). Hanya label yang berubah;
 * data, rute, dan perhitungan sama untuk semua jenis usaha.
 */
import type { BusinessModel } from './apps.js';

interface Terms {
  /** Penggantian kata utuh (huruf besar/kecil awal mengikuti teks asal), diterapkan berurutan: yang lebih panjang dulu */
  words: [string, string][];
  /** Penggantian hanya bila seluruh teks sama persis */
  exact: Record<string, string>;
}

const TERMS: Record<BusinessModel, Terms> = {
  DAGANG: {
    words: [['Produk', 'Barang']],
    exact: {},
  },
  RITEL: {
    words: [
      ['Produk', 'Barang'],
      ['Gudang', 'Toko'],
    ],
    exact: {},
  },
  JASA: {
    words: [
      ['Faktur & piutang', 'Tagihan & piutang'],
      ['Penjualan bulan ini', 'Pendapatan bulan ini'],
      ['Faktur terbaru', 'Tagihan terbaru'],
      ['Nilai persediaan', 'Nilai bahan kerja'],
      ['Sales Order', 'Pesanan kerja'],
      ['Supplier', 'Pemasok & subkontraktor'],
      ['Pelanggan', 'Klien'],
      ['Produk', 'Jasa & bahan'],
      ['Gudang', 'Lokasi bahan'],
      ['Inventori', 'Bahan kerja'],
    ],
    exact: { Penjualan: 'Pendapatan jasa', 'Retur penjualan': 'Koreksi tagihan', Faktur: 'Tagihan' },
  },
  PRODUKSI: {
    words: [
      ['Purchase Order', 'Pesanan bahan'],
      ['Nilai persediaan', 'Nilai persediaan bahan & produk jadi'],
      ['Supplier', 'Pemasok bahan'],
      ['Produk', 'Produk & bahan baku'],
      ['Inventori', 'Persediaan bahan & produk jadi'],
    ],
    exact: { Pembelian: 'Pembelian bahan' },
  },
  MANUFAKTUR: {
    words: [
      ['Purchase Order', 'Pesanan bahan'],
      ['Nilai persediaan', 'Nilai persediaan bahan, barang setengah jadi & barang jadi'],
      ['Supplier', 'Pemasok bahan'],
      ['Produk', 'Produk & bahan baku'],
      ['Inventori', 'Persediaan pabrik'],
    ],
    exact: { Pembelian: 'Pembelian bahan' },
  },
  FNB: {
    words: [
      ['Purchase Order', 'Pesanan bahan'],
      ['Nilai persediaan', 'Nilai persediaan bahan & menu'],
      ['Supplier', 'Pemasok bahan'],
      ['Produk', 'Menu & bahan'],
      ['Inventori', 'Persediaan bahan'],
      ['Gudang', 'Gudang & dapur'],
    ],
    exact: { Pembelian: 'Pembelian bahan' },
  },
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terjemahkan satu teks antarmuka ke istilah jenis usaha (DAGANG bila model tidak dikenal) */
export function localize(text: string, model: BusinessModel | undefined, extra: [string, string][] = []): string {
  const base = TERMS[model ?? 'DAGANG'] ?? TERMS.DAGANG;
  const t = { exact: base.exact, words: [...base.words, ...extra] };
  if (t.exact[text]) return t.exact[text];
  for (const [k, v] of Object.entries(t.exact)) if (text === k.toUpperCase()) return v.toUpperCase();
  let out = text;
  for (const [from, to] of t.words) {
    for (const [f, r] of [
      [from, to],
      [lowerFirst(from), lowerFirst(to)],
      [from.toUpperCase(), to.toUpperCase()],
    ]) {
      out = out.replace(new RegExp(`(?<![\\p{L}])${escape(f)}(?![\\p{L}])`, 'gu'), r);
    }
  }
  return out;
}

/** Pilihan sebutan untuk "Resep" (BOM) sesuai industri: makanan = Resep, furnitur = Daftar bahan, konveksi = Pola & bahan, dst. */
export const RECIPE_TERMS = ['Resep', 'Daftar bahan', 'Formula', 'Pola & bahan', 'Bill of Materials'] as const;
export type RecipeTerm = (typeof RECIPE_TERMS)[number];
export const RECIPE_TERM_HINTS: Record<RecipeTerm, string> = {
  Resep: 'Makanan, minuman, kue, katering',
  'Daftar bahan': 'Furnitur, pabrik rakitan, kerajinan',
  Formula: 'Kimia, kosmetik, farmasi, cat',
  'Pola & bahan': 'Konveksi, garmen, sepatu',
  'Bill of Materials': 'Manufaktur umum (istilah BOM)',
};
