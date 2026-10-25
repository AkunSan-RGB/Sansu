import { DbOrTx } from '../../db/db';
import type { SQL } from 'drizzle-orm';

/** Dipakai oleh TaxFocusService.count */
export function queryCount(db: DbOrTx, q: SQL<unknown>) {
  return db.execute<{ n: number }>(q);
}
