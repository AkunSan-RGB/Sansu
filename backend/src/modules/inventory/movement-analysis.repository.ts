import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk MovementAnalysis: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class MovementAnalysisRepository {
  /** Dipakai oleh MovementAnalysisService.analyze */
  queryProduct(db: DbOrTx, tenantId: string, wh: SQL<unknown>, since: string) {
    return db.execute<{
      id: string;
      sku: string;
      name: string;
      category: string | null;
      base_uom: string;
      on_hand: string;
      value: string;
      net_out: string | null;
      last_out: string | null;
      first_move: string | null;
    }>(sql`
      SELECT p.id, p.sku, p.name, p.category, p.base_uom,
             COALESCE(b.qty, 0) AS on_hand, COALESCE(b.value, 0) AS value,
             m.net_out, m.last_out::text AS last_out, m.first_move::text AS first_move
      FROM products p
      LEFT JOIN (
        SELECT product_id, SUM(qty) AS qty, SUM(qty * avg_cost) AS value
        FROM stock_balances WHERE tenant_id = ${tenantId} ${wh} GROUP BY product_id
      ) b ON b.product_id = p.id
      LEFT JOIN (
        SELECT product_id,
               -SUM(qty) FILTER (WHERE type IN ('SALE', 'SALE_RETURN', 'PRODUCTION_ISSUE', 'PRODUCTION_RETURN') AND date >= ${since}) AS net_out,
               MAX(date) FILTER (WHERE type IN ('SALE', 'PRODUCTION_ISSUE')) AS last_out,
               MIN(date) AS first_move
        FROM stock_moves WHERE tenant_id = ${tenantId} ${wh} GROUP BY product_id
      ) m ON m.product_id = p.id
      WHERE p.tenant_id = ${tenantId} AND p.is_active AND (b.product_id IS NOT NULL OR m.product_id IS NOT NULL)`);
  }
}
