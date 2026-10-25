import { DbOrTx } from '../../db/db';
import type { SQL } from 'drizzle-orm';

export type Row = Record<string, string | null>;

/** Dipakai oleh source-document.q */
export function queryQ(db: DbOrTx, query: SQL<unknown>) {
  return db.execute<Row>(query);
}
