import { and, eq, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { DbOrTx } from './db';

/** Tabel yang punya kolom `id` dan `tenantId` (hampir semua tabel data perusahaan) */
export type OwnedTable = PgTable & { id: AnyColumn; tenantId: AnyColumn };
type Row<T extends OwnedTable> = T['$inferSelect'];

/** Satu baris milik perusahaan `tenantId` menurut id, atau undefined bila tidak ada / milik perusahaan lain */
export async function findOwned<T extends OwnedTable>(db: DbOrTx, table: T, tenantId: string, id: string): Promise<Row<T> | undefined> {
  const [row] = await db.select().from(table as OwnedTable).where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  return row as Row<T> | undefined;
}

/** Sama seperti `findOwned` tetapi mengunci baris (FOR UPDATE) sampai transaksi berakhir */
export async function lockOwned<T extends OwnedTable>(db: DbOrTx, table: T, tenantId: string, id: string): Promise<Row<T> | undefined> {
  const [row] = await db.select().from(table as OwnedTable).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).for('update');
  return row as Row<T> | undefined;
}
