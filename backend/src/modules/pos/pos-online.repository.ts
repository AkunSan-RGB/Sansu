import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { onlineApiKeys, posOrders, posPlatformSettlements } from '../../db/schema';
import { and, eq, isNull, sql, inArray, desc } from 'drizzle-orm';
import { createHash } from 'node:crypto';

export const hash = (k: string) => createHash('sha256').update(k).digest('hex');

/** Akses data untuk PosOnline: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosOnlineRepository {
  /** Dipakai oleh OnlineKeysService.revoke */
  updateOnlineApiKeysByIdAndRevokedAtAndName(db: DbOrTx, id: string, tenantId: string) {
    return db
      .update(onlineApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(onlineApiKeys.id, id), eq(onlineApiKeys.tenantId, tenantId), isNull(onlineApiKeys.revokedAt)))
      .returning({ id: onlineApiKeys.id, name: onlineApiKeys.name });
  }

  /** Dipakai oleh PlatformSettlementsService.unsettled */
  listPosOrdersBySettlementIdAndChannelAndDate(
    db: DbOrTx,
    tenantId: string,
    channel: 'OTHER' | 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD' | 'WEBSITE' | undefined,
  ) {
    return db
      .select()
      .from(posOrders)
      .where(
        and(
          eq(posOrders.tenantId, tenantId),
          isNull(posOrders.settlementId),
          channel ? eq(posOrders.channel, channel) : sql`${posOrders.channel} IS NOT NULL`,
        ),
      )
      .orderBy(posOrders.date, posOrders.number)
      .limit(1000);
  }

  /** Dipakai oleh PlatformSettlementsService.create */
  queryPosOrder(db: DbOrTx, ids: string[], tenantId: string) {
    return db.execute(
      sql`SELECT id FROM pos_orders WHERE id IN (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}) AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PlatformSettlementsService.create */
  listPosOrdersById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select()
      .from(posOrders)
      .where(and(eq(posOrders.tenantId, tenantId), inArray(posOrders.id, ids)));
  }

  /** Dipakai oleh PlatformSettlementsService.create */
  updatePosOrdersById(db: DbOrTx, id: string, ids: string[]) {
    return db.update(posOrders).set({ settlementId: id }).where(inArray(posOrders.id, ids));
  }

  /** Dipakai oleh PlatformSettlementsService.cancel */
  queryPosPlatformSettlement(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(
      sql`SELECT id FROM pos_platform_settlements WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PlatformSettlementsService.cancel */
  findPosPlatformSettlementsById(db: DbOrTx, id: string) {
    return db.select().from(posPlatformSettlements).where(eq(posPlatformSettlements.id, id));
  }

  /** Dipakai oleh PlatformSettlementsService.cancel */
  updatePosOrdersBySettlementId(db: DbOrTx, id: string) {
    return db.update(posOrders).set({ settlementId: null }).where(eq(posOrders.settlementId, id));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh OnlineKeysService.create */
  insertOnlineApiKeys(db: DbOrTx, tenantId: string, name: string, key: string, id: string, sub: string) {
    return db
      .insert(onlineApiKeys)
      .values({
        tenantId: tenantId,
        name: name.trim(),
        keyHash: hash(key),
        keyPrefix: key.slice(0, 8),
        warehouseId: id,
        createdById: sub,
      })
      .returning({ id: onlineApiKeys.id, name: onlineApiKeys.name, keyPrefix: onlineApiKeys.keyPrefix });
  }

  /** Dipakai oleh OnlineKeyGuard.canActivate */
  findOnlineApiKeysByKeyHash(db: DbOrTx, raw: string) {
    return db
      .select()
      .from(onlineApiKeys)
      .where(eq(onlineApiKeys.keyHash, hash(raw)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh OnlineKeysService.list */
  listOnlineApiKeysByCreatedAt(db: DbOrTx, tenantId: NonNullable<(typeof onlineApiKeys.$inferSelect)['tenantId']>) {
    return db
      .select({
        id: onlineApiKeys.id,
        name: onlineApiKeys.name,
        keyPrefix: onlineApiKeys.keyPrefix,
        warehouseId: onlineApiKeys.warehouseId,
        createdAt: onlineApiKeys.createdAt,
        lastUsedAt: onlineApiKeys.lastUsedAt,
        revokedAt: onlineApiKeys.revokedAt,
      })
      .from(onlineApiKeys)
      .where(eq(onlineApiKeys.tenantId, tenantId))
      .orderBy(desc(onlineApiKeys.createdAt));
  }

  /** Dipakai oleh PlatformSettlementsService.list */
  listPosPlatformSettlementsByDateAndNumber(
    db: DbOrTx,
    tenantId: NonNullable<(typeof posPlatformSettlements.$inferSelect)['tenantId']>,
  ) {
    return db
      .select()
      .from(posPlatformSettlements)
      .where(eq(posPlatformSettlements.tenantId, tenantId))
      .orderBy(desc(posPlatformSettlements.date), desc(posPlatformSettlements.number))
      .limit(200);
  }
}
