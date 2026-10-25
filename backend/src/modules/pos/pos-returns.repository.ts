import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq } from 'drizzle-orm';
import { posOrders, posSessions, posOrderLines, posPayments, posReturnLines } from '../../db/schema';
import { Dec, D } from '../../common/utils/money';

/** Pesanan meja terbuka lebih lama dari ini dianggap menggantung */
export const STALE_TAB_HOURS = 12;

/** Akses data untuk PosReturns: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosReturnsRepository {
  /** Dipakai oleh PosReturnsService.create */
  queryPosOrder(db: DbOrTx, orderId: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM pos_orders WHERE id = ${orderId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PosReturnsService.create */
  findPosOrdersById(db: DbOrTx, orderId: string) {
    return db.select().from(posOrders).where(eq(posOrders.id, orderId));
  }

  /** Dipakai oleh PosReturnsService.create */
  findPosSessionsById(db: DbOrTx, sessionId: string) {
    return db.select().from(posSessions).where(eq(posSessions.id, sessionId));
  }

  /** Dipakai oleh PosReturnsService.create */
  listPosOrderLinesByOrderId(db: DbOrTx, orderId: string) {
    return db.select().from(posOrderLines).where(eq(posOrderLines.orderId, orderId));
  }

  /** Dipakai oleh PosReturnsService.create */
  queryPosReturn(db: DbOrTx, orderId: string) {
    return db.execute<{ total: string; tax: string }>(
      sql`SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(tax_amount), 0) AS tax FROM pos_returns WHERE order_id = ${orderId}`,
    );
  }

  /** Dipakai oleh PosReturnsService.create */
  listPosPaymentsByOrderId(db: DbOrTx, orderId: string) {
    return db.select().from(posPayments).where(eq(posPayments.orderId, orderId));
  }

  /** Dipakai oleh PosReturnsService.create */
  insertPosReturnLines(db: DbOrTx, id: string, pId: string, productId: string, qty: Dec) {
    return db
      .insert(posReturnLines)
      .values({ returnId: id, orderLineId: pId, productId: productId, qty: qty.toFixed(4), unitCost: '0' });
  }

  /** Dipakai oleh PosReturnsService.create */
  insertPosReturnLinesForCreate(db: DbOrTx, id: string, pId: string, productId: string, qty: Dec, unitCost: string) {
    return db.insert(posReturnLines).values({
      returnId: id,
      orderLineId: pId,
      productId: productId,
      qty: qty.toFixed(4),
      unitCost: D(unitCost).toFixed(4),
    });
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosSession(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; name: string; difference: string }>(sql`
      SELECT s.number, u.name, s.difference FROM pos_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.tenant_id = ${tenantId} AND s.status = 'CLOSED' AND s.difference <> 0 AND s.closed_at >= ${since}::date ORDER BY s.closed_at DESC`);
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosSessionForControls(db: DbOrTx, tenantId: string, posOpenHours: number) {
    return db.execute<{ number: string; name: string }>(sql`
      SELECT s.number, u.name FROM pos_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.tenant_id = ${tenantId} AND s.status = 'OPEN' AND s.opened_at < now() - make_interval(hours => ${posOpenHours})`);
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosReturnForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; total: string; reason: string }>(sql`
      SELECT r.number, r.total, r.reason FROM pos_returns r WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} ORDER BY r.date DESC`);
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosReturnForControls2(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; n: number }>(sql`
      SELECT s.number, COUNT(*)::int AS n FROM pos_returns r JOIN pos_sessions s ON s.id = r.session_id
      WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} GROUP BY s.number HAVING COUNT(*) >= 3`);
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosOrderLine(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; sku: string }>(sql`
      SELECT DISTINCT o.number, p.sku FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
      WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND NOT o.prices_include_vat AND l.qty > 0
        AND l.line_total / l.qty < l.unit_cost * l.uom_factor - 0.005 AND l.unit_cost > 0`);
  }

  /** Dipakai oleh PosControlsService.controls */
  queryPosTabLine(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{
      number: string;
      product: string;
      from_status: string;
      reason: string | null;
      by: string | null;
    }>(sql`
      SELECT t.number, p.name AS product, l.void_from_status AS from_status, l.void_reason AS reason, u.name AS by
      FROM pos_tab_lines l JOIN pos_tabs t ON t.id = l.tab_id JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.voided_by_id
      WHERE t.tenant_id = ${tenantId} AND l.status = 'VOID' AND l.void_from_status IN ('PREPARING', 'READY', 'SERVED') AND l.voided_at >= ${since}::date
      ORDER BY l.voided_at DESC`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PosControlsService.controls */
  queryPosTab(db: DbOrTx, tenantId: string) {
    return db.execute<{ number: string; label: string | null }>(sql`
      SELECT t.number, t.table_label AS label FROM pos_tabs t
      WHERE t.tenant_id = ${tenantId} AND t.status = 'OPEN' AND t.created_at < now() - make_interval(hours => ${STALE_TAB_HOURS})`);
  }
}
