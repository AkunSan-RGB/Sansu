import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import {
  customers,
  customerDeposits,
  tenants,
  products,
  marketplaceOrders,
  salesOrders,
  invoices,
  payments,
} from '../../db/schema';
import { inArray, eq, sql, and, ne, asc, desc } from 'drizzle-orm';
import { MarketplaceSettleDto } from './integrations.dto';
import { Dec } from '../../common/utils/money';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Integrations: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class IntegrationsRepository {
  /** Dipakai oleh IntegrationsService.coretaxDocs */
  listCustomersById(db: DbOrTx, deps: (typeof customerDeposits.$inferSelect)[]) {
    return db
      .select()
      .from(customers)
      .where(inArray(customers.id, [...new Set(deps.map((d) => d.customerId))]));
  }

  /** Dipakai oleh IntegrationsService.coretaxPreview */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh IntegrationsService.coretaxPreview */
  queryCustomerDeposit(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ customer_id: string }>(sql`
        SELECT DISTINCT customer_id FROM customer_deposits
        WHERE tenant_id = ${tenantId} AND tax_amount > 0 AND amount > applied_amount AND date <= ${to}`);
  }

  /** Dipakai oleh IntegrationsService.channelCustomer */
  findCustomersByCode(db: DbOrTx, tenantId: string, code: string) {
    return db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.code, code)));
  }

  /** Dipakai oleh IntegrationsService.channelCustomer */
  insertCustomers(db: DbOrTx, tenantId: string, code: string, channel: string) {
    return db
      .insert(customers)
      .values({
        tenantId: tenantId,
        code: code,
        name: `Penjualan ${channel}`,
        address: `Marketplace ${channel}`,
        creditLimit: '0',
        paymentTermDays: 14,
      })
      .returning();
  }

  /** Dipakai oleh IntegrationsService.importMarketplace */
  findTenantsByIdForImportMarketplace(db: DbOrTx, tenantId: string) {
    return db.select({ ppnRate: tenants.ppnRate }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh IntegrationsService.importMarketplace */
  listProducts(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: products.id, sku: products.sku, baseUom: products.baseUom })
      .from(products)
      .where(eq(products.tenantId, tenantId));
  }

  /** Dipakai oleh IntegrationsService.importMarketplace */
  listMarketplaceOrdersByChannel(db: DbOrTx, tenantId: string, channel: string) {
    return db
      .select({ orderNo: marketplaceOrders.orderNo })
      .from(marketplaceOrders)
      .where(and(eq(marketplaceOrders.tenantId, tenantId), eq(marketplaceOrders.channel, channel)));
  }

  /** Dipakai oleh IntegrationsService.importMarketplace */
  updateSalesOrdersByIdAndStatus(db: DbOrTx, id: string) {
    return db
      .update(salesOrders)
      .set({ status: 'CONFIRMED' })
      .where(and(eq(salesOrders.id, id), eq(salesOrders.status, 'DRAFT')));
  }

  /** Dipakai oleh IntegrationsService.importMarketplace */
  insertMarketplaceOrders(
    db: DbOrTx,
    tenantId: string,
    channel: string,
    orderNo: string,
    date: string,
    id: string,
    total: string,
  ) {
    return db
      .insert(marketplaceOrders)
      .values({ tenantId: tenantId, channel: channel, orderNo: orderNo, date: date, invoiceId: id, total: total });
  }

  /** Dipakai oleh IntegrationsService.channels */
  queryMarketplaceOrder(db: DbOrTx, tenantId: string) {
    return db.execute<{ channel: string; orders: number; open: string }>(sql`
      SELECT m.channel, COUNT(*)::int AS orders, COALESCE(SUM(i.total - i.paid_amount - i.returned_amount) FILTER (WHERE i.status <> 'PAID'), 0) AS open
      FROM marketplace_orders m LEFT JOIN invoices i ON i.id = m.invoice_id
      WHERE m.tenant_id = ${tenantId} GROUP BY m.channel ORDER BY m.channel`);
  }

  /** Dipakai oleh IntegrationsService.settle */
  listMarketplaceOrdersWithInvoicesByChannelAndOrderNo(
    db: DbOrTx,
    tenantId: string,
    channel: string,
    date: string,
    dto: MarketplaceSettleDto,
  ) {
    return db
      .select({ inv: invoices, orderNo: marketplaceOrders.orderNo })
      .from(marketplaceOrders)
      .innerJoin(invoices, eq(invoices.id, marketplaceOrders.invoiceId))
      .where(
        and(
          eq(marketplaceOrders.tenantId, tenantId),
          eq(marketplaceOrders.channel, channel),
          ne(invoices.status, 'PAID'),
          sql`${invoices.date} <= ${date}`,
          dto.orderNos?.length ? inArray(marketplaceOrders.orderNo, dto.orderNos) : undefined,
        ),
      )
      .orderBy(asc(invoices.date), asc(invoices.number))
      .for('update', { of: invoices });
  }

  /** Dipakai oleh IntegrationsService.settle */
  insertPayments(
    db: DbOrTx,
    tenantId: string,
    number: string,
    date: string,
    customerId: string,
    id: string,
    out: Dec,
    bankId: string,
    channel: string,
    orderNo: string,
    journalId: string,
  ) {
    return db.insert(payments).values({
      tenantId: tenantId,
      number: number,
      date: date,
      customerId: customerId,
      invoiceId: id,
      amount: out.toFixed(2),
      method: 'TRANSFER',
      cashAccountId: bankId,
      notes: `Pencairan ${channel} #${orderNo}`,
      journalId: journalId,
    });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh IntegrationsService.coretaxDocs */
  queryDepositApplication(db: DbOrTx, tenantId: string, rowsValues: SQL<unknown>[]) {
    return db.execute<{ invoice_id: string; dpp: string; tax: string; numbers: string }>(sql`
            SELECT a.invoice_id, SUM(a.dpp) AS dpp, SUM(a.tax_amount) AS tax, string_agg(DISTINCT d.number, ', ') AS numbers
            FROM deposit_applications a JOIN customer_deposits d ON d.id = a.deposit_id
            WHERE a.tenant_id = ${tenantId} AND d.tax_amount > 0 AND a.invoice_id IN (${sql.join(rowsValues, sql`, `)})
            GROUP BY a.invoice_id`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh IntegrationsService.marketplaceOrders */
  listMarketplaceOrdersWithInvoicesByChannelAndDateAndOrderNo(
    db: DbOrTx,
    tenantId: NonNullable<(typeof marketplaceOrders.$inferSelect)['tenantId']>,
    channel: string | undefined,
  ) {
    return db
      .select({
        id: marketplaceOrders.id,
        channel: marketplaceOrders.channel,
        orderNo: marketplaceOrders.orderNo,
        date: marketplaceOrders.date,
        total: marketplaceOrders.total,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
        status: invoices.status,
        paidAmount: invoices.paidAmount,
      })
      .from(marketplaceOrders)
      .leftJoin(invoices, eq(invoices.id, marketplaceOrders.invoiceId))
      .where(
        and(eq(marketplaceOrders.tenantId, tenantId), channel ? eq(marketplaceOrders.channel, channel) : undefined),
      )
      .orderBy(desc(marketplaceOrders.date), desc(marketplaceOrders.orderNo))
      .limit(1000);
  }
}
