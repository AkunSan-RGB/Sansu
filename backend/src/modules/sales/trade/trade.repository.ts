import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import {
  tradeTerms,
  customers,
  tradeAccruals,
  principalClaims,
  suppliers,
  principalClaimLines,
  tradeAccrualSettlements,
} from '../../../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { PeriodQueryDto } from './trade.dto';
import type { Decimal } from 'decimal.js';

/** Akses data untuk Trade: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TradeRepository {
  /** Dipakai oleh TradeService.terms */
  listTradeTermsWithCustomersByCustomerIdAndName(db: DbOrTx, tenantId: string, customerId: string | undefined) {
    return db
      .select({ t: tradeTerms, code: customers.code, name: customers.name })
      .from(tradeTerms)
      .innerJoin(customers, eq(customers.id, tradeTerms.customerId))
      .where(and(eq(tradeTerms.tenantId, tenantId), customerId ? eq(tradeTerms.customerId, customerId) : undefined))
      .orderBy(customers.name, tradeTerms.name);
  }

  /** Dipakai oleh TradeService.checkTerm */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }

  /** Dipakai oleh TradeService.accruals */
  listTradeAccrualsWithTradeTermsAndCustomersByPeriodAndCustomerIdAndNumber(
    db: DbOrTx,
    tenantId: string,
    q: PeriodQueryDto,
  ) {
    return db
      .select({ a: tradeAccruals, term: tradeTerms.name, code: customers.code, name: customers.name })
      .from(tradeAccruals)
      .innerJoin(tradeTerms, eq(tradeTerms.id, tradeAccruals.termId))
      .innerJoin(customers, eq(customers.id, tradeAccruals.customerId))
      .where(
        and(
          eq(tradeAccruals.tenantId, tenantId),
          q.period ? eq(tradeAccruals.period, q.period) : undefined,
          q.customerId ? eq(tradeAccruals.customerId, q.customerId) : undefined,
        ),
      )
      .orderBy(desc(tradeAccruals.period), desc(tradeAccruals.number))
      .limit(500);
  }

  /** Dipakai oleh TradeService.accrue */
  listTradeTermsByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(tradeTerms)
      .where(and(eq(tradeTerms.tenantId, tenantId), eq(tradeTerms.isActive, true)));
  }

  /** Dipakai oleh TradeService.accrue */
  findTradeAccrualsByTermIdAndPeriodAndStatus(db: DbOrTx, id: string, period: string) {
    return db
      .select({ id: tradeAccruals.id })
      .from(tradeAccruals)
      .where(
        and(eq(tradeAccruals.termId, id), eq(tradeAccruals.period, period), sql`${tradeAccruals.status} <> 'VOID'`),
      );
  }

  /** Dipakai oleh TradeService.accrue */
  queryInvoice(db: DbOrTx, tenantId: string, customerId: string, from: string, to: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM invoices WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND kind <> 'SERVICE' AND date >= ${from} AND date <= ${to}`,
    );
  }

  /** Dipakai oleh TradeService.accrue */
  querySalesReturn(db: DbOrTx, tenantId: string, customerId: string, from: string, to: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM sales_returns WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND date >= ${from} AND date <= ${to}`,
    );
  }

  /** Dipakai oleh TradeService.settle */
  queryInvoiceForSettle(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh TradeService.claims */
  listPrincipalClaimsWithSuppliersByPeriodAndNumber(db: DbOrTx, tenantId: string) {
    return db
      .select({ c: principalClaims, name: suppliers.name })
      .from(principalClaims)
      .innerJoin(suppliers, eq(suppliers.id, principalClaims.supplierId))
      .where(eq(principalClaims.tenantId, tenantId))
      .orderBy(desc(principalClaims.period), desc(principalClaims.number))
      .limit(300);
  }

  /** Dipakai oleh TradeService.claim */
  listPrincipalClaimLinesByClaimId(db: DbOrTx, id: string) {
    return db.select().from(principalClaimLines).where(eq(principalClaimLines.claimId, id));
  }

  /** Dipakai oleh TradeService.generateClaim */
  findSuppliersById(db: DbOrTx, supplierId: string, tenantId: string) {
    return db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)));
  }

  /** Dipakai oleh TradeService.generateClaim */
  querySalesOrderLine(db: DbOrTx, tenantId: string, id: string, from: string, to: string) {
    return db.execute<{
      line_id: string;
      promo_id: string;
      promo_name: string;
      kind: string;
      funded: string;
      ret_ratio: string;
      qty: string;
      factor: string;
      price: string;
      line_total: string;
      is_bonus: boolean;
      inv_no: string;
      sku: string;
      cost: string | null;
    }>(sql`
        SELECT l.id AS line_id, p.id AS promo_id, p.name AS promo_name, p.kind, l.promo_funded_pct AS funded,
               COALESCE((SELECT 1 - SUM(il.returned_qty) / NULLIF(SUM(il.qty), 0) FROM invoice_lines il WHERE il.invoice_id = i.id AND il.product_id = l.product_id AND il.uom = l.uom AND il.price = l.price AND il.discount_pct = l.discount_pct), 1)::text AS ret_ratio, l.qty, l.uom_factor AS factor, l.price, l.line_total, l.is_bonus, i.number AS inv_no, pr.sku,
               (SELECT AVG(m.unit_cost) FROM stock_moves m WHERE m.tenant_id = ${tenantId}::uuid AND m.product_id = l.product_id AND m.type = 'SALE' AND (m.ref_id = i.id::text OR m.ref_id = i.delivery_order_id::text)) AS cost
        FROM sales_order_lines l
        JOIN promos p ON p.id = l.promo_id
        JOIN sales_orders o ON o.id = l.order_id
        JOIN invoices i ON i.sales_order_id = o.id
        JOIN products pr ON pr.id = l.product_id
        WHERE o.tenant_id = ${tenantId} AND l.promo_funded_supplier_id = ${id} AND l.promo_funded_pct > 0 AND i.date >= ${from} AND i.date <= ${to}
          AND NOT EXISTS (SELECT 1 FROM principal_claim_lines x WHERE x.order_line_id = l.id)`);
  }

  /** Dipakai oleh TradeService.decideClaim */
  deletePrincipalClaimLinesByClaimId(db: DbOrTx, id: string) {
    return db.delete(principalClaimLines).where(eq(principalClaimLines.claimId, id));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh TradeService.settle */
  insertTradeAccrualSettlements(
    db: DbOrTx,
    tenantId: string,
    id: string,
    date: string,
    amount: Decimal,
    mode: 'DEDUCT' | 'PAY',
    settleJournalId: string,
  ) {
    return db
      .insert(tradeAccrualSettlements)
      .values({
        tenantId: tenantId,
        accrualId: id,
        date: date,
        amount: amount.toFixed(2),
        mode: mode,
        journalId: settleJournalId,
      });
  }
}
