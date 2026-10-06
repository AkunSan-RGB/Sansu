import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { todayJakarta } from '../../../common/utils/dates';
import { D, Dec } from '../../../common/utils/money';
import { Tx } from '../../../db/db';
import { customers, invoices, salesOrders } from '../../../db/schema';

/**
 * Kontrol kredit pelanggan — fitur yang paling dicari distributor:
 *  1. Blokir order jika ada faktur yang sudah lewat jatuh tempo
 *  2. Blokir order jika piutang + order terbuka + order ini > limit kredit
 */
@Injectable()
export class CreditService {
  async assertCanOrder(tx: Tx, tenantId: string, customerId: string, orderTotal: Dec, excludeOrderId?: string) {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));

    const [overdue] = await tx
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
    if (overdue) {
      throw new BadRequestException(
        `Pelanggan ${customer.name} memiliki faktur jatuh tempo (${overdue.number}, ${overdue.dueDate}). Lunasi dahulu.`,
      );
    }

    const limit = D(customer.creditLimit);
    if (limit.isZero()) return;

    const [ar] = await tx
      .select({ v: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, customerId), ne(invoices.status, 'PAID')));
    const [open] = await tx
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

    const exposure = D(ar.v).plus(open.v).plus(orderTotal);
    if (exposure.gt(limit)) {
      throw new BadRequestException(
        `Melebihi limit kredit ${customer.name}: eksposur ${exposure.toFixed(0)} > limit ${limit.toFixed(0)}`,
      );
    }
  }
}
