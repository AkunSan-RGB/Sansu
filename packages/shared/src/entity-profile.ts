/**
 * Profil entitas: ukuran usaha (kriteria UMKM) → rekomendasi standar akuntansi (SAK EMKM / SAK EP),
 * skema PPh, dan status PKP. Fungsi murni tanpa akses database: dipakai server (menerapkan & memvalidasi)
 * sekaligus tampilan (pratinjau langsung di wizard), sehingga keduanya tidak mungkin berbeda.
 */
import type { LegalForm, ReportingFramework, TaxScheme } from './accounting.js';

/** Batas peredaran bruto PPh final UMKM 0,5% dan kewajiban dikukuhkan sebagai PKP (Rp per tahun) */
export const TAX_REVENUE_LIMIT = 4_800_000_000;
/** Pasal 31E UU PPh: peredaran bruto sampai batas ini mendapat pengurangan tarif 50% */
export const FACILITY_31E_REVENUE_LIMIT = 50_000_000_000;
/** Tarif PPh final UMKM (% dari peredaran bruto) dan tarif efektif Pasal 31E (22% × 50%) */
export const FINAL_TAX_RATE = 0.5;
export const FACILITY_31E_RATE = 11;
/**
 * Bentuk badan usaha yang tidak lagi berhak PPh final UMKM 0,5%.
 * Aturan ini sama dengan yang sudah dipakai Rekonsiliasi Fiskal (PP 20/2026 jo. PP 55/2022).
 */
export const FINAL_TAX_EXCLUDED_FORMS: readonly LegalForm[] = ['PT', 'CV', 'FIRMA'];

/** Kriteria UMKM (PP 7/2021): modal usaha di luar tanah & bangunan, atau hasil penjualan tahunan (Rp) */
export const UMKM_LIMITS = {
  assets: { MICRO: 1_000_000_000, SMALL: 5_000_000_000, MEDIUM: 10_000_000_000 },
  revenue: { MICRO: 2_000_000_000, SMALL: 15_000_000_000, MEDIUM: 50_000_000_000 },
} as const;

export const ENTITY_SIZES = ['MICRO', 'SMALL', 'MEDIUM', 'LARGE'] as const;
export type EntitySize = (typeof ENTITY_SIZES)[number];
export const ENTITY_SIZE_LABELS: Record<EntitySize, string> = {
  MICRO: 'Usaha mikro',
  SMALL: 'Usaha kecil',
  MEDIUM: 'Usaha menengah',
  LARGE: 'Usaha besar',
};

const rank = (s: EntitySize) => ENTITY_SIZES.indexOf(s);

function sizeBy(value: number, limit: { MICRO: number; SMALL: number; MEDIUM: number }): EntitySize {
  if (value <= limit.MICRO) return 'MICRO';
  if (value <= limit.SMALL) return 'SMALL';
  if (value <= limit.MEDIUM) return 'MEDIUM';
  return 'LARGE';
}

/**
 * Ukuran entitas = yang lebih besar dari ukuran menurut modal usaha dan menurut hasil penjualan tahunan.
 * Sengaja berhati-hati: tidak ada entitas yang dianggap lebih kecil dari kenyataannya.
 */
export function classifyEntity(assets: number, revenue: number) {
  const byAssets = sizeBy(Math.max(assets, 0), UMKM_LIMITS.assets);
  const byRevenue = sizeBy(Math.max(revenue, 0), UMKM_LIMITS.revenue);
  return { size: ENTITY_SIZES[Math.max(rank(byAssets), rank(byRevenue))], byAssets, byRevenue };
}

/** Berhak PPh final UMKM 0,5%: peredaran bruto ≤ Rp4,8 miliar dan bentuk usaha belum dikecualikan */
export function finalTaxEligible(legalForm: LegalForm, revenue: number) {
  return revenue <= TAX_REVENUE_LIMIT && !FINAL_TAX_EXCLUDED_FORMS.includes(legalForm);
}

