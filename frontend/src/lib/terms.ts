import { type BusinessModel, localize } from '@sansu/shared';

/**
 * Istilah antarmuka sesuai jenis usaha perusahaan yang sedang masuk. Diisi oleh AuthContext setiap data pengguna dimuat,
 * lalu dipakai sebagai t('Pelanggan') pada label, judul, dan pesan agar "Pelanggan" menjadi "Klien" untuk usaha jasa, dst.
 * Sebelum jenis usaha diketahui (mis. nilai yang dihitung saat modul dimuat), teks dikembalikan apa adanya.
 */
let current: BusinessModel | undefined;
export const setUiModel = (m: BusinessModel | undefined) => {
  current = m;
};
let extra: [string, string][] = [];
/** Sebutan "Resep" pilihan perusahaan (mis. "Daftar bahan" untuk furnitur): menggantikan kata Resep di seluruh antarmuka */
export const setRecipeTerm = (term: string | undefined) => {
  extra = term && term !== 'Resep' ? [['Resep', term]] : [];
};
export const t = (text: string) => (current ? localize(text, current, extra) : text);
