/**
 * Halaman "Rekap pajak" satu tempat untuk semua rekap pajak, dibagi per tab. Tab yang tampil dan namanya mengikuti jenis usaha:
 * hanya yang relevan (mis. PPN hanya untuk PKP, PPh 21 dan BPJS hanya bila ada penggajian), dan "PPh dipotong ..." memakai sebutan
 * pihak yang memotong sesuai usaha (klien, pemberi kerja, pengguna jasa, pemesan, pelanggan).
 */
import type { BusinessModel } from './apps.js';
import type { ServiceProfile } from './service-profiles.js';
import { soleProfile } from './service-packs/index.js';

export const TAX_RECAP_TAB_KEYS = ['annual', 'vat', 'pph21', 'bpjs', 'withholding', 'withheld'] as const;
export type TaxRecapTabKey = (typeof TAX_RECAP_TAB_KEYS)[number];

export interface TaxRecapTabDef {
  key: TaxRecapTabKey;
  label: string;
  /** Satu-dua kalimat: isi tab dan kapan dipakai */
  hint: string;
}

export interface TaxRecapTabCtx {
  model: BusinessModel;
  /** Profil layanan (hanya Jasa); kosong atau lebih dari satu = sebutan umum */
  serviceProfiles?: readonly ServiceProfile[] | null;
  /** Dari taxFeatures: PPN hanya untuk PKP; PPh dipotong pelanggan hanya bila lazim atau sudah ada datanya */
  taxFeatures?: { vat?: boolean; withheldByCustomers?: boolean } | null;
  /** Pengguna boleh membuka aplikasi Penggajian (PPh 21 dan BPJS) */
  canPayroll: boolean;
  /** Pengguna boleh membuka aplikasi Penjualan (daftar potongan dari pelanggan ada di sana) */
  canSales: boolean;
}

/** Sebutan pihak yang memotong PPh dari pembayaran kepada kita, sesuai jenis usaha dan profil layanan */
const PARTY_BY_PROFILE: Record<ServiceProfile, string> = {
  KONSULTAN: 'klien',
  KONTRAKTOR: 'pemberi kerja',
  PENDIDIKAN: 'pemesan pelatihan',
  ALIH_DAYA: 'pengguna jasa',
  BENGKEL: 'pelanggan armada',
};
const PARTY_BY_MODEL: Record<BusinessModel, string> = {
  DAGANG: 'pelanggan',
  RITEL: 'pelanggan',
  JASA: 'klien',
  FMCG: 'pelanggan',
  MANUFAKTUR: 'pemesan',
  FNB: 'pemesan katering',
  UTILITAS: 'pelanggan',
};

export function withheldParty(model: BusinessModel, profiles?: readonly ServiceProfile[] | null): string {
  if (model === 'JASA') {
    const p = soleProfile(profiles);
    if (p) return PARTY_BY_PROFILE[p];
  }
  return PARTY_BY_MODEL[model];
}

/** Penjelasan tambahan PPh yang lazim dipotong, sesuai jenis usaha */
const WITHHELD_NOTE: Record<BusinessModel, string> = {
  DAGANG: 'Penjualan barang umumnya tidak dipotong PPh; tab ini terisi bila ada pelanggan yang memotong.',
  RITEL: 'Penjualan kasir ke konsumen tidak dipotong PPh; tab ini terisi bila ada pelanggan badan yang memotong.',
  JASA: 'Pelanggan badan umumnya memotong PPh 23 atas jasa; jasa konstruksi dan sewa dikenai PPh final 4(2).',
  FMCG: 'Penjualan ke outlet umumnya tidak dipotong PPh; tab ini terisi bila ada pelanggan yang memotong.',
  MANUFAKTUR: 'Pekerjaan maklon (jasa) bisa dipotong PPh 23 oleh pemesan; penjualan barang jadi umumnya tidak.',
  FNB: 'Penjualan kasir tidak dipotong PPh; tab ini terisi bila pesanan katering korporat dipotong pemesannya.',
  UTILITAS: 'Tagihan layanan umumnya tidak dipotong PPh; tab ini terisi bila ada pelanggan badan yang memotong.',
};

export function taxRecapTabs(c: TaxRecapTabCtx): TaxRecapTabDef[] {
  const party = withheldParty(c.model, c.serviceProfiles);
  const tabs: TaxRecapTabDef[] = [
    {
      key: 'annual',
      label: 'Ringkasan tahunan',
      hint: 'Terutang, disetor, dan status tiap masa untuk PPN, PPh 21, PPh 23, PPh 4(2), PPh 25 atau PPh final, dan BPJS. Rincian tiap pajak ada di tab di sebelahnya.',
    },
  ];
  if (c.taxFeatures?.vat !== false) {
    tabs.push({ key: 'vat', label: 'PPN', hint: 'PPN keluaran (dari penjualan) dan PPN masukan (dari pembelian) per dokumen, untuk SPT Masa PPN. Setor atau kompensasi lewat Setoran pajak.' });
  }
  if (c.canPayroll) {
    tabs.push(
      { key: 'pph21', label: 'PPh 21 (gaji)', hint: 'PPh 21 yang dipotong dari gaji per masa pajak dan per pegawai (bahan SPT Masa PPh 21 dan bukti potong 1721-A1).' },
      { key: 'bpjs', label: 'BPJS', hint: 'Iuran BPJS Kesehatan dan Ketenagakerjaan per masa: bagian perusahaan dan bagian karyawan yang dipotong dari gaji.' },
    );
  }
  tabs.push({
    key: 'withholding',
    label: 'Kita potong (PPh 23 & 4(2))',
    hint: 'PPh yang KITA potong saat membayar pemasok, jasa, atau sewa. Kita yang wajib menyetor dan melaporkannya, dan memberi bukti potong kepada pihak yang dibayar.',
  });
  if (c.taxFeatures?.withheldByCustomers !== false && c.canSales) {
    tabs.push({
      key: 'withheld',
      label: `Dipotong ${party}`,
      hint: `PPh yang dipotong ${party} saat membayar KITA. PPh 23 menjadi kredit pajak kita di SPT Tahunan dan butuh bukti potongnya; PPh 4(2) bersifat final. ${WITHHELD_NOTE[c.model]}`,
    });
  }
  return tabs;
}
