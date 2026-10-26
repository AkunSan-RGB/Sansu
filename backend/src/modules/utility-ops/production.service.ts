import { BadRequestException, Injectable } from '@nestjs/common';
import { NRW_WARN_PCT, WATER_QUALITY_LIMITS, evaluateWaterQuality, nonRevenueWater } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, assertNotFuture, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ProductionDto, WaterQualityDto } from './production.dto';
import { ProductionRepository } from './production.repository';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const prevMonth = (p: string) => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const monthEnd = (p: string) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

/** Produksi dan distribusi air harian, air tak berekening (NRW), serta pengujian kualitas air terhadap baku mutu */
@Injectable()
export class ProductionService {
  constructor(@InjectDb() private readonly db: Db, private readonly repo: ProductionRepository, private readonly audit: AuditService) {}

  list(tenantId: string, from?: string, to?: string) {
    const t = todayJakarta();
    return this.repo.list(this.db, tenantId, from || addDays(t, -30), to || t);
  }
  sources(tenantId: string) { return this.repo.sources(this.db, tenantId).then((r) => r.map((x) => x.source)); }

  async save(u: AuthUser, dto: ProductionDto) {
    assertNotFuture(dto.date, 'Tanggal produksi');
    const ownUse = dto.ownUse ?? 0;
    if (dto.distributed + ownUse > dto.produced + 0.005) throw new BadRequestException('Air yang dialirkan ditambah pemakaian sendiri tidak boleh melebihi air yang diproduksi');
    const r = await this.repo.upsert(this.db, { tenantId: u.tenantId, date: dto.date, source: dto.source.trim(), produced: dto.produced, distributed: dto.distributed, ownUse, energyKwh: dto.energyKwh ?? null, chemicalNote: dto.chemicalNote?.trim() || null, note: dto.note?.trim() || null, userId: u.sub });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: r.inserted ? 'CREATE' : 'UPDATE', entity: 'UtilityProduction', entityId: r.id, data: { date: dto.date, source: dto.source, distributed: dto.distributed } });
    return { id: r.id, updated: !r.inserted };
  }

  /** Neraca air satu bulan: produksi → distribusi → terjual, dengan air tak berekening dan 6 bulan pembanding */
  async summary(tenantId: string, period?: string) {
    const p = period && PERIOD.test(period) ? period : todayJakarta().slice(0, 7);
    const one = async (per: string) => {
      const t = await this.repo.monthTotals(this.db, tenantId, per);
      const distributed = Number(t?.distributed ?? 0);
      const billed = Number(t?.billed ?? 0);
      const nrw = nonRevenueWater(distributed, billed);
      const energy = Number(t?.energy ?? 0);
      return { period: per, produced: round2(Number(t?.produced ?? 0)), distributed: round2(distributed), ownUse: round2(Number(t?.own_use ?? 0)), billed: round2(billed), nrwVolume: nrw.volume, nrwPct: nrw.pct, days: t?.days ?? 0, energyKwh: energy, kwhPerM3: distributed > 0 && energy > 0 ? round2(energy / distributed) : null };
    };
    let cur = p;
    const trend = [];
    for (let i = 0; i < 6; i++) { trend.unshift(await one(cur)); cur = prevMonth(cur); }
    const now = trend[trend.length - 1];
    return { ...now, warnPct: NRW_WARN_PCT, warn: now.nrwPct != null && now.nrwPct > NRW_WARN_PCT, expectedDays: Number(monthEnd(p).slice(8)), perSource: await this.repo.perSource(this.db, tenantId, p), perDay: await this.repo.perDay(this.db, tenantId, p), trend };
  }

  // ---- kualitas air ----
  limits() { return WATER_QUALITY_LIMITS; }
  qualityList(tenantId: string, from?: string, to?: string, point?: string) {
    const t = todayJakarta();
    return this.repo.qualityList(this.db, tenantId, from || addDays(t, -60), to || t, point || undefined);
  }
  async qualitySummary(tenantId: string) {
    const t = todayJakarta();
    const points = await this.repo.qualitySummary(this.db, tenantId, addDays(t, -30));
    const samples = points.reduce((a, r) => a + r.samples, 0);
    const failing = points.reduce((a, r) => a + r.failing, 0);
    return { samples, failing, okPct: samples ? Math.round(((samples - failing) / samples) * 100) : null, points, knownPoints: (await this.repo.points(this.db, tenantId)).map((r) => r.point), limits: WATER_QUALITY_LIMITS };
  }
  async qualitySave(u: AuthUser, dto: WaterQualityDto) {
    assertNotFuture(dto.sampledOn, 'Tanggal pengambilan sampel');
    const vals = { ph: dto.ph ?? null, turbidity: dto.turbidity ?? null, chlorine: dto.chlorine ?? null, coliform: dto.coliform ?? null, tds: dto.tds ?? null };
    if (Object.values(vals).every((v) => v == null)) throw new BadRequestException('Isi sedikitnya satu hasil uji');
    const ev = evaluateWaterQuality(vals);
    const id = await this.repo.qualityInsert(this.db, { tenantId: u.tenantId, sampledOn: dto.sampledOn, point: dto.point.trim(), ...vals, ok: ev.ok, failed: ev.failed, samplerId: u.sub, note: dto.note?.trim() || null });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityWaterQuality', entityId: id, data: { point: dto.point, ok: ev.ok, failed: ev.failed } });
    return { id, ok: ev.ok, failed: ev.failed };
  }
}
