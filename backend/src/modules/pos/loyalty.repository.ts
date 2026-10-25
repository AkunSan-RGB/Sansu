import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { todayJakarta } from '../../common/utils/dates';
import { expiryDate, type LoyaltySettings } from '@sansu/shared';
import type { Decimal } from 'decimal.js';

export type Lot = { id: string; remaining: number; value: string; points: number };

/** Akses data untuk Loyalty: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class LoyaltyRepository {
  /** Dipakai oleh LoyaltyService.balance */
  queryLoyaltyLedger(db: DbOrTx, tenantId: string, customerId: string) {
    return db.execute<{ p: string }>(
      sql`SELECT COALESCE(SUM(points), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}`,
    );
  }

  /** Dipakai oleh LoyaltyService.lockCustomer */
  queryCustomer(db: DbOrTx, customerId: string, tenantId: string) {
    return db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh LoyaltyService.lots */
  queryLoyaltyLedgerForLots(db: DbOrTx, tenantId: string, customerId: string) {
    return db.execute<{ id: string; remaining: number; value: string; points: number }>(sql`
      SELECT id, remaining, value, points FROM loyalty_ledger
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0
      ORDER BY expires_on NULLS LAST, created_at, id`);
  }

  /** Dipakai oleh LoyaltyService.consume */
  queryConsume(db: DbOrTx, take: number, id: string) {
    return db.execute(sql`UPDATE loyalty_ledger SET remaining = remaining - ${take} WHERE id = ${id}`);
  }

  /** Dipakai oleh LoyaltyService.expireLots */
  queryExpireLots(db: DbOrTx, id: string) {
    return db.execute(sql`UPDATE loyalty_ledger SET remaining = 0 WHERE id = ${id}`);
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryLoyaltyLedgerForReturnTx(db: DbOrTx, orderId: string) {
    return db.execute<{ kind: string; p: string; v: string }>(
      sql`SELECT kind, COALESCE(SUM(points), 0) AS p, COALESCE(SUM(value), 0) AS v FROM loyalty_ledger WHERE order_id = ${orderId} AND kind IN ('REVERSE', 'REFUND') GROUP BY kind`,
    );
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryLoyaltyLedgerForReturnTx2(db: DbOrTx, orderId: string) {
    return db.execute<{ value: string; points: number }>(
      sql`SELECT value, points FROM loyalty_ledger WHERE order_id = ${orderId} AND kind = 'EARN'`,
    );
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryLoyaltyLedgerForReturnTx3(db: DbOrTx, orderId: string) {
    return db.execute<{ id: string; remaining: number }>(
      sql`SELECT id, remaining FROM loyalty_ledger WHERE order_id = ${orderId} AND kind = 'EARN' FOR UPDATE`,
    );
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryReturnTx(db: DbOrTx, fromLot: number, id: string) {
    return db.execute(sql`UPDATE loyalty_ledger SET remaining = remaining - ${fromLot} WHERE id = ${id}`);
  }

  /** Dipakai oleh LoyaltyService.member */
  queryCustomerForMember(db: DbOrTx, customerId: string, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; phone: string | null }>(
      sql`SELECT id, code, name, phone FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh LoyaltyService.member */
  queryLoyaltyLedgerForMember(db: DbOrTx, tenantId: string, customerId: string) {
    return db.execute<{ p: string }>(
      sql`SELECT COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${todayJakarta()}`,
    );
  }

  /** Dipakai oleh LoyaltyService.member */
  queryLoyaltyLedgerForMember2(db: DbOrTx, tenantId: string, customerId: string) {
    return db.execute<{ expires_on: string; remaining: number }>(
      sql`SELECT expires_on, remaining FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL ORDER BY expires_on LIMIT 5`,
    );
  }

  /** Dipakai oleh LoyaltyService.member */
  queryLoyaltyLedgerForMember3(db: DbOrTx, tenantId: string, customerId: string) {
    return db.execute(
      sql`SELECT kind, points, value, order_id AS "orderId", note, created_at AS "createdAt" FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} ORDER BY created_at DESC, id DESC LIMIT 100`,
    );
  }

  /** Dipakai oleh LoyaltyService.lookup */
  queryCustomerForLookup(db: DbOrTx, tenantId: string, like: string) {
    return db.execute(sql`
      SELECT c.id, c.code, c.name, c.phone, (COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l WHERE l.customer_id = c.id), 0) - COALESCE((SELECT SUM(l.remaining) FROM loyalty_ledger l WHERE l.customer_id = c.id AND l.remaining > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= ${todayJakarta()}), 0))::int AS balance
      FROM customers c WHERE c.tenant_id = ${tenantId} AND c.is_active AND (c.name ILIKE ${like} OR c.code ILIKE ${like} OR c.phone ILIKE ${like})
      ORDER BY c.name LIMIT 20`);
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryLoyaltyLedgerForSummary(db: DbOrTx, tenantId: string) {
    return db.execute<{ points: string; value: string; members: string }>(
      sql`SELECT COALESCE(SUM(points), 0) AS points, COALESCE(SUM(value), 0) AS value, COUNT(DISTINCT customer_id) AS members FROM loyalty_ledger WHERE tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryJournalLine(db: DbOrTx, tenantId: string) {
    return db.execute<{ bal: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0) AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.tenant_id = ${tenantId} AND a.system_key = 'LOYALTY_LIABILITY'`);
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryLoyaltyLedgerForSummary2(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ n: string; p: string }>(
      sql`SELECT COUNT(*) AS n, COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today}`,
    );
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryLoyaltyLedgerForSummary3(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ p: string }>(
      sql`SELECT COALESCE(SUM(remaining), 0) AS p FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND remaining > 0 AND expires_on > ${today} AND expires_on <= (${today}::date + 30)`,
    );
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryLoyaltyLedgerForSummary4(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT c.id, c.name, SUM(l.points)::int AS balance FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.tenant_id = ${tenantId} GROUP BY c.id, c.name HAVING SUM(l.points) < 0 ORDER BY SUM(l.points) LIMIT 20`,
    );
  }

  /** Dipakai oleh LoyaltyService.summary */
  queryLoyaltyLedgerForSummary5(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT c.name AS customer, l.points, l.note, l.created_at AS "createdAt" FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.tenant_id = ${tenantId} AND l.kind = 'ADJUST' AND l.created_at > now() - interval '30 days' ORDER BY l.created_at DESC LIMIT 20`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh LoyaltyService.expireCustomerTx */
  queryLoyaltyLedgerForExpireCustomerTx(db: DbOrTx, tenantId: string, customerId: string, today: string) {
    return db.execute<Lot & { expires_on: string }>(
      sql`SELECT id, remaining, value, points, expires_on FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today} ORDER BY expires_on FOR UPDATE`,
    );
  }

  /** Dipakai oleh LoyaltyService.expireLots */
  queryLoyaltyLedgerForExpireLots(
    db: DbOrTx,
    user: { tenantId: string; sub?: string },
    customerId: string,
    remaining: number,
    v: Decimal,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, note, created_by_id) VALUES (${user.tenantId}, ${customerId}, 'EXPIRE', ${-remaining}, ${v.negated().toFixed(2)}, 'Poin kedaluwarsa', ${user.sub ?? null})`,
    );
  }

  /** Dipakai oleh LoyaltyService.earnTx */
  queryLoyaltyLedgerForEarnTx(
    db: DbOrTx,
    p: {
      tenantId: string;
      customerId: string;
      orderId: string;
      points: number;
      settings: LoyaltySettings;
      userId?: string;
    },
    value: Decimal,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, expires_on, remaining, created_by_id) VALUES (${p.tenantId}, ${p.customerId}, 'EARN', ${p.points}, ${value.toFixed(2)}, ${p.orderId}, ${expiryDate(todayJakarta(), p.settings)}, ${p.points}, ${p.userId ?? null})`,
    );
  }

  /** Dipakai oleh LoyaltyService.redeemTx */
  queryLoyaltyLedgerForRedeemTx(
    db: DbOrTx,
    tenantId: string,
    customerId: string,
    points: number,
    liability: Decimal,
    orderId: string,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, created_by_id) VALUES (${tenantId}, ${customerId}, 'REDEEM', ${-points}, ${liability.negated().toFixed(2)}, ${orderId}, ${sub})`,
    );
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryLoyaltyLedgerForReturnTx4(
    db: DbOrTx,
    tenantId: string,
    customerId: string,
    pts: number,
    v: Decimal,
    orderId: string,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, note, created_by_id) VALUES (${tenantId}, ${customerId}, 'REVERSE', ${-pts}, ${v.negated().toFixed(2)}, ${orderId}, 'Retur transaksi', ${sub})`,
    );
  }

  /** Dipakai oleh LoyaltyService.returnTx */
  queryLoyaltyLedgerForReturnTx5(
    db: DbOrTx,
    tenantId: string,
    customerId: string,
    refundPts: number,
    lotValue: Decimal,
    orderId: string,
    settings: LoyaltySettings,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, order_id, expires_on, remaining, note, created_by_id) VALUES (${tenantId}, ${customerId}, 'REFUND', ${refundPts}, ${lotValue.toFixed(2)}, ${orderId}, ${expiryDate(todayJakarta(), settings)}, ${refundPts}, 'Poin dikembalikan (retur)', ${sub})`,
    );
  }

  /** Dipakai oleh LoyaltyService.adjust */
  queryLoyaltyLedgerForAdjust(
    db: DbOrTx,
    tenantId: string,
    customerId: string,
    points: number,
    value: Decimal,
    s: LoyaltySettings,
    reason: string,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, expires_on, remaining, note, created_by_id) VALUES (${tenantId}, ${customerId}, 'ADJUST', ${points}, ${value.toFixed(2)}, ${expiryDate(todayJakarta(), s)}, ${points}, ${reason}, ${sub})`,
    );
  }

  /** Dipakai oleh LoyaltyService.adjust */
  queryLoyaltyLedgerForAdjust2(
    db: DbOrTx,
    tenantId: string,
    customerId: string,
    points: number,
    value: Decimal,
    reason: string,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO loyalty_ledger (tenant_id, customer_id, kind, points, value, note, created_by_id) VALUES (${tenantId}, ${customerId}, 'ADJUST', ${points}, ${value.negated().toFixed(2)}, ${reason}, ${sub})`,
    );
  }

  /** Dipakai oleh LoyaltyService.expireAll */
  queryLoyaltyLedgerForExpireAll(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<Lot & { customer_id: string }>(
      sql`SELECT id, remaining, value, points, customer_id FROM loyalty_ledger WHERE tenant_id = ${tenantId} AND remaining > 0 AND expires_on IS NOT NULL AND expires_on <= ${today} ORDER BY customer_id, expires_on FOR UPDATE`,
    );
  }
}
