import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { stockBalances, posSessions, tenants, customers, products, posOrderLines, posPayments } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { nowAt } from '../../common/utils/dates';
import { Dec } from '../../common/utils/money';
import { type PosPaymentMethod } from '@sansu/shared';
import type { RecipeComponent } from './recipe-issue';

/** Akses data untuk Pos: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosRepository {
  /** Dipakai oleh PosService.products */
  listStockBalancesByWarehouseId(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db
      .select({ productId: stockBalances.productId, qty: stockBalances.qty })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, warehouseId)));
  }

  /** Dipakai oleh PosService.open */
  findPosSessionsByUserIdAndStatus(db: DbOrTx, sub: string) {
    return db
      .select({ number: posSessions.number })
      .from(posSessions)
      .where(and(eq(posSessions.userId, sub), eq(posSessions.status, 'OPEN')));
  }

  /** Dipakai oleh PosService.createOrderTx */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh PosService.createOrderTx */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }

  /** Dipakai oleh PosService.createOrderTx */
  findProductsById(db: DbOrTx, productId: string) {
    return db.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, productId));
  }

  /** Dipakai oleh PosService.listSessions */
  queryPosOrder(db: DbOrTx, tenantId: string) {
    return db.execute<{ session_id: string; n: number; total: string }>(sql`
      SELECT session_id, COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total
      FROM pos_orders WHERE tenant_id = ${tenantId} GROUP BY session_id`);
  }

  /** Dipakai oleh PosService.close */
  updatePosSessionsById(
    db: DbOrTx,
    expected: Dec,
    counted: Dec,
    diff: Dec,
    notes: string | undefined,
    closeJournalId: string | undefined,
    id: string,
  ) {
    return db
      .update(posSessions)
      .set({
        status: 'CLOSED',
        closedAt: nowAt(21),
        expectedCash: expected.toFixed(2),
        countedCash: counted.toFixed(2),
        difference: diff.toFixed(2),
        notes: notes,
        closeJournalId: closeJournalId,
      })
      .where(eq(posSessions.id, id))
      .returning();
  }

  /** Dipakai oleh PosService.summary */
  queryPosPayment(db: DbOrTx, sessionId: string) {
    return db.execute<{ method: PosPaymentMethod; amount: string }>(sql`
      SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
      WHERE o.session_id = ${sessionId} GROUP BY p.method`);
  }

  /** Dipakai oleh PosService.summary */
  queryPosOrderForSummary(db: DbOrTx, sessionId: string) {
    return db.execute<{ n: number; total: string }>(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total FROM pos_orders WHERE session_id = ${sessionId}`);
  }

  /** Dipakai oleh PosService.summary */
  queryPosReturn(db: DbOrTx, sessionId: string) {
    return db.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(total - points_refund), 0) AS total FROM pos_returns WHERE session_id = ${sessionId} AND refund_method = 'CASH'`,
    );
  }

  /** Dipakai oleh PosService.lockSession */
  queryPosSession(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(sql`
      SELECT id FROM pos_sessions WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh PosService.lockSession */
  findPosSessionsById(db: DbOrTx, id: string) {
    return db.select().from(posSessions).where(eq(posSessions.id, id));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PosService.createOrderTx */
  insertPosOrderLines(
    db: DbOrTx,
    id: string,
    productId: string,
    uom: string,
    uomFactor: string,
    qty: string,
    price: Dec,
    discountPct: Dec,
    lineTotal: Dec,
    unitCost: Dec,
    recipe: RecipeComponent[] | undefined,
  ) {
    return db.insert(posOrderLines).values({
      orderId: id,
      productId: productId,
      uom: uom,
      uomFactor: uomFactor,
      qty: qty,
      price: price.toFixed(2),
      discountPct: discountPct.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      unitCost: unitCost.toFixed(4),
      fromRecipe: !!recipe,
    });
  }

  /** Dipakai oleh PosService.createOrderTx */
  insertPosPayments(db: DbOrTx, byMethod: Map<'TRANSFER' | 'CASH' | 'QRIS' | 'DEBIT' | 'PLATFORM', Dec>, id: string) {
    return db
      .insert(posPayments)
      .values([...byMethod].map(([method, amount]) => ({ orderId: id, method, amount: amount.toFixed(2) })));
  }
}
