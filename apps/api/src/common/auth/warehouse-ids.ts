import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { warehouses } from '../../db/schema';

/** Pastikan daftar gudang milik perusahaan; [] / null = semua gudang (disimpan null) */
export async function normalizeWarehouseIds(db: DbOrTx, tenantId: string, ids: string[] | null | undefined): Promise<string[] | null | undefined> {
  if (ids === undefined) return undefined;
  if (!ids || !ids.length) return null;
  const uniq = [...new Set(ids)];
  const rows = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, uniq)));
  if (rows.length !== uniq.length) throw new BadRequestException('Ada gudang yang tidak ditemukan');
  return uniq;
}
