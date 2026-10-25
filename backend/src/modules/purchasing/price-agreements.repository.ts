import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { suppliers, products, supplierPriceAgreements } from '../../db/schema';
import { DecideAgreementDto } from './price-agreements.dto';

/** Akses data untuk PriceAgreements: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PriceAgreementsRepository {
  /** Dipakai oleh PriceAgreementsService.list */
  querySupplierPriceAgreement(db: DbOrTx, u: AuthUser, status: string | undefined) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.supplier_id AS "supplierId", s.name AS "supplierName", a.product_id AS "productId", p.sku, p.name AS "productName", p.base_uom AS "baseUom",
             a.price, a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo", a.status, a.note, a.decision_note AS "decisionNote",
             cu.name AS "createdByName", du.name AS "decidedByName",
             (SELECT (l.price * (1 - l.discount_pct / 100) / NULLIF(l.uom_factor, 0)) FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
               WHERE o.tenant_id = a.tenant_id AND o.supplier_id = a.supplier_id AND l.product_id = a.product_id AND o.status <> 'CANCELLED' ORDER BY o.date DESC, o.created_at DESC LIMIT 1) AS "lastPrice"
      FROM supplier_price_agreements a JOIN suppliers s ON s.id = a.supplier_id JOIN products p ON p.id = a.product_id
      LEFT JOIN users cu ON cu.id = a.created_by_id LEFT JOIN users du ON du.id = a.decided_by_id
      WHERE a.tenant_id = ${u.tenantId} ${status ? sql`AND a.status = ${status}` : sql``}
      ORDER BY a.created_at DESC LIMIT 500`);
  }

  /** Dipakai oleh PriceAgreementsService.create */
  findSuppliersById(db: DbOrTx, supplierId: string, tenantId: string) {
    return db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)));
  }

  /** Dipakai oleh PriceAgreementsService.create */
  findProductsById(db: DbOrTx, productId: string, tenantId: string) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
  }

  /** Dipakai oleh PriceAgreementsService.create */
  querySupplierPriceAgreementForCreate(
    db: DbOrTx,
    tenantId: string,
    supplierId: string,
    productId: string,
    to: string,
    from: string,
  ) {
    return db.execute(sql`
      SELECT 1 FROM supplier_price_agreements WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId} AND product_id = ${productId}
        AND status IN ('PENDING','ACTIVE') AND valid_from <= ${to} AND valid_to >= ${from} LIMIT 1`);
  }

  /** Dipakai oleh PriceAgreementsService.lockRow */
  querySupplierPriceAgreementForLockRow(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<typeof supplierPriceAgreements.$inferSelect & { created_by_id: string }>(
      sql`SELECT * FROM supplier_price_agreements WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PriceAgreementsService.approve */
  updateSupplierPriceAgreementsById(db: DbOrTx, sub: string, dto: DecideAgreementDto, id: string) {
    return db
      .update(supplierPriceAgreements)
      .set({ status: 'ACTIVE', decidedById: sub, decidedAt: new Date(), decisionNote: dto.note ?? null })
      .where(eq(supplierPriceAgreements.id, id))
      .returning();
  }

  /** Dipakai oleh PriceAgreementsService.reject */
  updateSupplierPriceAgreementsByIdForReject(db: DbOrTx, sub: string, reason: string, id: string) {
    return db
      .update(supplierPriceAgreements)
      .set({ status: 'REJECTED', decidedById: sub, decidedAt: new Date(), decisionNote: reason })
      .where(eq(supplierPriceAgreements.id, id))
      .returning();
  }

  /** Dipakai oleh PriceAgreementsService.end */
  updateSupplierPriceAgreementsByIdForEnd(db: DbOrTx, sub: string, reason: string, id: string) {
    return db
      .update(supplierPriceAgreements)
      .set({ status: 'ENDED', decidedById: sub, decidedAt: new Date(), decisionNote: reason })
      .where(eq(supplierPriceAgreements.id, id))
      .returning();
  }

  /** Dipakai oleh PriceAgreementsService.lookup */
  querySupplierPriceAgreementForLookup(
    db: DbOrTx,
    tenantId: string,
    supplierId: string,
    productId: string,
    date: string,
  ) {
    return db.execute<{ id: string; price: string; valid_to: string }>(sql`
      SELECT id, price, valid_to::text FROM supplier_price_agreements
      WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId} AND product_id = ${productId} AND status = 'ACTIVE' AND valid_from <= ${date} AND valid_to >= ${date} LIMIT 1`);
  }

  /** Dipakai oleh PriceAgreementsService.enforce */
  findProductsByIdForEnforce(db: DbOrTx, productId: string) {
    return db.select({ sku: products.sku }).from(products).where(eq(products.id, productId));
  }
}
