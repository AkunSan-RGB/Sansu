import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, and, eq, ne, inArray, asc } from 'drizzle-orm';
import { priceLists, stockBalances, warehouses } from '../../../db/schema';
import { UpdateWarehouseDto } from './warehouses.dto';

/** Akses data untuk Warehouses: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class WarehousesRepository {
  /** Dipakai oleh WarehousesService.update */
  countStockBalancesByWarehouseIdAndQty(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, id), ne(stockBalances.qty, '0')));
  }

  /** Dipakai oleh WarehousesService.update */
  findWarehousesByIsActiveAndId(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true), ne(warehouses.id, id)));
  }

  /** Dipakai oleh WarehousesService.update */
  updateWarehousesById(db: DbOrTx, dto: UpdateWarehouseDto, id: string) {
    return db
      .update(warehouses)
      .set({ name: dto.name?.trim() || undefined, address: dto.address, isActive: dto.isActive, priceListId: dto.priceListId })
      .where(eq(warehouses.id, id))
      .returning();
  }

  /** Dipakai oleh WarehousesService.update */
  async findPriceListInTenant(db: DbOrTx, tenantId: string, priceListId: string) {
    const [r] = await db.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, priceListId)));
    return r ?? null;
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh WarehousesService.list */
  listWarehousesByIdAndCode(
    db: DbOrTx,
    tenantId: NonNullable<(typeof warehouses.$inferSelect)['tenantId']>,
    allowed: string[] | null,
  ) {
    return db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), allowed ? inArray(warehouses.id, allowed) : undefined))
      .orderBy(asc(warehouses.code));
  }
}
