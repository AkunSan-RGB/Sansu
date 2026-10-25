import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Kenaikan harga beli terbaru terhadap rata-rata 90 hari sebelumnya yang ditandai */
export const PRICE_JUMP_PCT = 10;

/** Akses data untuk ShoppingList: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ShoppingListRepository {
  /** Dipakai oleh ShoppingListService.list */
  queryProduct(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; days: number | null }>(
      sql`SELECT id, shelf_life_days AS days FROM products WHERE tenant_id = ${tenantId} AND shelf_life_days IS NOT NULL`,
    );
  }

  /** Dipakai oleh ShoppingListService.priceAlerts */
  queryProductForPriceAlerts(db: DbOrTx, tenantId: string) {
    return db.execute<{
      sku: string;
      name: string;
      supplier: string;
      latest: string;
      avg: string;
      pct: string;
      date: string;
    }>(sql`
      WITH p AS (
        SELECT l.product_id, o.supplier_id, o.date, (l.price * (1 - l.discount_pct / 100) / NULLIF(l.uom_factor, 0)) AS base_price,
               ROW_NUMBER() OVER (PARTITION BY l.product_id ORDER BY o.date DESC, o.created_at DESC) AS rn
        FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
        WHERE o.tenant_id = ${tenantId} AND o.status <> 'CANCELLED' AND o.date >= CURRENT_DATE - 120)
      SELECT pr.sku, pr.name, s.name AS supplier, latest.base_price AS latest, avg_prev.v AS avg, ROUND((latest.base_price / avg_prev.v - 1) * 100, 1) AS pct, latest.date::text AS date
      FROM (SELECT * FROM p WHERE rn = 1 AND date >= CURRENT_DATE - 30) latest
      JOIN LATERAL (SELECT AVG(base_price) AS v FROM p WHERE p.product_id = latest.product_id AND p.rn > 1 AND p.date < latest.date AND p.date >= latest.date - 90) avg_prev ON avg_prev.v IS NOT NULL
      JOIN products pr ON pr.id = latest.product_id JOIN suppliers s ON s.id = latest.supplier_id
      WHERE latest.base_price > avg_prev.v * (1 + ${PRICE_JUMP_PCT} / 100.0)
      ORDER BY pct DESC LIMIT 30`);
  }
}
