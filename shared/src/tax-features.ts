/**
 * Fitur pajak yang relevan bagi sebuah perusahaan. Kebutuhan pajak ditentukan oleh tiga hal sekaligus:
 *  - status PKP: perusahaan non-PKP tidak memungut PPN, jadi rekap PPN dan e-Faktur tidak diperlukan
 *  - skema PPh: PPh final UMKM 0,5% tidak memakai rekonsiliasi fiskal dan angsuran PPh 25
 *  - jenis usaha: PPh dipotong pelanggan (kredit PPh 23 / final 4(2)) lazim pada usaha jasa dan produksi (maklon),
 *    bukan pada dagang/ritel yang menjual barang
 * Fitur yang tidak relevan disembunyikan dari menu; datanya tidak dihapus dan halamannya tetap bisa dibuka lewat tautan.
 * `hasData` menampilkan kembali fitur yang ternyata sudah berisi data walau jenis usahanya biasanya tidak memakainya.
 */
import type { BusinessModel } from './apps.js';

export interface TaxFeatureInput {
  model: BusinessModel;
  pkp: boolean;
  taxScheme: 'GENERAL' | 'FINAL_UMKM';
  /** Data nyata yang sudah ada */
  hasData?: { withheldByCustomers?: boolean };
}

export interface TaxFeatures {
  /** Rekap PPN dan setoran PPN */
  vat: boolean;
  /** Ekspor faktur pajak ke Coretax */
  coretax: boolean;
  /** Daftar PPh dipotong pelanggan (kredit pajak) */
  withheldByCustomers: boolean;
  /** Rekonsiliasi fiskal PPh Badan dan angsuran PPh 25 */
  fiscalReconciliation: boolean;
  /** Ringkasan satu kalimat mengapa daftar fitur seperti ini (ditampilkan di Pengaturan) */
  reasons: string[];
}

export function taxFeatures(i: TaxFeatureInput): TaxFeatures {
  const withheldTypical = i.model === 'JASA' || i.model === 'PRODUKSI' || i.model === 'MANUFAKTUR';
  const reasons: string[] = [];
  if (!i.pkp) reasons.push('Belum PKP: PPN keluaran tidak dipungut, jadi rekap PPN dan e-Faktur disembunyikan.');
  if (i.taxScheme === 'FINAL_UMKM') reasons.push('PPh final UMKM 0,5%: rekonsiliasi fiskal dan angsuran PPh 25 tidak diperlukan.');
  if (!withheldTypical && !i.hasData?.withheldByCustomers)
    reasons.push('Usaha penjualan barang umumnya tidak dipotong PPh oleh pelanggan, jadi daftar PPh dipotong pelanggan disembunyikan.');
  return {
    vat: i.pkp,
    coretax: i.pkp,
    withheldByCustomers: withheldTypical || !!i.hasData?.withheldByCustomers,
    fiscalReconciliation: i.taxScheme !== 'FINAL_UMKM',
    reasons,
  };
}
