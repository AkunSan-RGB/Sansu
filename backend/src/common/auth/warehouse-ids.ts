import { BadRequestException } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { listWarehousesById } from './warehouse-ids.repository';

/** Pastikan daftar gudang milik perusahaan; [] / null = semua gudang (disimpan null) */
export async function normalizeWarehouseIds(
  db: DbOrTx,
  tenantId: string,
  ids: string[] | null | undefined,
): Promise<string[] | null | undefined> {
  if (ids === undefined) return undefined;
  if (!ids || !ids.length) return null;
  const uniq = [...new Set(ids)];
  const rows = await listWarehousesById(db, tenantId, uniq);
  if (rows.length !== uniq.length) throw new BadRequestException('Ada gudang yang tidak ditemukan');
  return uniq;
}
