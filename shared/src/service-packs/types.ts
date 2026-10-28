import type { CrmProfile } from '../crm-profile.js';
import type { SetupItemDef } from '../model-setup.js';
import type { WorkspaceDef } from '../model-workspace.js';
import type { ProductFormProfile } from '../product-form.js';
import type { TaxFocus } from '../tax-focus.js';

/**
 * Paket profil layanan (jenis usaha Jasa): semua yang membedakan satu profil dari profil lain, dalam satu definisi per profil —
 * istilah, ruang kerja, pengaturan, CRM, form produk, jenis tagihan, jenis biaya, aksi cepat, ubin KPI, laporan, dan fokus pajak.
 * Satu profil terpilih = paket penuh profil itu; beberapa profil = gabungan (daftar disatukan, istilah tetap umum Jasa).
 */

/** Penggantian kata sebelum istilah umum Jasa diterapkan (kata profil menang) */
export interface ProfileTerms {
  words: [string, string][];
  exact?: Record<string, string>;
}

/** Jenis pendapatan layanan: menentukan akun pendapatan tempat sebuah tagihan dibukukan */
export type RevenueKind =
  | 'CONSULT'
  | 'RETAINER'
  | 'CONSTRUCTION'
  | 'VARIATION'
  | 'EDU_FEE'
  | 'EDU_REG'
  | 'EDU_CORP'
  | 'SITE_SECURITY'
  | 'SITE_CLEANING'
  | 'SITE_OTHER'
  | 'SITE_EXTRA'
  | 'REPAIR'
  | 'FLEET';

/** Kunci pilihan PPh yang dipotong pelanggan (CUSTOMER_WITHHOLDING_PRESETS) */
export type WithholdingPresetKey =
  | 'PPH23_JASA'
  | 'KONSTRUKSI_KECIL'
  | 'KONSTRUKSI_MENENGAH'
  | 'KONSTRUKSI_TANPA_SBU'
  | 'KONSULTAN_SBU'
  | 'KONSULTAN_TANPA_SBU'
  | 'SEWA_BANGUNAN';

/** Jenis tagihan yang dibuat manual di form Faktur jasa */
export interface InvoiceTypeDef {
  key: string;
  label: string;
  hint: string;
  revenueKind: RevenueKind;
  /** Satuan baris bawaan (teks bebas di faktur jasa) */
  unit: string;
  /** Awalan deskripsi baris */
  description: string;
  termLabel?: string;
  withholding: WithholdingPresetKey | null;
  /** PPN bawaan (jasa pendidikan dibebaskan dari PPN) */
  withVat: boolean;
  requiresProject?: boolean;
}

/** Jenis biaya khas profil: akun beban yang disarankan pertama di form tagihan pemasok dan biaya */
export interface CostTypeDef {
  key: string;
  label: string;
  hint: string;
  /** Kode akun beban di bagan akun */
  account: string;
}

export interface QuickActionDef {
  label: string;
  desc: string;
  to: string;
}

export type KpiFormat = 'money' | 'number' | 'percent' | 'text';
export interface KpiDef {
  key: string;
  label: string;
  hint: string;
  format: KpiFormat;
  to?: string;
}

/** Jenis laporan pendukung khas profil (kunci SupportKind di server) */
export type ProfileReportKind = 'jasa-konsultan' | 'jasa-kontraktor' | 'jasa-pendidikan' | 'jasa-alihdaya' | 'jasa-bengkel';

export interface ServiceProfilePack {
  /** Sebutan satu pelanggan di layar profil ini */
  customerNoun: string;
  tagline: string;
  terms: ProfileTerms;
  workspace: WorkspaceDef;
  setup: SetupItemDef[];
  crm: CrmProfile;
  product: Partial<
    Pick<ProductFormProfile, 'categories' | 'baseUoms' | 'packUoms' | 'skuLabel' | 'nameLabel' | 'baseUomLabel' | 'priceLabel' | 'note'>
  >;
  invoiceTypes: InvoiceTypeDef[];
  costTypes: CostTypeDef[];
  quickActions: QuickActionDef[];
  kpis: KpiDef[];
  report: { kind: ProfileReportKind; label: string; hint: string };
  taxFocus: TaxFocus;
}
