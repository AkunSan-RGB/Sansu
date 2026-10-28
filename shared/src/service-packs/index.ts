import { CRM_PROFILES, type CrmProfile } from '../crm-profile.js';
import { MODEL_SETUP, type SetupItemDef } from '../model-setup.js';
import { MODEL_WORKSPACE, type WorkspaceDef } from '../model-workspace.js';
import { PRODUCT_FORM, type ProductFormProfile } from '../product-form.js';
import { SERVICE_PROFILE_KEYS, type ServiceProfile } from '../service-profiles.js';
import { TAX_FOCUS, type TaxFocus } from '../tax-focus.js';
import { ALIH_DAYA_PACK } from './alih-daya.js';
import { BENGKEL_PACK } from './bengkel.js';
import { KONSULTAN_PACK } from './konsultan.js';
import { KONTRAKTOR_PACK } from './kontraktor.js';
import { PENDIDIKAN_PACK } from './pendidikan.js';
import type { CostTypeDef, InvoiceTypeDef, KpiDef, ProfileTerms, QuickActionDef, RevenueKind, ServiceProfilePack } from './types.js';

export type * from './types.js';

export const SERVICE_PROFILE_PACKS: Record<ServiceProfile, ServiceProfilePack> = {
  KONSULTAN: KONSULTAN_PACK,
  KONTRAKTOR: KONTRAKTOR_PACK,
  PENDIDIKAN: PENDIDIKAN_PACK,
  ALIH_DAYA: ALIH_DAYA_PACK,
  BENGKEL: BENGKEL_PACK,
};

/** Akun pendapatan (kode bagan akun) untuk tiap jenis pendapatan layanan */
export const REVENUE_KIND_ACCOUNT: Record<RevenueKind, string> = {
  CONSULT: '4-2510',
  RETAINER: '4-2520',
  CONSTRUCTION: '4-2100',
  VARIATION: '4-2530',
  EDU_FEE: '4-2610',
  EDU_REG: '4-2620',
  EDU_CORP: '4-2640',
  SITE_SECURITY: '4-2710',
  SITE_CLEANING: '4-2720',
  SITE_EXTRA: '4-2730',
  SITE_OTHER: '4-2740',
  REPAIR: '4-2810',
  FLEET: '4-2820',
};

/** Profil mana yang memiliki akun pendapatan tertentu (akun dibuat saat profil dipilih) */
export const PROFILE_REVENUE_ACCOUNTS: Record<ServiceProfile, RevenueKind[]> = {
  KONSULTAN: ['CONSULT', 'RETAINER'],
  KONTRAKTOR: ['VARIATION'],
  PENDIDIKAN: ['EDU_FEE', 'EDU_REG', 'EDU_CORP'],
  ALIH_DAYA: ['SITE_SECURITY', 'SITE_CLEANING', 'SITE_EXTRA', 'SITE_OTHER'],
  BENGKEL: ['REPAIR', 'FLEET'],
};

/** Profil yang berlaku: tidak diketahui / kosong = semua (perusahaan lama tidak tiba-tiba kehilangan apa pun) */
export const effectiveProfiles = (profiles?: readonly ServiceProfile[] | null): ServiceProfile[] =>
  profiles && profiles.length ? SERVICE_PROFILE_KEYS.filter((k) => profiles.includes(k)) : [...SERVICE_PROFILE_KEYS];

/** Profil tunggal bila perusahaan memilih tepat satu profil; selain itu tidak ada (istilah dan ruang kerja tetap umum Jasa) */
export const soleProfile = (profiles?: readonly ServiceProfile[] | null): ServiceProfile | undefined => (profiles && profiles.length === 1 ? profiles[0] : undefined);

export const packsFor = (profiles?: readonly ServiceProfile[] | null): ServiceProfilePack[] => effectiveProfiles(profiles).map((k) => SERVICE_PROFILE_PACKS[k]);

const uniqueBy = <T>(items: T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
};

/** Penggantian kata khusus profil (hanya bila satu profil dipilih) */
export const profileTermsFor = (profiles?: readonly ServiceProfile[] | null): ProfileTerms | undefined => {
  const p = soleProfile(profiles);
  return p ? SERVICE_PROFILE_PACKS[p].terms : undefined;
};

export const workspaceFor = (profiles?: readonly ServiceProfile[] | null): WorkspaceDef => {
  const p = soleProfile(profiles);
  return p ? SERVICE_PROFILE_PACKS[p].workspace : MODEL_WORKSPACE.JASA;
};

export const setupFor = (profiles?: readonly ServiceProfile[] | null): SetupItemDef[] => {
  const p = soleProfile(profiles);
  if (p) return SERVICE_PROFILE_PACKS[p].setup;
  if (!profiles || !profiles.length) return MODEL_SETUP.JASA;
  return uniqueBy(packsFor(profiles).flatMap((k) => k.setup), (s) => s.key);
};

/** Profil CRM yang ditampilkan (tahap bawaan hanya dipakai saat tahap perusahaan dibuat pertama kali) */
export const crmProfileFor = (profiles?: readonly ServiceProfile[] | null): CrmProfile => {
  const p = soleProfile(profiles);
  if (p) return SERVICE_PROFILE_PACKS[p].crm;
  if (!profiles || !profiles.length) return CRM_PROFILES.JASA;
  const packs = packsFor(profiles).map((k) => k.crm);
  return {
    noun: 'Calon klien',
    titleExample: CRM_PROFILES.JASA.titleExample,
    stages: CRM_PROFILES.JASA.stages,
    sources: uniqueBy(packs.flatMap((c) => c.sources), (s) => s),
    lostReasons: uniqueBy(packs.flatMap((c) => c.lostReasons), (s) => s),
  };
};

