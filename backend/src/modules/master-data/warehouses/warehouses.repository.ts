import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, and, eq, ne } from 'drizzle-orm';
import { stockBalances, warehouses } from '../../../db/schema';
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
      .set({ name: dto.name?.trim() || undefined, address: dto.address, isActive: dto.isActive })
      .where(eq(warehouses.id, id))
      .returning();
  }
}
