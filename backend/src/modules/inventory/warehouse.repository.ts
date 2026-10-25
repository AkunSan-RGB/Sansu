import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { stockTransfers } from '../../db/schema';

/** Akses data transfer gudang. */
@Injectable()
export class WarehouseRepository {
  async transferById(db: DbOrTx, id: string) {
    const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
    return t;
  }
}
