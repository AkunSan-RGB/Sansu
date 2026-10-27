/**
 * Isi Pusat Bantuan SANSU. Ditulis untuk pengguna awam: singkat, langkah demi langkah.
 * `paths` = halaman aplikasi tempat artikel ini relevan (untuk tombol bantuan "?" di pojok kanan atas).
 */
export interface HelpArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  paths: string[];
  steps?: string[];
  tips?: string[];
  keywords?: string;
  /** tautan ke halaman terkait */
  link?: { label: string; to: string };
}
