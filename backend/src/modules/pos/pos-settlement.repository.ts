import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { posCardSettlementItems, posCardSettlements } from '../../db/schema';
import { money } from '../../common/utils/money';

/** Akses data untuk PosSettlement: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PosSettlementRepository {
  /** Dipakai oleh CardSettlementService.unsettled */
  queryPosPayment(db: DbOrTx, tenantId: string, method: string | undefined) {
    return db.execute(sql`
      SELECT p.id, p.method, p.amount, o.number AS "orderNumber", o.date, s.bank_account_id AS "bankAccountId",
             COALESCE((SELECT SUM(r.total) FROM pos_returns r WHERE r.order_id = o.id), 0) AS returned
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id JOIN pos_sessions s ON s.id = o.session_id
      WHERE o.tenant_id = ${tenantId} AND p.method IN ('QRIS', 'DEBIT') ${method ? sql`AND p.method = ${method}` : sql``}
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id)
      ORDER BY o.date, o.number LIMIT 1000`);
  }

  /** Dipakai oleh CardSettlementService.unsettledReturns */
  queryPosReturn(db: DbOrTx, tenantId: string, method: string | undefined) {
    return db.execute(sql`
      SELECT r.id, r.number, r.date, r.total, o.number AS "orderNumber", s.bank_account_id AS "bankAccountId", pm.method
      FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id JOIN pos_sessions s ON s.id = o.session_id
      JOIN LATERAL (SELECT MIN(p.method) AS method, COUNT(DISTINCT p.method) AS n FROM pos_payments p WHERE p.order_id = o.id) pm ON pm.n = 1
      WHERE r.tenant_id = ${tenantId} AND r.refund_method = 'BANK' AND pm.method IN ('QRIS', 'DEBIT') ${method ? sql`AND pm.method = ${method}` : sql``}
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_returns x WHERE x.return_id = r.id)
      ORDER BY r.date, r.number LIMIT 500`);
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosPaymentForCreate(db: DbOrTx, ids: string[], tenantId: string) {
    return db.execute<{ id: string; method: string; amount: string; bank: string; tenant: string }>(sql`
        SELECT p.id, p.method, p.amount, s.bank_account_id AS bank, o.tenant_id AS tenant
        FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id JOIN pos_sessions s ON s.id = o.session_id
        WHERE p.id IN (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}) AND o.tenant_id = ${tenantId} FOR UPDATE OF p`);
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosCardSettlementItem(db: DbOrTx, ids: string[]) {
    return db.execute(
      sql`SELECT 1 FROM pos_card_settlement_items WHERE payment_id IN (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}) LIMIT 1`,
    );
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosReturnForCreate(db: DbOrTx, retIds: string[], tenantId: string, method: 'QRIS' | 'DEBIT') {
    return db.execute<{ id: string; total: string; bank: string }>(sql`
        SELECT r.id, r.total, s.bank_account_id AS bank
        FROM pos_returns r JOIN pos_orders o ON o.id = r.order_id JOIN pos_sessions s ON s.id = o.session_id
        WHERE r.id IN (${sql.join(
          retIds.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}) AND r.tenant_id = ${tenantId} AND r.refund_method = 'BANK'
          AND (SELECT COUNT(DISTINCT p.method) FROM pos_payments p WHERE p.order_id = o.id) = 1
          AND (SELECT MIN(p.method) FROM pos_payments p WHERE p.order_id = o.id) = ${method}
        FOR UPDATE OF r`);
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosCardSettlementReturn(db: DbOrTx, retIds: string[]) {
    return db.execute(
      sql`SELECT 1 FROM pos_card_settlement_returns WHERE return_id IN (${sql.join(
        retIds.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}) LIMIT 1`,
    );
  }

  /** Dipakai oleh CardSettlementService.create */
  insertPosCardSettlementItems(
    db: DbOrTx,
    rows: { id: string; method: string; amount: string; bank: string; tenant: string }[],
    tenantId: string,
    id: string,
  ) {
    return db
      .insert(posCardSettlementItems)
      .values(
        rows.map((r) => ({
          tenantId: tenantId,
          settlementId: id,
          paymentId: r.id,
          amount: money(r.amount).toFixed(2),
        })),
      );
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosCardSettlementReturnForCreate(db: DbOrTx, tenantId: string, id: string, rId: string, total: string) {
    return db.execute(
      sql`INSERT INTO pos_card_settlement_returns (tenant_id, settlement_id, return_id, amount) VALUES (${tenantId}, ${id}, ${rId}, ${money(total).toFixed(2)})`,
    );
  }

  /** Dipakai oleh CardSettlementService.create */
  updatePosCardSettlementsById(db: DbOrTx, id: string, stId: string) {
    return db
      .update(posCardSettlements)
      .set({ journalId: id })
      .where(sql`${posCardSettlements.id} = ${stId}`);
  }

  /** Dipakai oleh CardSettlementService.create */
  queryPosCardSettlement(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT * FROM pos_card_settlements WHERE id = ${id}`);
  }

  /** Dipakai oleh CardSettlementService.cancel */
  queryPosCardSettlementForCancel(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ status: string; number: string; journal_id: string; method: string }>(
      sql`SELECT status, number, journal_id, method FROM pos_card_settlements WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh CardSettlementService.cancel */
  queryJournalLine(db: DbOrTx, journal_id: string) {
    return db.execute<{ account_id: string; debit: string; credit: string }>(
      sql`SELECT account_id, debit, credit FROM journal_lines WHERE journal_id = ${journal_id}`,
    );
  }

  /** Dipakai oleh CardSettlementService.cancel */
  queryPosCardSettlementItemForCancel(db: DbOrTx, id: string) {
    return db.execute(sql`DELETE FROM pos_card_settlement_items WHERE settlement_id = ${id}`);
  }

  /** Dipakai oleh CardSettlementService.cancel */
  queryPosCardSettlementReturnForCancel(db: DbOrTx, id: string) {
    return db.execute(sql`DELETE FROM pos_card_settlement_returns WHERE settlement_id = ${id}`);
  }

  /** Dipakai oleh CardSettlementService.cancel */
  queryCancel(db: DbOrTx, reason: string, id: string, idId: string) {
    return db.execute(
      sql`UPDATE pos_card_settlements SET status = 'CANCELLED', cancel_reason = ${reason}, reverse_journal_id = ${id} WHERE id = ${idId}`,
    );
  }

  /** Dipakai oleh CardSettlementService.controls */
  queryPosPaymentForControls(db: DbOrTx, tenantId: string, lateAfterDays: number) {
    return db.execute(sql`
      SELECT p.method, COUNT(*)::int AS count, SUM(p.amount) AS amount, MIN(o.date) AS oldest
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
      WHERE o.tenant_id = ${tenantId} AND p.method IN ('QRIS', 'DEBIT') AND o.date < (CURRENT_DATE - ${lateAfterDays}::int)
        AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id)
      GROUP BY p.method`);
  }

  /** Dipakai oleh CardSettlementService.controls */
  queryPosCardSettlementForControls(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT number, date, method, difference, note FROM pos_card_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND difference <> 0 AND date >= (CURRENT_DATE - 60) ORDER BY date DESC LIMIT 30`,
    );
  }

  /** Dipakai oleh CardSettlementService.controls */
  queryPosCardSettlementForControls2(db: DbOrTx, tenantId: string) {
    return db.execute(sql`
      SELECT number, date, method, mdr_pct AS "contractPct", ROUND((gross - returns_total - received) / NULLIF(gross - returns_total, 0) * 100, 3) AS "effectivePct"
      FROM pos_card_settlements WHERE tenant_id = ${tenantId} AND status = 'POSTED' AND date >= (CURRENT_DATE - 60)
        AND (gross - returns_total - received) / NULLIF(gross - returns_total, 0) * 100 > mdr_pct + 0.5 ORDER BY date DESC LIMIT 30`);
  }
}
