import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, ne, or, ilike, asc } from 'drizzle-orm';
import { purchaseInvoices, suppliers } from '../../db/schema';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** Akses data untuk Suppliers: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SuppliersRepository {
  /** Dipakai oleh SuppliersService.get */
  sumPurchaseInvoicesBySupplierIdAndStatus(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
      })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.tenantId, tenantId),
          eq(purchaseInvoices.supplierId, id),
          ne(purchaseInvoices.status, 'PAID'),
        ),
      );
  }

  /** Dipakai oleh SuppliersService.findLookalikes */
  listSuppliers(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, npwp: suppliers.npwp })
      .from(suppliers)
      .where(eq(suppliers.tenantId, tenantId));
  }

  /** Dipakai oleh SuppliersService.applyBankChange */
  updateSuppliersById(
    db: DbOrTx,
    bank: { bankName?: string; bankAccountNo?: string; bankAccountName?: string },
    supplierId: string,
  ) {
    return db
      .update(suppliers)
      .set({ ...bank, bankChangedAt: new Date() })
      .where(eq(suppliers.id, supplierId))
      .returning();
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SuppliersService.update */
  updateSuppliersByIdForUpdate(
    db: DbOrTx,
    patch: PgUpdateSetSource<typeof suppliers>,
    id: NonNullable<(typeof suppliers.$inferSelect)['id']>,
  ) {
    return db.update(suppliers).set(patch).where(eq(suppliers.id, id)).returning();
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SuppliersService.list */
  listSuppliersByCodeAndName(
    db: DbOrTx,
    tenantId: NonNullable<(typeof suppliers.$inferSelect)['tenantId']>,
    q: string | undefined,
  ) {
    return db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, tenantId),
          q ? or(ilike(suppliers.code, `%${q}%`), ilike(suppliers.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(suppliers.code))
      .limit(500);
  }
}
