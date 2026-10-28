import {
  isKnownUom,
  kpisFor,
  packAccountCodes,
  PROFILE_REVENUE_ACCOUNTS,
  REVENUE_KIND_ACCOUNT,
  SERVICE_PROFILE_KEYS,
  SERVICE_PROFILE_PACKS,
  WORKFLOW_PIPELINES,
} from '@sansu/shared';
import { DEFAULT_COA } from '../accounting/default-coa';
import { SETUP_PROBES } from '../onboarding/model-setup.probes';
import { KPI_VALUE } from './profile-kpis.service';
import { alihDayaInsights, bengkelInsights, konsultanInsights, kontraktorInsights, pendidikanInsights } from './profile-insight-rules';

const coa = new Map(DEFAULT_COA.map((r) => [r.code, r]));

describe('paket profil layanan Jasa', () => {
  it('setiap kode akun yang dirujuk paket ada di bagan akun bawaan Jasa, dengan jenis akun yang benar', () => {
    for (const code of packAccountCodes()) {
      const row = coa.get(code);
      expect(row).toBeDefined();
      expect(row!.models === undefined || row!.models.includes('JASA')).toBe(true);
    }
    for (const code of Object.values(REVENUE_KIND_ACCOUNT)) expect(coa.get(code)!.type).toBe('REVENUE');
    for (const p of SERVICE_PROFILE_KEYS) for (const c of SERVICE_PROFILE_PACKS[p].costTypes) expect(coa.get(c.account)!.type).toBe('EXPENSE');
  });

  it('akun pendapatan khas profil hanya dibuat untuk profilnya; kode tidak dipakai dua kali', () => {
    for (const p of SERVICE_PROFILE_KEYS)
      for (const k of PROFILE_REVENUE_ACCOUNTS[p]) {
        const row = coa.get(REVENUE_KIND_ACCOUNT[k])!;
        expect(row.profiles).toEqual([p]);
      }
    const codes = DEFAULT_COA.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    // tiap akun biaya khas profil tersedia bagi profil pemakainya
    for (const p of SERVICE_PROFILE_KEYS)
      for (const c of SERVICE_PROFILE_PACKS[p].costTypes) {
        const row = coa.get(c.account)!;
        expect(!row.profiles || row.profiles.includes(p)).toBe(true);
      }
  });

  it('pengaturan, satuan, KPI, dan alur kerja tiap profil sah', () => {
    for (const p of SERVICE_PROFILE_KEYS) {
      const pack = SERVICE_PROFILE_PACKS[p];
      for (const s of pack.setup) expect(SETUP_PROBES[s.key]).toBeDefined();
      for (const u of pack.product.baseUoms ?? []) expect(isKnownUom(u)).toBe(true);
      for (const k of kpisFor([p])) expect(KPI_VALUE[k.key]).toBeDefined();
      expect(pack.invoiceTypes.length).toBeGreaterThan(0);
      expect(pack.costTypes.length).toBeGreaterThan(0);
      expect(pack.workspace.stages.length).toBeGreaterThanOrEqual(4);
    }
    const keys = SERVICE_PROFILE_KEYS.flatMap((p) => SERVICE_PROFILE_PACKS[p].invoiceTypes.map((t) => t.key));
    expect(new Set(keys).size).toBe(keys.length);
    // tiap profil punya minimal satu alur kerja khasnya sendiri
    for (const p of SERVICE_PROFILE_KEYS) expect(WORKFLOW_PIPELINES.some((w) => w.model === 'JASA' && w.profiles?.includes(p))).toBe(true);
  });

  it('aturan saran profil: hanya menyampaikan temuan bila ada angkanya', () => {
    expect(kontraktorInsights({})).toEqual([]);
    expect(konsultanInsights({})).toEqual([]);
    expect(pendidikanInsights({}, 10)).toEqual([]);
    expect(alihDayaInsights({})).toEqual([]);
    expect(bengkelInsights({})).toEqual([]);
    const k = kontraktorInsights({ retention_due: 5_000_000, retention_held: 9_000_000, budget: 100, budget_cost: 120, over_budget: 1, contract_active: 1_000_000, billed_active: 400_000, projects_active: 2 });
    expect(k.map((i) => i.id)).toEqual(['kontraktor-retensi', 'kontraktor-anggaran', 'kontraktor-tertagih']);
    expect(pendidikanInsights({ unbilled_now: 4 }, 3)).toEqual([]); // awal bulan: belum waktunya diingatkan
    expect(pendidikanInsights({ unbilled_now: 4 }, 8).map((i) => i.id)).toEqual(['pendidikan-belum-tagih']);
    expect(alihDayaInsights({ need_head_days: 100, duty_head_days: 90, posts_short_today: 1 })[0].id).toBe('alihdaya-keterisian');
    expect(alihDayaInsights({ need_head_days: 100, duty_head_days: 98 })).toEqual([]);
  });
});
