import type { BusinessModel, ServiceProfile } from '@sansu/shared';
import { ARTICLES as BASICS } from './articles.basics';
import { ARTICLES as FINANCE } from './articles.finance';
import { ARTICLES as MODELS } from './articles.models';
import { ARTICLES as STOCK } from './articles.stock';
import type { HelpArticle } from './articles.types';

export type { HelpArticle } from './articles.types';

export const HELP_CATEGORIES = [
  'Panduan jenis usaha',
  'Memulai',
  'Penjualan',
  'Kasir',
  'Pembelian & Stok',
  'Akuntansi & Pajak',
  'Pengaturan & Keamanan',
] as const;

/**
 * Artikel lama yang hanya berlaku bagi jenis usaha tertentu. Dipetakan di sini agar isi artikelnya tidak perlu disentuh;
 * artikel tanpa pemetaan (dan tanpa `models`) tampil untuk semua jenis usaha.
 */
const MODEL_TAGS: Record<string, BusinessModel[]> = {
  kasir: ['RITEL', 'FNB'],
  'menu-resep': ['FNB'],
  'meja-dapur': ['FNB'],
  'pesanan-online': ['FNB'],
  pb1: ['FNB'],
  jasa: ['JASA'],
  'upah-jasa': ['JASA'],
  'status-karyawan-jasa': ['JASA'],
  produksi: ['MANUFAKTUR', 'FNB'],
  kedaluwarsa: ['FMCG', 'FNB', 'RITEL'],
  'alur-jual': ['DAGANG', 'JASA', 'FMCG', 'MANUFAKTUR'],
  'fmcg-harga-promo': ['FMCG'],
  'fmcg-recall': ['FMCG'],
  'fmcg-target-sales': ['FMCG'],
  'fmcg-konsinyasi': ['FMCG'],
  'fmcg-tukar-guling': ['FMCG'],
  'fmcg-kanvas': ['FMCG'],
  'fmcg-modern-trade': ['FMCG'],
  'utilitas-tagihan-bulanan': ['UTILITAS'],
  'air-loket-non-tunai': ['UTILITAS'],
  'air-pelayanan-pengaduan': ['UTILITAS'],
  'air-koreksi-penagihan': ['UTILITAS'],
  'air-teknik-produksi': ['UTILITAS'],
};

export const HELP_ARTICLES: HelpArticle[] = [...MODELS, ...BASICS, ...STOCK, ...FINANCE].map((a) => (MODEL_TAGS[a.id] && !a.models ? { ...a, models: MODEL_TAGS[a.id] } : a));

/** Artikel yang boleh dilihat jenis usaha ini (tanpa jenis usaha, semuanya) */
export const articlesVisibleTo = (model?: BusinessModel, profiles?: ServiceProfile[]): HelpArticle[] =>
  HELP_ARTICLES.filter((a) => (!a.models || !model || a.models.includes(model)) && (!a.profiles || model !== 'JASA' || !profiles || a.profiles.some((p) => profiles.includes(p))));

/** Artikel yang relevan dengan halaman yang sedang dibuka */
export function articlesFor(pathname: string, model?: BusinessModel, profiles?: ServiceProfile[]): HelpArticle[] {
  const exact = articlesVisibleTo(model, profiles).filter((a) =>
    a.paths.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))),
  );
  return exact;
}

/** Pencarian sederhana: semua kata harus muncul di judul/ringkasan/isi/kata kunci */
export function searchArticles(term: string, model?: BusinessModel, profiles?: ServiceProfile[]): HelpArticle[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = articlesVisibleTo(model, profiles);
  if (!words.length) return pool;
  return pool.filter((a) => {
    const hay = [a.title, a.summary, a.keywords, ...(a.steps ?? []), ...(a.tips ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
