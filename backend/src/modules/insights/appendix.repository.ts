import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk Appendix: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AppendixRepository {
  /** Dipakai oleh AppendixService.build */
  queryStockBalance(db: DbOrTx, tenantId: string) {
    return db.execute<{ sku: string; name: string; category: string | null; qty: string; value: string }>(sql`
        SELECT p.sku, p.name, p.category, SUM(b.qty) AS qty, SUM(b.qty * b.avg_cost) AS value
        FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId}
        GROUP BY p.sku, p.name, p.category
        HAVING SUM(b.qty) <> 0 OR SUM(b.qty * b.avg_cost) <> 0
        ORDER BY p.name`);
  }
}