export interface EntityProfileInput {
  /** Entitas dengan akuntabilitas publik (tercatat di bursa, bank, asuransi, dan sejenisnya) */
  publicAccountability: boolean;
  /** Modal usaha / total aset di luar tanah dan bangunan tempat usaha (Rp) */
  assets: number;
  /** Peredaran bruto setahun (Rp) */
  revenue: number;
  legalForm: LegalForm;
}

export interface EntityRecommendation {
  size: EntitySize;
  byAssets: EntitySize;
  byRevenue: EntitySize;
  /** Akuntabilitas publik: di luar cakupan SAK EMKM dan SAK EP, wizard tidak dapat menerapkan */
  outOfScope: boolean;
  framework: ReportingFramework;
  /** Standar lain yang masih boleh dipilih */
  frameworkAlternatives: ReportingFramework[];
  taxScheme: TaxScheme;
  finalTaxEligible: boolean;
  /** Wajib PKP bila peredaran bruto melewati batas */
  pkpRequired: boolean;
  reasons: string[];
  warnings: string[];
}

const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;

export function recommendProfile(input: EntityProfileInput): EntityRecommendation {
  const { size, byAssets, byRevenue } = classifyEntity(input.assets, input.revenue);
  const reasons: string[] = [];
  const warnings: string[] = [];

  reasons.push(
    `Ukuran usaha: ${ENTITY_SIZE_LABELS[size].toLowerCase()}. Menurut modal usaha ${ENTITY_SIZE_LABELS[byAssets].toLowerCase()} (${rp(input.assets)}), menurut peredaran bruto ${ENTITY_SIZE_LABELS[byRevenue].toLowerCase()} (${rp(input.revenue)}); dipakai yang lebih besar.`,
  );

  const outOfScope = input.publicAccountability;
  if (outOfScope) {
    warnings.push(
      'Entitas dengan akuntabilitas publik wajib memakai SAK yang berbasis IFRS, bukan SAK EMKM atau SAK EP. Hubungi akuntan Anda; SANSU tidak dapat menerapkan pilihan standar untuk kondisi ini.',
    );
  }

  let framework: ReportingFramework;
  let frameworkAlternatives: ReportingFramework[];
  if (size === 'MICRO' || size === 'SMALL') {
    framework = 'SAK_EMKM';
    frameworkAlternatives = ['SAK_EP'];
    reasons.push('Usaha mikro dan kecil cukup memakai SAK EMKM: hanya Laporan Posisi Keuangan, Laba Rugi, dan CALK. SAK EP tetap boleh bila ingin laporan lengkap.');
  } else if (size === 'MEDIUM') {
    framework = 'SAK_EP';
    frameworkAlternatives = ['SAK_EMKM'];
    reasons.push('Usaha menengah disarankan memakai SAK EP (lima laporan dengan pembanding dan pajak tangguhan). SAK EMKM masih memenuhi kriteria bila pemakai laporan tidak memerlukannya.');
  } else {
    framework = 'SAK_EP';
    frameworkAlternatives = [];
    reasons.push('Usaha di atas kriteria UMKM memakai SAK EP; SAK EMKM tidak lagi memenuhi syarat.');
  }

  const eligible = finalTaxEligible(input.legalForm, input.revenue);
  let taxScheme: TaxScheme = 'GENERAL';
  if (input.revenue > TAX_REVENUE_LIMIT) {
    reasons.push(`Peredaran bruto melewati ${rp(TAX_REVENUE_LIMIT)}: PPh final UMKM tidak berlaku, dikenai tarif umum Pasal 17 (22%).`);
    if (input.revenue <= FACILITY_31E_REVENUE_LIMIT) {
      reasons.push(`Fasilitas Pasal 31E berlaku: pengurangan tarif 50% untuk bagian peredaran bruto sampai ${rp(TAX_REVENUE_LIMIT)}.`);
    }
  } else if (FINAL_TAX_EXCLUDED_FORMS.includes(input.legalForm)) {
    reasons.push('Bentuk badan usaha ini tidak lagi berhak PPh final 0,5% (kecuali masih dalam masa transisi jangka waktu semula): dipakai tarif umum dengan fasilitas Pasal 31E.');
    warnings.push('Bila perusahaan masih dalam masa transisi PPh final, pilih skema PPh final secara manual di Pengaturan setelah memastikan haknya.');
  } else if (eligible) {
    taxScheme = 'FINAL_UMKM';
    const breakEven = (FINAL_TAX_RATE / FACILITY_31E_RATE) * 100;
    reasons.push(
      `Berhak PPh final ${FINAL_TAX_RATE.toLocaleString('id-ID')}% dari peredaran bruto. Bila margin laba fiskal usaha di bawah sekitar ${breakEven.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari peredaran bruto (atau merugi), tarif umum dengan Pasal 31E justru lebih ringan.`,
    );
    warnings.push('Pastikan jangka waktu pemakaian PPh final untuk wajib pajak Anda belum berakhir.');
  }

  return {
    size,
    byAssets,
    byRevenue,
    outOfScope,
    framework,
    frameworkAlternatives,
    taxScheme,
    finalTaxEligible: eligible,
    pkpRequired: input.revenue > TAX_REVENUE_LIMIT,
    reasons,
    warnings,
  };
}

