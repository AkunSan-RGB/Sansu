import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { priceListItems, priceLists, promos, products, suppliers, customers } from '../../../db/schema';
import { eq, and, inArray, sql, asc } from 'drizzle-orm';
import { D } from '../../../common/utils/money';
import { PriceItemDto } from './price-lists.dto';

/** Akses data untuk PriceLists: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PriceListsRepository {
  /** Dipakai oleh PricingService.apply */
  listPriceListItemsWithPriceListsByPriceListIdAndProductId(
    db: DbOrTx,
    tenantId: string,
    priceListId: string,
    productIds: string[],
  ) {
    return db
      .select({ productId: priceListItems.productId, minQty: priceListItems.minQty, price: priceListItems.price })
      .from(priceListItems)
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(
        and(
          eq(priceListItems.tenantId, tenantId),
          eq(priceListItems.priceListId, priceListId),
          eq(priceLists.isActive, true),
          inArray(priceListItems.productId, productIds),
        ),
      );
  }

  /** Dipakai oleh PricingService.activeRules */
  listPromosByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(promos)
      .where(and(eq(promos.tenantId, tenantId), eq(promos.isActive, true)));
  }

  /** Dipakai oleh PricingService.listPriceLists */
  queryPriceList(db: DbOrTx, tenantId: string) {
    return db.execute<{
      id: string;
      name: string;
      description: string | null;
      is_active: boolean;
      items: string;
      customers: string;
    }>(sql`
      SELECT l.id, l.name, l.description, l.is_active,
             (SELECT COUNT(*) FROM price_list_items i WHERE i.price_list_id = l.id)::text AS items,
             (SELECT COUNT(*) FROM customers c WHERE c.price_list_id = l.id)::text AS customers
      FROM price_lists l WHERE l.tenant_id = ${tenantId} ORDER BY lower(l.name)`);
  }

  /** Dipakai oleh PricingService.getPriceList */
  listPriceListItemsWithProductsByPriceListIdAndMinQty(db: DbOrTx, id: string) {
    return db
      .select({
        productId: priceListItems.productId,
        sku: products.sku,
        name: products.name,
        baseUom: products.baseUom,
        sellPrice: products.sellPrice,
        minQty: priceListItems.minQty,
        price: priceListItems.price,
      })
      .from(priceListItems)
      .innerJoin(products, eq(products.id, priceListItems.productId))
      .where(eq(priceListItems.priceListId, id))
      .orderBy(asc(products.sku), asc(priceListItems.minQty));
  }

  /** Dipakai oleh PricingService.updatePriceList */
  updatePriceListsById(
    db: DbOrTx,
    patch: { name: string; description: string | null; isActive: boolean },
    id: string,
    tenantId: string,
  ) {
    return db
      .update(priceLists)
      .set(patch)
      .where(and(eq(priceLists.id, id), eq(priceLists.tenantId, tenantId)));
  }

  /** Dipakai oleh PricingService.replaceItems */
  listProductsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }

  /** Dipakai oleh PricingService.replaceItems */
  deletePriceListItemsByPriceListId(db: DbOrTx, id: string) {
    return db.delete(priceListItems).where(eq(priceListItems.priceListId, id));
  }

  /** Dipakai oleh PricingService.replaceItems */
  insertPriceListItems(db: DbOrTx, items: PriceItemDto[], tenantId: string, id: string) {
    return db
      .insert(priceListItems)
      .values(
        items.map((i) => ({
          tenantId: tenantId,
          priceListId: id,
          productId: i.productId,
          minQty: D(i.minQty).toFixed(4),
          price: D(i.price).toFixed(4),
        })),
      );
  }

  /** Dipakai oleh PricingService.listPromos */
  queryPromo(db: DbOrTx, tenantId: string) {
    return db.execute<Record<string, string | boolean | null>>(sql`
      SELECT p.id, p.name, p.kind, p.product_id AS "productId", pr.sku AS "productSku", pr.name AS "productName", p.min_qty AS "minQty", p.discount_pct AS "discountPct",
             p.bonus_product_id AS "bonusProductId", b.sku AS "bonusSku", b.name AS "bonusName", p.bonus_qty AS "bonusQty",
             p.valid_from AS "validFrom", p.valid_to AS "validTo", p.price_list_id AS "priceListId", l.name AS "priceListName", p.funded_supplier_id AS "fundedSupplierId", p.funded_pct AS "fundedPct", p.is_active AS "isActive"
      FROM promos p LEFT JOIN products pr ON pr.id = p.product_id LEFT JOIN products b ON b.id = p.bonus_product_id LEFT JOIN price_lists l ON l.id = p.price_list_id
      WHERE p.tenant_id = ${tenantId} ORDER BY p.is_active DESC, p.created_at DESC`);
  }

  /** Dipakai oleh PricingService.validatePromo */
  listProductsByIdForValidatePromo(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(ids)])));
  }

  /** Dipakai oleh PricingService.validatePromo */
  findSuppliersById(db: DbOrTx, fundedSupplierId: string, tenantId: string) {
    return db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, fundedSupplierId), eq(suppliers.tenantId, tenantId)));
  }

  /** Dipakai oleh PricingService.validatePromo */
  findPriceListsById(db: DbOrTx, priceListId: string, tenantId: string) {
    return db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.id, priceListId), eq(priceLists.tenantId, tenantId)));
  }

  /** Dipakai oleh PricingService.preview */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id, priceListId: customers.priceListId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }
}
