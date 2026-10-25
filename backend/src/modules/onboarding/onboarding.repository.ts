import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq } from 'drizzle-orm';
import { tenants } from '../../db/schema';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Onboarding: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class OnboardingRepository {
  /** Dipakai oleh OnboardingService.hasTransactions */
  queryHasTransactions(db: DbOrTx, checks: SQL<unknown>[]) {
    return db.execute<{ x: number }>(
      sql`SELECT 1 AS x WHERE ${sql.join(
        checks.map((c) => sql`EXISTS (${c})`),
        sql` OR `,
      )}`,
    );
  }

  /** Dipakai oleh OnboardingService.chosen */
  findTenantsById(db: DbOrTx, tenantId: NonNullable<(typeof tenants.$inferSelect)['id']>) {
    return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh OnboardingService.status */
  queryTenant(db: DbOrTx, sub: string, tenantId: string) {
    return db.execute<Record<string, boolean | number | string | null>>(sql`
      SELECT
        (t.npwp IS NOT NULL AND t.npwp <> '' AND t.address IS NOT NULL AND t.address <> '') AS company,
        COALESCE(t.settings->'branding'->>'logo', '') <> '' AS logo,
        COALESCE(t.settings->'entityProfile'->>'appliedAt', '') <> '' AS standard,
        EXISTS (SELECT 1 FROM products p WHERE p.tenant_id = t.id) AS products,
        EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = t.id) AS customers,
        EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = t.id
                AND (j.source_type = 'OPENING' OR (j.source_type = 'STOCK_ADJUSTMENT' AND j.description LIKE '%(OPENING)%'))) AS opening,
        (SELECT COUNT(*) FROM users x WHERE x.tenant_id = t.id AND x.is_active)::int AS users,
        (EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t.id) OR EXISTS (SELECT 1 FROM pos_orders o WHERE o.tenant_id = t.id)) AS sale,
        (EXISTS (SELECT 1 FROM production_orders po WHERE po.tenant_id = t.id AND po.status = 'COMPLETED')
         OR EXISTS (SELECT 1 FROM pos_orders po2 JOIN pos_order_lines pl ON pl.order_id = po2.id WHERE po2.tenant_id = t.id AND pl.from_recipe)) AS production,
        EXISTS (SELECT 1 FROM users x WHERE x.id = ${sub} AND x.totp_enabled_at IS NOT NULL) AS security
      FROM tenants t WHERE t.id = ${tenantId}`);
  }
}
