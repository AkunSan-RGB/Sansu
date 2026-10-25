import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, eq } from 'drizzle-orm';
import { productUoms, products } from '../../../db/schema';
import { ProductUomDto } from './products.dto';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Products: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ProductsRepository {
  /** Dipakai oleh ProductsService.options */
  queryProduct(db: DbOrTx, tenantId: string) {
    return db.execute<{ category: string | null; uom: string }>(sql`
      SELECT DISTINCT category, NULL AS uom FROM products WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND btrim(category) <> ''
      UNION ALL SELECT NULL, base_uom FROM products WHERE tenant_id = ${tenantId}
      UNION ALL SELECT NULL, u.uom FROM product_uoms u JOIN products p ON p.id = u.product_id WHERE p.tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh ProductsService.nextInternalBarcode */
  queryNextInternalBarcode(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:barcode`}))`);
  }

  /** Dipakai oleh ProductsService.nextInternalBarcode */
  queryProductForNextInternalBarcode(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: string }>(
      sql`SELECT COALESCE(MAX(substr(barcode, 2, 11)::bigint), 0) + 1 AS n FROM products WHERE tenant_id = ${tenantId} AND barcode_source = 'GENERATED'`,
    );
  }

  /** Dipakai oleh ProductsService.resolveBarcode */
  queryStockMove(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM stock_moves WHERE tenant_id = ${tenantId} AND product_id = ${id}`,
    );
  }

  /** Dipakai oleh ProductsService.generateMissingBarcodes */
  queryProductForGenerateMissingBarcodes(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM products WHERE tenant_id = ${tenantId} AND is_active AND barcode IS NULL ORDER BY sku`,
    );
  }

  /** Dipakai oleh ProductsService.generateMissingBarcodes */
  queryGenerateMissingBarcodes(db: DbOrTx, barcode: string, id: string) {
    return db.execute(sql`UPDATE products SET barcode = ${barcode}, barcode_source = 'GENERATED' WHERE id = ${id}`);
  }

  /** Dipakai oleh ProductsService.categories */
  queryProductForCategories(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string; count: number }>(sql`
      SELECT category AS name, COUNT(*)::int AS count FROM products
      WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND btrim(category) <> '' GROUP BY category ORDER BY category`);
  }

  /** Dipakai oleh ProductsService.roles */
  queryBomLine(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT DISTINCT l.product_id AS id FROM bom_lines l JOIN boms b ON b.id = l.bom_id WHERE b.tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh ProductsService.roles */
  queryBom(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(sql`SELECT DISTINCT product_id AS id FROM boms WHERE tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh ProductsService.create */
  insertProductUoms(db: DbOrTx, uoms: ProductUomDto[], id: string) {
    return db.insert(productUoms).values(uoms.map((u) => ({ productId: id, uom: u.uom, factor: u.factor })));
  }

  /** Dipakai oleh ProductsService.update */
  deleteProductUomsByProductId(db: DbOrTx, id: string) {
    return db.delete(productUoms).where(eq(productUoms.productId, id));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ProductsService.mergeCategories */
  queryProductForMergeCategories(db: DbOrTx, cond: SQL<unknown>) {
    return db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM products WHERE ${cond}`);
  }

  /** Dipakai oleh ProductsService.mergeCategories */
  queryMergeCategories(db: DbOrTx, to: string | null, cond: SQL<unknown>) {
    return db.execute<{ id: string }>(sql`UPDATE products SET category = ${to}::text WHERE ${cond} RETURNING id`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ProductsService.create */
  insertProducts(db: DbOrTx, values: typeof products.$inferInsert) {
    return db.insert(products).values(values).returning({ id: products.id });
  }
}