/** Sumber/alasan yang sah mencakup profil umum Jasa agar data lama tetap valid */
export const crmAcceptedFor = (profiles?: readonly ServiceProfile[] | null) => {
  const view = crmProfileFor(profiles);
  return {
    sources: uniqueBy([...view.sources, ...CRM_PROFILES.JASA.sources, ...packsFor(profiles).flatMap((k) => k.crm.sources)], (s) => s),
    lostReasons: uniqueBy([...view.lostReasons, ...CRM_PROFILES.JASA.lostReasons, ...packsFor(profiles).flatMap((k) => k.crm.lostReasons)], (s) => s),
  };
};

/** Form produk Jasa menurut profil: satu profil = isian profil itu; beberapa profil = daftar digabung, label umum */
export const productFormFor = (profiles?: readonly ServiceProfile[] | null): ProductFormProfile => {
  const base = PRODUCT_FORM.JASA;
  const p = soleProfile(profiles);
  if (p) return { ...base, ...SERVICE_PROFILE_PACKS[p].product };
  if (!profiles || !profiles.length) return base;
  const packs = packsFor(profiles).map((k) => k.product);
  return {
    ...base,
    categories: uniqueBy([...packs.flatMap((x) => x.categories ?? []), ...base.categories], (s) => s.toLowerCase()),
    baseUoms: uniqueBy([...packs.flatMap((x) => x.baseUoms ?? []), ...base.baseUoms], (s) => s),
  };
};

export const invoiceTypesFor = (profiles?: readonly ServiceProfile[] | null): InvoiceTypeDef[] => packsFor(profiles).flatMap((k) => k.invoiceTypes);
export const costTypesFor = (profiles?: readonly ServiceProfile[] | null): CostTypeDef[] => uniqueBy(packsFor(profiles).flatMap((k) => k.costTypes), (c) => c.account);
export const quickActionsFor = (profiles?: readonly ServiceProfile[] | null): QuickActionDef[] => uniqueBy(packsFor(profiles).flatMap((k) => k.quickActions), (a) => a.label);
export const kpisFor = (profiles?: readonly ServiceProfile[] | null): KpiDef[] => packsFor(profiles).flatMap((k) => k.kpis);

export const taxFocusFor = (profiles?: readonly ServiceProfile[] | null): TaxFocus => {
  const p = soleProfile(profiles);
  return p ? SERVICE_PROFILE_PACKS[p].taxFocus : TAX_FOCUS.JASA;
};

/** Semua kode akun yang dirujuk paket (untuk uji kesesuaian dengan bagan akun) */
export const packAccountCodes = (): string[] =>
  uniqueBy(
    [
      ...Object.values(REVENUE_KIND_ACCOUNT),
      ...SERVICE_PROFILE_KEYS.flatMap((k) => SERVICE_PROFILE_PACKS[k].costTypes.map((c) => c.account)),
    ],
    (s) => s,
  );

/** Jenis pos jaga kontrak lokasi (alih daya): menentukan akun pendapatan tagihan bulanannya */
export const SITE_POST_KINDS = ['SECURITY', 'CLEANING', 'OTHER'] as const;
export type SitePostKind = (typeof SITE_POST_KINDS)[number];
export const SITE_POST_KIND_LABELS: Record<SitePostKind, string> = { SECURITY: 'Keamanan', CLEANING: 'Kebersihan', OTHER: 'Lainnya' };
export const SITE_POST_REVENUE: Record<SitePostKind, RevenueKind> = { SECURITY: 'SITE_SECURITY', CLEANING: 'SITE_CLEANING', OTHER: 'SITE_OTHER' };
/** Tebakan jenis pos dari namanya (dipakai bila jenis tidak dipilih dan untuk data lama) */
export const guessSitePostKind = (name: string): SitePostKind =>
  /satpam|keamanan|security|jaga|patroli/i.test(name) ? 'SECURITY' : /bersih|cleaning|cleaner|kebun|taman/i.test(name) ? 'CLEANING' : 'OTHER';

// ---- Pilihan per perusahaan: jenis usaha + profil layanan (profil hanya berlaku untuk Jasa) ----
type Model = keyof typeof CRM_PROFILES;
export const crmProfileForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null): CrmProfile => (model === 'JASA' ? crmProfileFor(profiles) : CRM_PROFILES[model]);
export const crmAcceptedForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null) =>
  model === 'JASA' ? crmAcceptedFor(profiles) : { sources: CRM_PROFILES[model].sources, lostReasons: CRM_PROFILES[model].lostReasons };
export const productFormForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null): ProductFormProfile => (model === 'JASA' ? productFormFor(profiles) : PRODUCT_FORM[model]);
export const setupForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null): SetupItemDef[] => (model === 'JASA' ? setupFor(profiles) : MODEL_SETUP[model]);
export const workspaceForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null): WorkspaceDef => (model === 'JASA' ? workspaceFor(profiles) : MODEL_WORKSPACE[model]);
export const taxFocusForTenant = (model: Model, profiles?: readonly ServiceProfile[] | null): TaxFocus => (model === 'JASA' ? taxFocusFor(profiles) : TAX_FOCUS[model]);
