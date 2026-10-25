import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, and, eq, ne, or, ilike, asc } from 'drizzle-orm';
import { invoices, priceLists, customers } from '../../../db/schema';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** Akses data untuk Customers: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CustomersRepository {
  /** Dipakai oleh CustomersService.get */
  sumInvoicesByCustomerIdAndStatus(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({
        outstanding: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id), ne(invoices.status, 'PAID')));
  }

  /** Dipakai oleh CustomersService.checkPriceList */
  findPriceListsById(db: DbOrTx, priceListId: string, tenantId: string) {
    return db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.id, priceListId), eq(priceLists.tenantId, tenantId)));
  }

  /** Dipakai oleh CustomersService.assertNoLookalike */
  listCustomers(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: customers.id, code: customers.code, name: customers.name, npwp: customers.npwp })
      .from(customers)
      .where(eq(customers.tenantId, tenantId));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh CustomersService.list */
  listCustomersByCodeAndName(
    db: DbOrTx,
    tenantId: NonNullable<(typeof customers.$inferSelect)['tenantId']>,
    q: string | undefined,
  ) {
    return db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          q ? or(ilike(customers.code, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(customers.code))
      .limit(500);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh CustomersService.update */
  updateCustomersById(
    db: DbOrTx,
    patch: PgUpdateSetSource<typeof customers>,
    id: NonNullable<(typeof customers.$inferSelect)['id']>,
  ) {
    return db.update(customers).set(patch).where(eq(customers.id, id)).returning();
  }
}
