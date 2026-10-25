import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { warehouses, marketplaceConnections, products, users, marketplaceOrders } from '../../../db/schema';
import { and, eq, inArray, desc, asc } from 'drizzle-orm';
import { type ProviderKey, type Tokens, type NormalizedOrder } from './providers';
import { UpdateConnectionDto } from './sync.dto';

/** Akses data untuk Sync: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SyncRepository {
  /** Dipakai oleh MarketplaceSyncService.assertWarehouse */
  findWarehousesById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
  }

  /** Dipakai oleh MarketplaceSyncService.save */
  listMarketplaceConnectionsByProvider(db: DbOrTx, tenantId: string, provider: ProviderKey) {
    return db
      .select({ shopId: marketplaceConnections.shopId })
      .from(marketplaceConnections)
      .where(and(eq(marketplaceConnections.tenantId, tenantId), eq(marketplaceConnections.provider, provider)));
  }

  /** Dipakai oleh MarketplaceSyncService.save */
  insertMarketplaceConnections(
    db: DbOrTx,
    tenantId: string,
    provider: ProviderKey,
    channel: string,
    shop: Tokens & { shopId: string; shopName: string },
    credentials: string,
    warehouseId: string,
    pricesIncludeVat: boolean,
    userId: string,
  ) {
    return db
      .insert(marketplaceConnections)
      .values({
        tenantId: tenantId,
        provider: provider,
        channel: channel,
        shopId: shop.shopId,
        shopName: shop.shopName,
        credentials: credentials,
        tokenExpiresAt: shop.expiresAt ?? null,
        warehouseId: warehouseId,
        pricesIncludeVat: pricesIncludeVat,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [marketplaceConnections.tenantId, marketplaceConnections.provider, marketplaceConnections.shopId],
        set: {
          shopName: shop.shopName,
          credentials: credentials,
          tokenExpiresAt: shop.expiresAt ?? null,
          warehouseId: warehouseId,
          pricesIncludeVat: pricesIncludeVat,
          isActive: true,
          lastError: null,
        },
      })
      .returning();
  }

  /** Dipakai oleh MarketplaceSyncService.update */
  updateMarketplaceConnectionsById(db: DbOrTx, dto: UpdateConnectionDto, id: string, tenantId: string) {
    return db
      .update(marketplaceConnections)
      .set(dto)
      .where(and(eq(marketplaceConnections.id, id), eq(marketplaceConnections.tenantId, tenantId)))
      .returning({ id: marketplaceConnections.id });
  }

  /** Dipakai oleh MarketplaceSyncService.remove */
  deleteMarketplaceConnectionsById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .delete(marketplaceConnections)
      .where(and(eq(marketplaceConnections.id, id), eq(marketplaceConnections.tenantId, tenantId)))
      .returning({ id: marketplaceConnections.id });
  }

  /** Dipakai oleh MarketplaceSyncService.ctx */
  listProductsByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ sku: products.sku, price: products.sellPrice })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
      .limit(200);
  }

  /** Dipakai oleh MarketplaceSyncService.actor */
  findUsersByIdAndIsActive(db: DbOrTx, createdBy: string) {
    return db
      .select()
      .from(users)
      .where(and(eq(users.id, createdBy), eq(users.isActive, true)));
  }

  /** Dipakai oleh MarketplaceSyncService.actor */
  findUsersByRoleAndIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)))
      .limit(1);
  }

  /** Dipakai oleh MarketplaceSyncService.process */
  listMarketplaceOrdersByChannelAndOrderNo(db: DbOrTx, tenantId: string, channel: string, orders: NormalizedOrder[]) {
    return db
      .select({ orderNo: marketplaceOrders.orderNo })
      .from(marketplaceOrders)
      .where(
        and(
          eq(marketplaceOrders.tenantId, tenantId),
          eq(marketplaceOrders.channel, channel),
          inArray(
            marketplaceOrders.orderNo,
            orders.map((o) => o.orderNo),
          ),
        ),
      );
  }

  /** Dipakai oleh MarketplaceSyncService.syncAll */
  listMarketplaceConnectionsByIsActiveAndLastSyncAt(db: DbOrTx) {
    return db
      .select()
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.isActive, true))
      .orderBy(desc(marketplaceConnections.lastSyncAt));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh MarketplaceSyncService.list */
  listMarketplaceConnectionsWithWarehousesByCreatedAt(
    db: DbOrTx,
    tenantId: NonNullable<(typeof marketplaceConnections.$inferSelect)['tenantId']>,
  ) {
    return db
      .select({
        id: marketplaceConnections.id,
        provider: marketplaceConnections.provider,
        channel: marketplaceConnections.channel,
        shopId: marketplaceConnections.shopId,
        shopName: marketplaceConnections.shopName,
        warehouseId: marketplaceConnections.warehouseId,
        warehouseName: warehouses.name,
        pricesIncludeVat: marketplaceConnections.pricesIncludeVat,
        isActive: marketplaceConnections.isActive,
        tokenExpiresAt: marketplaceConnections.tokenExpiresAt,
        syncedUntil: marketplaceConnections.syncedUntil,
        lastSyncAt: marketplaceConnections.lastSyncAt,
        lastResult: marketplaceConnections.lastResult,
        lastError: marketplaceConnections.lastError,
        createdAt: marketplaceConnections.createdAt,
      })
      .from(marketplaceConnections)
      .innerJoin(warehouses, eq(warehouses.id, marketplaceConnections.warehouseId))
      .where(eq(marketplaceConnections.tenantId, tenantId))
      .orderBy(asc(marketplaceConnections.createdAt));
  }
}
