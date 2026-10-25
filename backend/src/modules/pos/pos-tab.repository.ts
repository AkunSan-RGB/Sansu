import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { posTabLines, posTables, posTabs, products, accounts, type PosTabLineStatus } from '../../db/schema';
import { WarehouseQueryDto, UpdateTableDto, TabLineInputDto, CreateTabDto } from './pos-tabs.dto';
import { qty4, Dec } from '../../common/utils/money';

type TabPatch = Partial<typeof posTabs.$inferInsert>;
type LinePatch = Partial<typeof posTabLines.$inferInsert>;

/** Akses data meja, pesanan terbuka (tab), dan barisnya. Setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosTabRepository {
  async tableCodeExists(db: DbOrTx, warehouseId: string, code: string) {
    const [dup] = await db
      .select({ id: posTables.id })
      .from(posTables)
      .where(and(eq(posTables.warehouseId, warehouseId), eq(posTables.code, code)));
    return !!dup;
  }

  /** Nomor pesanan terbuka di meja ini (kosong bila meja bebas) */
  async openTabNumberAtTable(db: DbOrTx, tableId: string): Promise<string | undefined> {
    const [open] = await db
      .select({ n: posTabs.number })
      .from(posTabs)
      .where(and(eq(posTabs.tableId, tableId), eq(posTabs.status, 'OPEN')));
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
    const [line] = await db
      .select()
      .from(posTabLines)
      .where(and(eq(posTabLines.id, lineId), eq(posTabLines.tabId, tabId)));
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

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PosTabsService.listTables */
  queryPosTable(db: DbOrTx, tenantId: string, q: WarehouseQueryDto, allowed: string[] | null) {
    return db.execute<{
      id: string;
      warehouse_id: string;
      warehouse_code: string;
      code: string;
      name: string;
      seats: number | null;
      is_active: boolean;
      tab_id: string | null;
      tab_number: string | null;
      tab_since: string | null;
      items: number | null;
      amount: string | null;
    }>(sql`
      SELECT t.id, t.warehouse_id, w.code AS warehouse_code, t.code, t.name, t.seats, t.is_active,
             b.id AS tab_id, b.number AS tab_number, b.created_at::text AS tab_since,
             (SELECT COUNT(*)::int FROM pos_tab_lines l WHERE l.tab_id = b.id AND l.status <> 'VOID' AND l.paid_order_id IS NULL) AS items,
             (SELECT COALESCE(SUM(l.qty * p.sell_price), 0)::text FROM pos_tab_lines l JOIN products p ON p.id = l.product_id
                WHERE l.tab_id = b.id AND l.status <> 'VOID' AND l.paid_order_id IS NULL) AS amount
      FROM pos_tables t
      JOIN warehouses w ON w.id = t.warehouse_id
      LEFT JOIN pos_tabs b ON b.table_id = t.id AND b.status = 'OPEN'
      WHERE t.tenant_id = ${tenantId}
        ${q.warehouseId ? sql`AND t.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND t.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY w.code, t.code`);
  }

  /** Dipakai oleh PosTabsService.updateTable */
  updatePosTablesById(db: DbOrTx, dto: UpdateTableDto, id: string) {
    return db
      .update(posTables)
      .set({ name: dto.name?.trim(), seats: dto.seats, isActive: dto.isActive })
      .where(eq(posTables.id, id))
      .returning();
  }

  /** Dipakai oleh PosTabsService.lockTab */
  queryPosTab(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM pos_tabs WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PosTabsService.checkProducts */
  listProductsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id, sku: products.sku, isActive: products.isActive, kind: products.inventoryKind })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }

  /** Dipakai oleh PosTabsService.insertLines */
  insertPosTabLines(db: DbOrTx, lines: TabLineInputDto[], tabId: string) {
    return db
      .insert(posTabLines)
      .values(
        lines.map((l) => ({
          tabId: tabId,
          productId: l.productId,
          qty: qty4(l.qty).toFixed(4),
          notes: l.notes?.trim() || null,
        })),
      );
  }

  /** Dipakai oleh PosTabsService.assertOnlineReady */
  listAccountsBySystemKey(db: DbOrTx, tenantId: string) {
    return db
      .select({ k: accounts.systemKey })
      .from(accounts)
      .where(
        and(eq(accounts.tenantId, tenantId), inArray(accounts.systemKey, ['PLATFORM_RECEIVABLE', 'PLATFORM_FEE'])),
      );
  }

  /** Dipakai oleh PosTabsService.createTx */
  insertPosTabs(
    db: DbOrTx,
    tenantId: string,
    number: string,
    id: string,
    dto: CreateTabDto,
    label: string | null,
    online: boolean,
    orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY',
    sub: string,
  ) {
    return db
      .insert(posTabs)
      .values({
        tenantId: tenantId,
        number: number,
        warehouseId: id,
        tableId: dto.tableId ?? null,
        tableLabel: label,
        channel: dto.channel ?? null,
        externalRef: online ? dto.externalRef!.trim() : null,
        orderType: orderType,
        guestName: dto.guestName?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: sub,
      })
      .returning();
  }

  /** Dipakai oleh PosTabsService.receiveOnline */
  listProductsBySku(db: DbOrTx, tenantId: string, skus: string[]) {
    return db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.sku, skus)));
  }

  /** Dipakai oleh PosTabsService.assertAvailable */
  listPosTabLinesWithPosTabsByStatusAndPaidOrderId(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db
      .select({ productId: posTabLines.productId, qty: posTabLines.qty })
      .from(posTabLines)
      .innerJoin(posTabs, eq(posTabs.id, posTabLines.tabId))
      .where(
        and(
          eq(posTabs.tenantId, tenantId),
          eq(posTabs.warehouseId, warehouseId),
          eq(posTabs.status, 'OPEN'),
          inArray(posTabLines.status, ['NEW', 'PREPARING', 'READY', 'SERVED']),
          sql`${posTabLines.paidOrderId} IS NULL`,
        ),
      );
  }

  /** Dipakai oleh PosTabsService.assertAvailable */
  listProductsByIdForAssertAvailable(db: DbOrTx, tenantId: string, all: { productId: string; qty: Dec }[]) {
    return db
      .select({ id: products.id, sku: products.sku, madeToOrder: products.madeToOrder })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(all.map((a) => a.productId))])));
  }

  /** Dipakai oleh PosTabsService.sendTx */
  listPosTabLinesByTabIdAndStatus(db: DbOrTx, id: string) {
    return db
      .select()
      .from(posTabLines)
      .where(and(eq(posTabLines.tabId, id), eq(posTabLines.status, 'DRAFT')));
  }

  /** Dipakai oleh PosTabsService.sendTx */
  listProductsByIdAndMadeToOrder(db: DbOrTx, drafts: (typeof posTabLines.$inferSelect)[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, [...new Set(drafts.map((d) => d.productId))]), eq(products.madeToOrder, true)));
  }

  /** Dipakai oleh PosTabsService.setLineStatus */
  queryPosTabLine(db: DbOrTx, lineId: string, tenantId: string) {
    return db.execute<{ tab_id: string }>(sql`
        SELECT l.tab_id FROM pos_tab_lines l JOIN pos_tabs t ON t.id = l.tab_id WHERE l.id = ${lineId} AND t.tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh PosTabsService.kitchen */
  queryPosTabLineForKitchen(db: DbOrTx, tenantId: string, q: WarehouseQueryDto, allowed: string[] | null) {
    return db.execute<{
      line_id: string;
      tab_id: string;
      number: string;
      table_label: string | null;
      order_type: string;
      guest_name: string | null;
      warehouse_id: string;
      channel: string | null;
      product: string;
      sku: string;
      qty: string;
      notes: string | null;
      status: PosTabLineStatus;
      sent_at: string;
      paid: boolean;
    }>(sql`
      SELECT l.id AS line_id, t.id AS tab_id, t.number, t.table_label, t.order_type, t.guest_name, t.warehouse_id, t.channel,
             p.name AS product, p.sku, l.qty, l.notes, l.status, l.sent_at::text AS sent_at, (l.paid_order_id IS NOT NULL) AS paid
      FROM pos_tab_lines l
      JOIN pos_tabs t ON t.id = l.tab_id
      JOIN products p ON p.id = l.product_id
      WHERE t.tenant_id = ${tenantId} AND t.status IN ('OPEN', 'PAID') AND l.status IN ('NEW', 'PREPARING', 'READY')
        ${q.warehouseId ? sql`AND t.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND t.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY l.sent_at, l.id`);
  }
}
