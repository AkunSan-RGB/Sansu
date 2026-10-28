import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { textArray } from '../../common/utils/sql-guard';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

@Injectable()
export class ProductionRepository {
  list(db: DbOrTx, tenantId: string, from: string, to: string) {
    return rowsOf(db, sql`SELECT id, date, source, produced, distributed, own_use, energy_kwh, chemical_note, note FROM utility_production WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to} ORDER BY date DESC, source`);
  }
  async upsert(db: DbOrTx, v: { tenantId: string; date: string; source: string; produced: number; distributed: number; ownUse: number; energyKwh: number | null; chemicalNote: string | null; note: string | null; userId: string }) {
    const r = await firstOf<{ id: string; inserted: boolean }>(db, sql`
      INSERT INTO utility_production (tenant_id, date, source, produced, distributed, own_use, energy_kwh, chemical_note, note, created_by_id)
      VALUES (${v.tenantId}, ${v.date}, ${v.source}, ${v.produced}, ${v.distributed}, ${v.ownUse}, ${v.energyKwh}, ${v.chemicalNote}, ${v.note}, ${v.userId})
      ON CONFLICT (tenant_id, date, source) DO UPDATE SET produced = EXCLUDED.produced, distributed = EXCLUDED.distributed, own_use = EXCLUDED.own_use, energy_kwh = EXCLUDED.energy_kwh, chemical_note = EXCLUDED.chemical_note, note = EXCLUDED.note, created_by_id = EXCLUDED.created_by_id
      RETURNING id, (xmax = 0) AS inserted`);
    return r!;
  }
  /** Produksi dan distribusi satu bulan, dan volume yang ditagih untuk periode itu */
  monthTotals(db: DbOrTx, tenantId: string, period: string) {
    return firstOf<{ produced: string; distributed: string; own_use: string; energy: string; days: number; billed: string }>(db, sql`
      SELECT COALESCE(SUM(produced), 0)::text AS produced, COALESCE(SUM(distributed), 0)::text AS distributed, COALESCE(SUM(own_use), 0)::text AS own_use, COALESCE(SUM(energy_kwh), 0)::text AS energy, COUNT(DISTINCT date)::int AS days,
        (SELECT COALESCE(SUM(usage), 0) FROM utility_bills WHERE tenant_id = ${tenantId} AND period = ${period})::text AS billed
      FROM utility_production WHERE tenant_id = ${tenantId} AND to_char(date, 'YYYY-MM') = ${period}`);
  }
  perSource(db: DbOrTx, tenantId: string, period: string) {
    return rowsOf(db, sql`SELECT source, SUM(produced) AS produced, SUM(distributed) AS distributed, SUM(own_use) AS own_use, SUM(energy_kwh) AS energy, COUNT(*)::int AS days FROM utility_production WHERE tenant_id = ${tenantId} AND to_char(date, 'YYYY-MM') = ${period} GROUP BY source ORDER BY source`);
  }
  perDay(db: DbOrTx, tenantId: string, period: string) {
    return rowsOf(db, sql`SELECT date, SUM(produced) AS produced, SUM(distributed) AS distributed FROM utility_production WHERE tenant_id = ${tenantId} AND to_char(date, 'YYYY-MM') = ${period} GROUP BY date ORDER BY date`);
  }

  // ---- kualitas air ----
  qualityList(db: DbOrTx, tenantId: string, from: string, to: string, point?: string) {
    return rowsOf(db, sql`SELECT q.id, q.sampled_on, q.point, q.ph, q.turbidity, q.chlorine, q.coliform, q.tds, q.ok, q.failed, q.note, u.name AS sampler
      FROM utility_water_quality q LEFT JOIN users u ON u.id = q.sampler_id WHERE q.tenant_id = ${tenantId} AND q.sampled_on BETWEEN ${from} AND ${to} AND (${point ?? null}::text IS NULL OR q.point = ${point ?? null}) ORDER BY q.sampled_on DESC, q.point`);
  }
  async qualityInsert(db: DbOrTx, v: { tenantId: string; sampledOn: string; point: string; ph: number | null; turbidity: number | null; chlorine: number | null; coliform: number | null; tds: number | null; ok: boolean; failed: string[]; samplerId: string; note: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_water_quality (tenant_id, sampled_on, point, ph, turbidity, chlorine, coliform, tds, ok, failed, sampler_id, note)
      VALUES (${v.tenantId}, ${v.sampledOn}, ${v.point}, ${v.ph}, ${v.turbidity}, ${v.chlorine}, ${v.coliform}, ${v.tds}, ${v.ok}, ${textArray(v.failed)}, ${v.samplerId}, ${v.note}) RETURNING id`);
    return r!.id;
  }
  qualitySummary(db: DbOrTx, tenantId: string, since: string) {
    return rowsOf<{ point: string; samples: number; failing: number; last_on: string }>(db, sql`SELECT point, COUNT(*)::int AS samples, COUNT(*) FILTER (WHERE NOT ok)::int AS failing, MAX(sampled_on)::text AS last_on FROM utility_water_quality WHERE tenant_id = ${tenantId} AND sampled_on >= ${since} GROUP BY point ORDER BY point`);
  }
  points(db: DbOrTx, tenantId: string) { return rowsOf<{ point: string }>(db, sql`SELECT DISTINCT point FROM utility_water_quality WHERE tenant_id = ${tenantId} ORDER BY point`); }
  sources(db: DbOrTx, tenantId: string) { return rowsOf<{ source: string }>(db, sql`SELECT DISTINCT source FROM utility_production WHERE tenant_id = ${tenantId} ORDER BY source`); }
}
