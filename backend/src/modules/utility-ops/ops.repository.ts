import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';

/** Jalankan kueri dan kembalikan barisnya (dipakai repositori layanan air lanjutan) */
export async function rowsOf<T = Record<string, unknown>>(db: DbOrTx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)).rows as T[];
}
export async function firstOf<T = Record<string, unknown>>(db: DbOrTx, q: ReturnType<typeof sql>): Promise<T | undefined> {
  return (await rowsOf<T>(db, q))[0];
}
/** Daftar nilai untuk klausa IN (...) */
export const inList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
export const dateOnly = (v: string | Date | null | undefined): string | null => (v ? (typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10)) : null);
