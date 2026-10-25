import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk InventoryMethod: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class InventoryMethodRepository {
  /** Dipakai oleh InventoryMethodService.set */
  queryStockLayer(db: DbOrTx, tenantId: string) {
    return db.execute(sql`DELETE FROM stock_layers WHERE tenant_id = ${tenantId}`);
  }
}
