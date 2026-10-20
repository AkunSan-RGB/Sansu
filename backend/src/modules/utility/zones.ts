/**
 * Kehilangan per zona (air/listrik/gas): pasokan yang masuk ke zona (meter induk/sumber, dimasukkan per bulan) dikurangi pemakaian seluruh
 * pelanggan di zona itu yang sudah diverifikasi. Selisih = kehilangan teknis dan non-teknis (kebocoran, meter bermasalah, sambungan liar).
 * Angka dianggap belum lengkap bila ada pencatatan yang belum diverifikasi atau sambungan aktif tanpa pencatatan pada periode itu.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/db';

/** Batas kehilangan yang diberi tanda (persen dari pasokan). Air bersih umumnya diwaspadai di atas 20%. */
export const LOSS_WARN_PCT = 20;

export interface ZoneLossRow {
  zone: string;
  period: string;
  unit: string | null;
  mixedUnits: boolean;
  connections: number;
  supplied: number | null;
  usage: number;
  loss: number | null;
  lossPct: number | null;
  unverified: number;
  missing: number;
  note: string | null;
  status: 'NO_SUPPLY' | 'INCOMPLETE' | 'HIGH' | 'OK' | 'NEGATIVE';
}

/** Kehilangan per zona untuk rentang periode (YYYY-MM). `withEmpty`: sertakan zona yang belum punya data pasokan (untuk satu periode). */
export async function zoneLoss(db: Db, tenantId: string, pFrom: string, pTo: string, withEmpty = false): Promise<ZoneLossRow[]> {
  const r = await db.execute<Record<string, unknown>>(sql`
    WITH z AS (
      SELECT zone, period FROM utility_zone_supply WHERE tenant_id = ${tenantId} AND period BETWEEN ${pFrom} AND ${pTo}
      ${withEmpty ? sql`UNION SELECT DISTINCT zone, ${pFrom}::text FROM utility_connections WHERE tenant_id = ${tenantId} AND zone IS NOT NULL` : sql``}
    )
    SELECT z.zone, z.period, s.supplied, s.note,
      (SELECT COUNT(*) FROM utility_connections c WHERE c.tenant_id = ${tenantId} AND c.zone = z.zone AND c.status <> 'DISCONNECTED')::int AS connections,
      (SELECT COALESCE(SUM(r.usage), 0) FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id WHERE c.tenant_id = ${tenantId} AND c.zone = z.zone AND r.period = z.period AND r.status IN ('VERIFIED', 'BILLED')) AS usage,
      (SELECT COUNT(*) FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id WHERE c.tenant_id = ${tenantId} AND c.zone = z.zone AND r.period = z.period AND r.status = 'ENTERED')::int AS unverified,
      (SELECT COUNT(*) FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.zone = z.zone AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= z.period
         AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = z.period AND r.status <> 'REJECTED'))::int AS missing,
      (SELECT array_agg(DISTINCT t.unit) FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.zone = z.zone AND t.metered) AS units
    FROM z LEFT JOIN utility_zone_supply s ON s.tenant_id = ${tenantId} AND s.zone = z.zone AND s.period = z.period
    ORDER BY z.period DESC, z.zone`);
  return r.rows.map((x) => {
    const supplied = x.supplied == null ? null : Number(x.supplied);
    const usage = Number(x.usage ?? 0);
    const units = (x.units as string[] | null) ?? [];
    const loss = supplied == null ? null : supplied - usage;
    const lossPct = supplied != null && supplied > 0 ? (loss! / supplied) * 100 : null;
    const unverified = Number(x.unverified ?? 0);
    const missing = Number(x.missing ?? 0);
    const status: ZoneLossRow['status'] = supplied == null ? 'NO_SUPPLY' : unverified > 0 || missing > 0 ? 'INCOMPLETE' : loss! < 0 ? 'NEGATIVE' : lossPct != null && lossPct > LOSS_WARN_PCT ? 'HIGH' : 'OK';
    return { zone: String(x.zone), period: String(x.period), unit: units[0] ?? null, mixedUnits: units.length > 1, connections: Number(x.connections ?? 0), supplied, usage, loss, lossPct: lossPct == null ? null : Math.round(lossPct * 10) / 10, unverified, missing, note: (x.note as string | null) ?? null, status };
  });
}

export const ZONE_STATUS_LABEL: Record<ZoneLossRow['status'], string> = {
  NO_SUPPLY: 'Pasokan belum diisi',
  INCOMPLETE: 'Belum lengkap (ada pencatatan belum diverifikasi/belum dicatat)',
  HIGH: `Kehilangan tinggi (> ${LOSS_WARN_PCT}%)`,
  OK: 'Wajar',
  NEGATIVE: 'Pemakaian melebihi pasokan (periksa meter induk)',
};
