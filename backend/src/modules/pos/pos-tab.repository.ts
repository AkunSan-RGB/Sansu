import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { posTabLines, posTables, posTabs } from '../../db/schema';

type TabPatch = Partial<typeof posTabs.$inferInsert>;
type LinePatch = Partial<typeof posTabLines.$inferInsert>;

/** Akses data meja, pesanan terbuka (tab), dan barisnya. Setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosTabRepository {
  async tableCodeExists(db: DbOrTx, warehouseId: string, code: string) {
    const [dup] = await db.select({ id: posTables.id }).from(posTables).where(and(eq(posTables.warehouseId, warehouseId), eq(posTables.code, code)));
    return !!dup;
  }

  /** Nomor pesanan terbuka di meja ini (kosong bila meja bebas) */
  async openTabNumberAtTable(db: DbOrTx, tableId: string): Promise<string | undefined> {
    const [open] = await db.select({ n: posTabs.number }).from(posTabs).where(and(eq(posTabs.tableId, tableId), eq(posTabs.status, 'OPEN')));
    return open?.n;
  }

  async tabById(db: DbOrTx, id: string) {
    const [tab] = await db.select().from(posTabs).where(eq(posTabs.id, id));
    return tab;
  }

  async patchTab(db: DbOrTx, id: string, patch: TabPatch) {
    await db.update(posTabs).set(patch).where(eq(posTabs.id, id));
  }

  linesOfTab(db: DbOrTx, tabId: string) {
    return db.select().from(posTabLines).where(eq(posTabLines.tabId, tabId));
  }

  async lineById(db: DbOrTx, lineId: string) {
    const [line] = await db.select().from(posTabLines).where(eq(posTabLines.id, lineId));
    return line;
  }

  async lineOfTab(db: DbOrTx, tabId: string, lineId: string) {
    const [line] = await db.select().from(posTabLines).where(and(eq(posTabLines.id, lineId), eq(posTabLines.tabId, tabId)));
    return line;
  }

  async patchLine(db: DbOrTx, lineId: string, patch: LinePatch) {
    await db.update(posTabLines).set(patch).where(eq(posTabLines.id, lineId));
  }

  async deleteLine(db: DbOrTx, lineId: string) {
    await db.delete(posTabLines).where(eq(posTabLines.id, lineId));
  }

  async markLinesPaid(db: DbOrTx, lineIds: string[], orderId: string) {
    await db.update(posTabLines).set({ paidOrderId: orderId }).where(inArray(posTabLines.id, lineIds));
  }
}
