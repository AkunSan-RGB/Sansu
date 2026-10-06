import { type BusinessModel, localize } from '@sansu/shared';

/**
 * Istilah antarmuka sesuai jenis usaha perusahaan yang sedang masuk. Diisi oleh AuthContext setiap data pengguna dimuat,
 * lalu dipakai sebagai t('Pelanggan') pada judul kolom dan kartu agar "Pelanggan" menjadi "Klien" untuk usaha jasa, dst.
 */
let current: BusinessModel | undefined;
export const setUiModel = (m: BusinessModel | undefined) => {
  current = m;
};
export const t = (text: string) => localize(text, current);
