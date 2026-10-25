import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk AssetReports: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AssetReportsRepository {
  /** Dipakai oleh AssetReportsService.reconciliation */
  queryJournalLine(db: DbOrTx, tenantId: string, date: string, ids: string[]) {
    return db.execute<{ account_id: string; debit: string; credit: string }>(sql`
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND j.date <= ${date} AND l.account_id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})
        GROUP BY l.account_id`);
  }

  /** Dipakai oleh AssetReportsService.controls */
  queryLine(db: DbOrTx, tenantId: string, threshold: number, today: string) {
    return db.execute<{ supplier: string; n: number; total: string; first: string; last: string }>(sql`
        WITH lines AS (
          SELECT s.name AS supplier, j.date, l.debit
          FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
          JOIN purchase_invoices i ON i.id::text = j.source_id AND j.source_type = 'PURCHASE_INVOICE' JOIN suppliers s ON s.id = i.supplier_id
          WHERE j.tenant_id = ${tenantId} AND a.system_key = 'SMALL_ASSET_EXPENSE' AND l.debit >= ${threshold * 0.7} AND l.debit < ${threshold}
            AND j.date >= ${addDays(today, -60)}
        )
        SELECT a.supplier, COUNT(*)::int AS n, SUM(a.debit)::text AS total, MIN(a.date)::text AS first, MAX(a.date)::text AS last
        FROM lines a JOIN lines b ON b.supplier = a.supplier AND b.date BETWEEN a.date - 14 AND a.date + 14
        GROUP BY a.supplier HAVING COUNT(DISTINCT (a.date, a.debit)) >= 2 AND SUM(a.debit) >= ${threshold}`);
  }

  /** Dipakai oleh AssetReportsService.controls */
  queryFixedAsset(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{
      code: string;
      name: string;
      acq: string;
      disp: string;
      cost: string;
      opening: string;
      dep: string;
      price: string;
    }>(sql`
      SELECT f.code, f.name, f.acquisition_date::text AS acq, f.disposal_date::text AS disp, f.cost::text AS cost, f.opening_accumulated::text AS opening, f.disposal_price::text AS price,
        COALESCE((SELECT SUM(d.amount) FROM asset_depreciations d WHERE d.asset_id = f.id), 0)::text AS dep
      FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.status = 'DISPOSED' AND f.disposal_date >= ${addDays(today, -180)}
      ORDER BY f.disposal_date DESC`);
  }

  /** Dipakai oleh AssetReportsService.rollForward */
  queryAssetDepreciation(db: DbOrTx, year: number, tenantId: string) {
    return db.execute<{ asset_id: string; before: string; during: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period < ${`${year}-01`}), 0) AS before,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
  }

  /** Dipakai oleh AssetReportsService.fiscalComparison */
  queryAssetDepreciationForFiscalComparison(db: DbOrTx, year: number, tenantId: string) {
    return db.execute<{ asset_id: string; during: string; upto: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during,
             COALESCE(SUM(amount) FILTER (WHERE period <= ${`${year}-12`}), 0) AS upto
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
  }
}
