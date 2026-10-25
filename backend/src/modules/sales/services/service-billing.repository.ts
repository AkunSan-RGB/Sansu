import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { accounts, tenants, serviceInvoiceLines } from '../../../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { D, Dec } from '../../../common/utils/money';

/** Akses data untuk ServiceBilling: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ServiceBillingRepository {
  /** Dipakai oleh ServiceBillingService.keyAccount */
  findAccountsBySystemKey(db: DbOrTx, tenantId: string, key: string) {
    return db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, key)));
  }

  /** Dipakai oleh ServiceBillingService.createInvoice */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh ServiceBillingService.createInvoice */
  listAccountsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  }

  /** Dipakai oleh ServiceBillingService.createInvoice */
  queryInvoice(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ v: string }>(sql`
            SELECT COALESCE(SUM(subtotal), 0) AS v FROM invoices WHERE project_id = ${id} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh ServiceBillingService.createInvoice */
  insertServiceInvoiceLines(
    db: DbOrTx,
    lines: {
      lineTotal: Dec;
      qty: string;
      price: Dec;
      discountPct: string;
      accountId: string;
      description: string;
      unit?: string;
    }[],
    id: string,
  ) {
    return db.insert(serviceInvoiceLines).values(
      lines.map((l) => ({
        invoiceId: id,
        description: l.description.trim(),
        qty: D(l.qty).toFixed(4),
        unit: l.unit?.trim() || 'Paket',
        price: l.price.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        accountId: l.accountId,
      })),
    );
  }

  /** Dipakai oleh ServiceBillingService.withheld */
  queryInvoiceForWithheld(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{
      id: string;
      number: string;
      date: string;
      customer: string;
      npwp: string | null;
      type: 'PPH23' | 'PPH4_2';
      rate: string;
      base: string;
      amount: string;
      slip_no: string | null;
      slip_date: string | null;
    }>(sql`
        SELECT i.id, i.number, i.date::text, c.name AS customer, c.npwp, i.withholding_type AS type, i.withholding_rate AS rate,
               i.withholding_base AS base, i.withholding_amount AS amount, i.withholding_slip_no AS slip_no, i.withholding_slip_date::text AS slip_date
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.withholding_amount > 0 AND i.date BETWEEN ${from} AND ${to}
        ORDER BY i.date, i.number`);
  }
}
