import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, inArray, and, desc, or } from 'drizzle-orm';
import { bomLines, products, boms, productionOrders, warehouses, productionOrderLines } from '../../db/schema';
import { qty4, money, D, Dec } from '../../common/utils/money';
import type { BomLineDto } from './production.dto';

/** Akses data untuk Production: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ProductionRepository {
  /** Dipakai oleh ProductionService.avgCosts */
  queryStockBalance(db: DbOrTx, tenantId: string, ids: string[]) {
    return db.execute<{ product_id: string; c: string | null }>(sql`
        SELECT product_id, SUM(qty * avg_cost) / NULLIF(SUM(qty), 0) AS c
        FROM stock_balances WHERE tenant_id = ${tenantId} AND qty > 0
          AND product_id IN (${sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )})
        GROUP BY product_id`);
  }

  /** Dipakai oleh ProductionService.listBoms */
  listBomLinesWithProductsByBomId(db: DbOrTx, rows: (typeof boms.$inferSelect)[]) {
    return db
      .select({
        id: bomLines.id,
        bomId: bomLines.bomId,
        productId: bomLines.productId,
        qty: bomLines.qty,
        sku: products.sku,
        name: products.name,
        unit: products.baseUom,
      })
      .from(bomLines)
      .innerJoin(products, eq(products.id, bomLines.productId))
      .where(
        inArray(
          bomLines.bomId,
          rows.map((r) => r.id),
        ),
      );
  }

  /** Dipakai oleh ProductionService.listBoms */
  listProductsById(db: DbOrTx, rows: (typeof boms.$inferSelect)[]) {
    return db
      .select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom })
      .from(products)
      .where(inArray(products.id, [...new Set(rows.map((r) => r.productId))]));
  }

  /** Dipakai oleh ProductionService.validateBom */
  listProductsByIdForValidateBom(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }

  /** Dipakai oleh ProductionService.createBom */
  findBomsByCode(db: DbOrTx, tenantId: string, code: string) {
    return db
      .select({ id: boms.id })
      .from(boms)
      .where(and(eq(boms.tenantId, tenantId), eq(boms.code, code)));
  }

  /** Dipakai oleh ProductionService.createBom */
  insertBoms(
    db: DbOrTx,
    tenantId: string,
    code: string,
    name: string,
    productId: string,
    outputQty: string,
    laborCost: string | undefined,
    overheadCost: string | undefined,
    notes: string | undefined,
  ) {
    return db
      .insert(boms)
      .values({
        tenantId: tenantId,
        code: code,
        name: name.trim(),
        productId: productId,
        outputQty: qty4(outputQty).toFixed(4),
        laborCost: money(laborCost ?? 0).toFixed(2),
        overheadCost: money(overheadCost ?? 0).toFixed(2),
        notes: notes,
      })
      .returning({ id: boms.id });
  }

  /** Dipakai oleh ProductionService.updateBom */
  deleteBomLinesByBomId(db: DbOrTx, id: string) {
    return db.delete(bomLines).where(eq(bomLines.bomId, id));
  }

  /** Dipakai oleh ProductionService.listOrders */
  listProductionOrdersWithBomsAndProductsByIdAndDateAndNumber(db: DbOrTx, tenantId: string, id: string | undefined) {
    return db
      .select({
        o: productionOrders,
        bomCode: boms.code,
        bomName: boms.name,
        sku: products.sku,
        name: products.name,
        unit: products.baseUom,
        warehouseName: warehouses.name,
      })
      .from(productionOrders)
      .innerJoin(boms, eq(boms.id, productionOrders.bomId))
      .innerJoin(products, eq(products.id, productionOrders.productId))
      .innerJoin(warehouses, eq(warehouses.id, productionOrders.warehouseId))
      .where(and(eq(productionOrders.tenantId, tenantId), id ? eq(productionOrders.id, id) : undefined))
      .orderBy(desc(productionOrders.date), desc(productionOrders.number))
      .limit(500);
  }

  /** Dipakai oleh ProductionService.listOrders */
  listProductionOrdersByIdAndParentOrderId(db: DbOrTx, tenantId: string, relIds: string[]) {
    return db
      .select({
        id: productionOrders.id,
        number: productionOrders.number,
        parentOrderId: productionOrders.parentOrderId,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          or(inArray(productionOrders.id, relIds), inArray(productionOrders.parentOrderId, relIds)),
        ),
      );
  }

  /** Dipakai oleh ProductionService.listOrders */
  listProductionOrderLinesWithProductsByOrderId(
    db: DbOrTx,
    rows: {
      o: {
        id: string;
        tenantId: string;
        number: string;
        date: string;
        bomId: string;
        productId: string;
        warehouseId: string;
        batches: string;
        plannedQty: string;
        status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
        parentOrderId: string | null;
        planNo: string | null;
        startedDate: string | null;
        completedDate: string | null;
        cancelledDate: string | null;
        outputQty: string;
        materialCost: string;
        laborCost: string;
        overheadCost: string;
        totalCost: string;
        unitCost: string;
        notes: string | null;
        startJournalId: string | null;
        completeJournalId: string | null;
        createdById: string | null;
        createdAt: Date;
      };
      bomCode: string;
      bomName: string;
      sku: string;
      name: string;
      unit: string;
      warehouseName: string;
    }[],
  ) {
    return db
      .select({ l: productionOrderLines, sku: products.sku, name: products.name, unit: products.baseUom })
      .from(productionOrderLines)
      .innerJoin(products, eq(products.id, productionOrderLines.productId))
      .where(
        inArray(
          productionOrderLines.orderId,
          rows.map((r) => r.o.id),
        ),
      );
  }

  /** Dipakai oleh ProductionService.createOrderIn */
  listBomLinesByBomId(db: DbOrTx, id: string) {
    return db.select().from(bomLines).where(eq(bomLines.bomId, id));
  }

  /** Dipakai oleh ProductionService.createOrderIn */
  insertProductionOrders(
    db: DbOrTx,
    tenantId: string,
    number: string,
    date: string,
    id: string,
    productId: string,
    whId: string,
    batches: Dec,
    outputQty: string,
    notes: string | undefined,
    sub: string,
    parentOrderId: string | undefined,
    planNo: string | undefined,
  ) {
    return db
      .insert(productionOrders)
      .values({
        tenantId: tenantId,
        number: number,
        date: date,
        bomId: id,
        productId: productId,
        warehouseId: whId,
        batches: batches.toFixed(4),
        plannedQty: qty4(D(outputQty).times(batches)).toFixed(4),
        notes: notes,
        createdById: sub,
        parentOrderId: parentOrderId ?? null,
        planNo: planNo ?? null,
      })
      .returning({ id: productionOrders.id });
  }

  /** Dipakai oleh ProductionService.createOrderIn */
  insertProductionOrderLines(db: DbOrTx, ls: (typeof bomLines.$inferSelect)[], id: string, batches: Dec) {
    return db.insert(productionOrderLines).values(
      ls.map((l) => ({
        orderId: id,
        productId: l.productId,
        plannedQty: qty4(D(l.qty).times(batches)).toFixed(4),
      })),
    );
  }

  /** Dipakai oleh ProductionService.lock */
  queryProductionOrder(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM production_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh ProductionService.lock */
  findProductionOrdersById(db: DbOrTx, id: string) {
    return db.select().from(productionOrders).where(eq(productionOrders.id, id));
  }

  /** Dipakai oleh ProductionService.start */
  listProductionOrdersByParentOrderIdAndStatus(db: DbOrTx, id: string) {
    return db
      .select({ number: productionOrders.number })
      .from(productionOrders)
      .where(and(eq(productionOrders.parentOrderId, id), inArray(productionOrders.status, ['DRAFT', 'IN_PROGRESS'])));
  }

  /** Dipakai oleh ProductionService.start */
  listProductionOrderLinesByOrderId(db: DbOrTx, id: string) {
    return db.select().from(productionOrderLines).where(eq(productionOrderLines.orderId, id));
  }

  /** Dipakai oleh ProductionService.complete */
  findBomsById(db: DbOrTx, bomId: string) {
    return db.select().from(boms).where(eq(boms.id, bomId));
  }

  /** Dipakai oleh ProductionService.complete */
  findProductsById(db: DbOrTx, productId: string) {
    return db
      .select({ shelf: products.shelfLifeDays, qc: products.qcRequired })
      .from(products)
      .where(eq(products.id, productId));
  }

  /** Dipakai oleh ProductionService.report */
  queryJournalLine(db: DbOrTx, tenantId: string, key: string, upTo: string, since: string | undefined) {
    return db.execute<{ v: string }>(sql`
          SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
          FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
          WHERE j.tenant_id = ${tenantId} AND a.system_key = ${key} AND j.date <= ${upTo} ${since ? sql`AND j.date >= ${since}` : sql``}
            AND j.source_type <> 'CLOSING'`);
  }

  /** Dipakai oleh ProductionService.report */
  queryProductionOrderForReport(db: DbOrTx, from: string, to: string, tenantId: string) {
    return db.execute<{ issued: string; returned: string }>(sql`
        SELECT COALESCE(SUM(material_cost) FILTER (WHERE started_date BETWEEN ${from} AND ${to}), 0) AS issued,
               COALESCE(SUM(material_cost) FILTER (WHERE status = 'CANCELLED' AND started_date IS NOT NULL AND cancelled_date BETWEEN ${from} AND ${to}), 0) AS returned
        FROM production_orders WHERE tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh ProductionService.report */
  listProductionOrdersByStatusAndCompletedDate(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db
      .select()
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          eq(productionOrders.status, 'COMPLETED'),
          sql`${productionOrders.completedDate} BETWEEN ${from} AND ${to}`,
        ),
      );
  }

  /** Dipakai oleh ProductionService.report */
  listProductsByIdForReport(db: DbOrTx, prodIds: string[]) {
    return db
      .select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom })
      .from(products)
      .where(inArray(products.id, prodIds));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ProductionService.createBom */
  insertBomLines(db: DbOrTx, lines: BomLineDto[], id: string) {
    return db
      .insert(bomLines)
      .values(lines.map((l) => ({ bomId: id, productId: l.productId, qty: qty4(l.qty).toFixed(4) })));
  }
}