/** Apa yang berubah otomatis di SANSU untuk kombinasi standar & skema pajak yang dipilih */
export function simplificationsFor(framework: ReportingFramework, taxScheme: TaxScheme): string[] {
  const out: string[] = [];
  if (framework === 'SAK_EMKM') {
    out.push('Laporan wajib hanya Posisi Keuangan, Laba Rugi, dan CALK; Perubahan Ekuitas dan Arus Kas disembunyikan sebagai laporan opsional.');
    out.push('Laba rugi disajikan ringkas per kelompok (pendapatan, beban pokok, beban usaha, beban lain-lain).');
    out.push('Pajak tangguhan tidak dihitung dan tidak dijurnal.');
    out.push('CALK memakai ikhtisar kebijakan akuntansi SAK EMKM.');
  } else {
    out.push('Lima laporan lengkap dengan angka pembanding: Posisi Keuangan, Laba Rugi dan Penghasilan Komprehensif, Perubahan Ekuitas, Arus Kas, dan CALK.');
    if (taxScheme === 'GENERAL') out.push('Pajak tangguhan atas beda temporer aset tetap dan penurunan nilai persediaan dihitung otomatis.');
  }
  if (taxScheme === 'FINAL_UMKM') {
    out.push('Rekonsiliasi fiskal dan angsuran PPh 25 dinonaktifkan; PPh final 0,5% dihitung dari peredaran bruto tiap bulan.');
  } else {
    out.push('Rekonsiliasi fiskal, angsuran PPh 25, dan PPh Pasal 29 dihitung otomatis.');
  }
  return out;
}

/** Respons GET /accounting/entity-profile */
export interface EntityProfileState {
  current: { framework: ReportingFramework; taxScheme: TaxScheme; pkp: boolean; legalForm: LegalForm; taxRegisteredYear: number | null };
  /** Pilihan wizard terakhir yang diterapkan (null bila belum pernah) */
  saved: (EntityProfileInput & { taxRegisteredYear: number | null; appliedAt: string; appliedFramework: ReportingFramework; appliedTaxScheme: TaxScheme }) | null;
  /** Ukuran usaha dari pembukuan: peredaran 12 bulan terakhir dan aset di luar tanah & bangunan */
  measured: { from: string; to: string; revenue: number; assets: number };
  answers: EntityProfileInput;
  recommendation: EntityRecommendation;
  simplifications: string[];
  /** false = pilihan saat ini tidak lagi sesuai angka pembukuan */
  drift: { framework: boolean; taxScheme: boolean; pkp: boolean };
}

export interface EntityProfileApplyResult extends EntityProfileState {
  applied: { framework: ReportingFramework; taxScheme: TaxScheme };
  warnings: string[];
}
