import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { onlineApiKeys, posOrders, posPlatformSettlements } from '../../db/schema';
import { and, eq, isNull, sql, inArray } from 'drizzle-orm';

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
}
