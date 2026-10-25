import { and, eq, type AnyColumn } from 'drizzle-orm';
import type { PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
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

/** Tabel yang punya kolom `id` */
type IdTable = PgTable & { id: AnyColumn };

/** Ubah satu baris menurut id (tanpa mengembalikan baris); `patch` hanya berisi kolom yang diubah */
export async function patchById<T extends IdTable>(db: DbOrTx, table: T, id: string, patch: PgUpdateSetSource<T>): Promise<void> {
  await db.update(table as IdTable).set(patch as never).where(eq(table.id, id));
}

/** Sisipkan satu baris dan kembalikan baris tersimpan (dengan nilai bawaan dari database) */
export async function insertOne<T extends PgTable>(db: DbOrTx, table: T, values: T['$inferInsert']): Promise<T['$inferSelect']> {
  const [row] = await db.insert(table).values(values).returning();
  return row as T['$inferSelect'];
}
