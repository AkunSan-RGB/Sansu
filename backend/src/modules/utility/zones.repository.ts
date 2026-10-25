import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Dipakai oleh zones.zoneLoss */
export function queryZ(db: DbOrTx, tenantId: string, pFrom: string, pTo: string, withEmpty: boolean) {
  return db.execute<Record<string, unknown>>(sql`
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
}
