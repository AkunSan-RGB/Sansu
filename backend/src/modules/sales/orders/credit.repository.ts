import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { customers, invoices, salesOrders } from '../../../db/schema';
import { eq, and, ne, lt, asc, sql, inArray } from 'drizzle-orm';
import { todayJakarta } from '../../../common/utils/dates';

/** Akses data untuk Credit: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CreditRepository {
  /** Dipakai oleh CreditService.assertCanOrder */
  findCustomersById(db: DbOrTx, customerId: NonNullable<(typeof customers.$inferSelect)['id']>) {
    return db.select().from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh CreditService.assertCanOrder */
  findInvoicesByCustomerIdAndStatusAndDueDate(
    db: DbOrTx,
    tenantId: NonNullable<(typeof invoices.$inferSelect)['tenantId']>,
    customerId: NonNullable<(typeof invoices.$inferSelect)['customerId']>,
  ) {
    return db
      .select({ number: invoices.number, dueDate: invoices.dueDate })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.customerId, customerId),
          ne(invoices.status, 'PAID'),
          lt(invoices.dueDate, todayJakarta()),
        ),
      )
      .orderBy(asc(invoices.dueDate))
      .limit(1);
  }

  /** Dipakai oleh CreditService.assertCanOrder */
  sumInvoicesByCustomerIdAndStatus(
    db: DbOrTx,
    tenantId: NonNullable<(typeof invoices.$inferSelect)['tenantId']>,
    customerId: NonNullable<(typeof invoices.$inferSelect)['customerId']>,
  ) {
    return db
      .select({
        v: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, customerId), ne(invoices.status, 'PAID')));
  }

  /** Dipakai oleh CreditService.assertCanOrder */
  sumSalesOrdersByCustomerIdAndStatusAndId(
    db: DbOrTx,
    tenantId: NonNullable<(typeof salesOrders.$inferSelect)['tenantId']>,
    customerId: NonNullable<(typeof salesOrders.$inferSelect)['customerId']>,
    excludeOrderId: string | undefined,
  ) {
    return db
      .select({ v: sql<string>`COALESCE(SUM(${salesOrders.total}), 0)` })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.tenantId, tenantId),
          eq(salesOrders.customerId, customerId),
          inArray(salesOrders.status, ['CONFIRMED', 'DELIVERED']),
          excludeOrderId ? ne(salesOrders.id, excludeOrderId) : undefined,
        ),
      );
  }
}
