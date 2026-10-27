import { ARTICLES as BASICS } from './articles.basics';
import { ARTICLES as FINANCE } from './articles.finance';
import { ARTICLES as STOCK } from './articles.stock';
import type { HelpArticle } from './articles.types';

export type { HelpArticle } from './articles.types';

export const HELP_CATEGORIES = [
  'Memulai',
  'Penjualan',
  'Kasir',
  'Pembelian & Stok',
  'Akuntansi & Pajak',
  'Pengaturan & Keamanan',
] as const;

export const HELP_ARTICLES: HelpArticle[] = [...BASICS, ...STOCK, ...FINANCE];

/** Artikel yang relevan dengan halaman yang sedang dibuka */
export function articlesFor(pathname: string): HelpArticle[] {
  const exact = HELP_ARTICLES.filter((a) =>
    a.paths.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))),
  );
  return exact;
}

/** Pencarian sederhana: semua kata harus muncul di judul/ringkasan/isi/kata kunci */
export function searchArticles(term: string): HelpArticle[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return HELP_ARTICLES;
  return HELP_ARTICLES.filter((a) => {
    const hay = [a.title, a.summary, a.keywords, ...(a.steps ?? []), ...(a.tips ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
