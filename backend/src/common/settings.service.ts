import { Injectable } from '@nestjs/common';
import {
  BUSINESS_MODEL_KEYS,
  type BusinessModel,
  type PayrollSettings,
  type ReportingSettings,
  type TaxProfile,
} from '@sansu/shared';
import { DbOrTx } from '../db/db';
import { SettingsRepository } from './settings.repository';

/**
 * Nilai bawaan penggajian (dapat diubah per perusahaan di Pengaturan).
 * Batas upah JP 2026: Rp10.547.400; batas upah BPJS Kesehatan: Rp12.000.000.
 */
export const DEFAULT_PAYROLL: PayrollSettings = {
  workDaysPerWeek: 6,
  bpjsKesCap: 12_000_000,
  jpCap: 10_547_400,
  jkkRate: 0.24,
  jkmRate: 0.3,
  overtimeDivisor: 173,
};

export const DEFAULT_REPORTING: ReportingSettings = {
  framework: 'SAK_EP',
  legalForm: 'PT',
  businessActivity: 'perdagangan besar (distribusi) barang konsumsi',
  establishedYear: null,
  city: '',
  directorName: '',
  directorTitle: 'Direktur',
  taxScheme: 'GENERAL',
  taxRegisteredYear: null,
  capitalizationThreshold: 0,
};

/** Bawaan: PKP, harga kasir belum termasuk PPN (perusahaan lama tetap seperti sebelumnya) */
export const DEFAULT_TAX_PROFILE: TaxProfile = {
  pkp: true,
  posPricesIncludeVat: false,
  salesPricesIncludeVat: false,
  vatRounding: 'NONE',
  localTaxEnabled: false,
  localTaxRate: '10',
};

/** Profil PPN dari kolom tenants.settings (tanpa query tambahan) */
export function taxProfileOf(settings: Record<string, unknown> | null | undefined): TaxProfile {
  return { ...DEFAULT_TAX_PROFILE, ...((settings?.tax as Partial<TaxProfile>) ?? {}) };
}

/** Pajak daerah kasir (PB1/PBJT) yang berlaku: bila aktif, penjualan kasir memakai tarif ini sebagai pengganti PPN */
export function localTaxOf(settings: Record<string, unknown> | null | undefined): { enabled: boolean; rate: string } {
  const p = taxProfileOf(settings);
  return { enabled: !!p.localTaxEnabled, rate: p.localTaxRate ?? '10' };
}

/** Tarif PPN keluaran efektif: 0 bila perusahaan belum PKP */
export function outputVatRate(t: { ppnRate: string; settings: Record<string, unknown> | null }): string {
  return taxProfileOf(t.settings).pkp ? t.ppnRate : '0';
}

/**
 * Buang properti undefined dari patch. DTO yang sudah ditransformasi membawa properti undefined untuk
 * field yang tidak dikirim; bila ikut digabung, nilai tersimpan tertimpa dan kembali ke bawaan.
 */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  async taxProfile(db: DbOrTx, tenantId: string): Promise<TaxProfile> {
    return this.section(db, tenantId, 'tax', DEFAULT_TAX_PROFILE);
  }

  async saveTaxProfile(db: DbOrTx, tenantId: string, patch: Partial<TaxProfile>): Promise<TaxProfile> {
    return this.saveSection(db, tenantId, 'tax', DEFAULT_TAX_PROFILE, patch);
  }

  async reporting(db: DbOrTx, tenantId: string): Promise<ReportingSettings> {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    return { ...DEFAULT_REPORTING, ...((t?.settings?.reporting as Partial<ReportingSettings>) ?? {}) };
  }

  async saveReporting(db: DbOrTx, tenantId: string, patch: Partial<ReportingSettings>) {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    const current = (t?.settings ?? {}) as Record<string, unknown>;
    const reporting = { ...DEFAULT_REPORTING, ...((current.reporting as object) ?? {}), ...definedOnly(patch) };
    await this.repo.writeKey(db, tenantId, 'reporting', reporting);
    return reporting;
  }

  async payroll(db: DbOrTx, tenantId: string): Promise<PayrollSettings> {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    return { ...DEFAULT_PAYROLL, ...((t?.settings?.payroll as Partial<PayrollSettings>) ?? {}) };
  }

  async savePayroll(db: DbOrTx, tenantId: string, patch: Partial<PayrollSettings>) {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    const current = (t?.settings ?? {}) as Record<string, unknown>;
    const payroll = { ...DEFAULT_PAYROLL, ...((current.payroll as object) ?? {}), ...definedOnly(patch) };
    await this.repo.writeKey(db, tenantId, 'payroll', payroll);
    return payroll;
  }

  /** Model bisnis perusahaan (Dagang bila belum pernah dipilih — perusahaan lama) */
  async businessModel(db: DbOrTx, tenantId: string): Promise<BusinessModel> {
    const s = await this.section(db, tenantId, 'business', { model: 'DAGANG' as BusinessModel });
    return (BUSINESS_MODEL_KEYS as readonly string[]).includes(s.model) ? s.model : 'DAGANG';
  }

  /** Bagian pengaturan bebas (mis. 'integrations') */
  async section<T extends object>(db: DbOrTx, tenantId: string, key: string, defaults: T): Promise<T> {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    return { ...defaults, ...((t?.settings?.[key] as Partial<T>) ?? {}) };
  }

  async saveSection<T extends object>(
    db: DbOrTx,
    tenantId: string,
    key: string,
    defaults: T,
    patch: Partial<T>,
  ): Promise<T> {
    const [t] = await this.repo.findTenantsById(db, tenantId);
    const current = (t?.settings ?? {}) as Record<string, unknown>;
    const merged = { ...defaults, ...((current[key] as object) ?? {}), ...definedOnly(patch) } as T;
    await this.repo.writeKey(db, tenantId, key, merged);
    return merged;
  }
}
