import { Injectable, Logger } from '@nestjs/common';
import { kpisFor, SERVICE_PROFILE_PACKS, type KpiDef, type ServiceProfile } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { addDays, monthStart, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import type { DashboardInsight } from './insight-rules';
import { alihDayaInsights, bengkelInsights, konsultanInsights, kontraktorInsights, pendidikanInsights } from './profile-insight-rules';
import { type MetricRow, ProfileMetricsRepository } from './profile-metrics.repository';

const num = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: unknown, b: unknown) => (num(b) > 0 ? Math.round((num(a) / num(b)) * 1000) / 10 : null);

/** Nilai tiap ubin KPI dari angka mentah profilnya */
export const KPI_VALUE: Record<string, (m: MetricRow) => number | string | null> = {
  k_projects_active: (m) => num(m.projects_active),
  k_contract_active: (m) => num(m.contract_active),
  k_billed_pct: (m) => pct(m.billed_active, m.contract_active),
  k_retention_held: (m) => num(m.retention_held),
  k_cost_vs_budget: (m) => pct(m.budget_cost, m.budget),
  s_unbilled_value: (m) => num(m.unbilled_value),
  s_hours_month: (m) => num(m.hours_month),
  s_utilization_pct: (m) => pct(m.hours_month, m.logged_month),
  s_retainer_mrr: (m) => num(m.retainer_mrr),
  s_projects_active: (m) => num(m.projects_active),
  e_students_active: (m) => num(m.students_active),
  e_fee_month: (m) => num(m.fee_month),
  e_arrears: (m) => num(m.arrears),
  e_collection_pct: (m) => pct(m.paid3, m.billed3),
  e_class_fill_pct: (m) => pct(m.seated, m.capacity),
  a_sites_active: (m) => num(m.sites_active),
  a_staffing_pct: (m) => pct(m.duty_head_days, m.need_head_days),
  a_billing_month: (m) => num(m.billing_month),
  a_shortfall_month: (m) => num(m.shortfall_prev),
  a_ar_overdue: (m) => num(m.ar_overdue),
  b_orders_month: (m) => num(m.orders_month),
  b_service_month: (m) => num(m.service_month),
  b_parts_month: (m) => num(m.parts_month),
  b_top_mechanic: (m) => (m.top_mechanic ? String(m.top_mechanic) : null),
  b_low_parts: (m) => num(m.low_parts),
};

export interface ProfileKpiTile extends KpiDef {
  profile: ServiceProfile;
  value: number | string | null;
}

/** Ubin KPI dan saran beranda khas profil layanan perusahaan Jasa (jenis usaha lain: kosong) */
@Injectable()
export class ProfileKpiService {
  private readonly log = new Logger('ProfileKpi');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly repo: ProfileMetricsRepository,
  ) {}

  private async metrics(tenantId: string): Promise<{ profile: ServiceProfile; m: MetricRow }[]> {
    if ((await this.settings.businessModel(this.db, tenantId)) !== 'JASA') return [];
    const profiles = await this.settings.serviceProfiles(this.db, tenantId);
    const today = todayJakarta();
    const month = monthStart(today);
    const prevMonth = monthStart(addDays(month, -1));
    const load: Record<ServiceProfile, () => Promise<MetricRow>> = {
      KONTRAKTOR: () => this.repo.kontraktor(this.db, tenantId, today),
      KONSULTAN: () => this.repo.konsultan(this.db, tenantId, month, today),
      PENDIDIKAN: () => this.repo.pendidikan(this.db, tenantId, month, today),
      ALIH_DAYA: () => this.repo.alihDaya(this.db, tenantId, month, prevMonth, today),
      BENGKEL: () => this.repo.bengkel(this.db, tenantId, month, today),
    };
    const out: { profile: ServiceProfile; m: MetricRow }[] = [];
    for (const p of profiles) {
      try {
        out.push({ profile: p, m: await load[p]() });
      } catch (e) {
        // satu profil yang gagal dihitung tidak boleh menggagalkan beranda
        this.log.warn(`metrik ${p} dilewati: ${(e as Error).message}`);
      }
    }
    return out;
  }

  async tiles(tenantId: string): Promise<{ tiles: ProfileKpiTile[] }> {
    const rows = await this.metrics(tenantId);
    const tiles = rows.flatMap(({ profile, m }) => kpisFor([profile]).map((k) => ({ ...k, profile, value: KPI_VALUE[k.key]?.(m) ?? null })));
    return { tiles };
  }

  async insights(tenantId: string): Promise<DashboardInsight[]> {
    const day = Number(todayJakarta().slice(8, 10));
    const rules: Record<ServiceProfile, (m: MetricRow) => DashboardInsight[]> = {
      KONTRAKTOR: kontraktorInsights,
      KONSULTAN: konsultanInsights,
      PENDIDIKAN: (m) => pendidikanInsights(m, day),
      ALIH_DAYA: alihDayaInsights,
      BENGKEL: bengkelInsights,
    };
    return (await this.metrics(tenantId)).flatMap(({ profile, m }) => rules[profile](m));
  }
}

/** Nama profil untuk ubin (dipakai tampilan bila perusahaan memilih lebih dari satu profil) */
export const profileTitle = (p: ServiceProfile) => SERVICE_PROFILE_PACKS[p].workspace.title;
