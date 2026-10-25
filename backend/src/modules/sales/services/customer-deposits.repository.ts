import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { customers, customerDeposits, projects, depositApplications, invoices, tenants } from '../../../db/schema';
import { inArray, eq, sql } from 'drizzle-orm';

/** Akses data untuk CustomerDeposits: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CustomerDepositsRepository {
  /** Dipakai oleh CustomerDepositsService.listDeposits */
  listCustomersById(db: DbOrTx, rows: (typeof customerDeposits.$inferSelect)[]) {
    return db
      .select({ id: customers.id, code: customers.code, name: customers.name })
      .from(customers)
      .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
  }

  /** Dipakai oleh CustomerDepositsService.listDeposits */
  listProjectsById(db: DbOrTx, projIds: string[]) {
    return db
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, projIds));
  }

  /** Dipakai oleh CustomerDepositsService.listDeposits */
  listDepositApplicationsWithInvoicesByDepositId(db: DbOrTx, rows: (typeof customerDeposits.$inferSelect)[]) {
    return db
      .select({
        id: depositApplications.id,
        depositId: depositApplications.depositId,
        date: depositApplications.date,
        amount: depositApplications.amount,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
      })
      .from(depositApplications)
      .innerJoin(invoices, eq(invoices.id, depositApplications.invoiceId))
      .where(
        inArray(
          depositApplications.depositId,
          rows.map((r) => r.id),
        ),
      );
  }

  /** Dipakai oleh CustomerDepositsService.createDeposit */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh CustomerDepositsService.applyDeposit */
  queryCustomerDeposit(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM customer_deposits WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh CustomerDepositsService.applyDeposit */
  queryInvoice(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh CustomerDepositsService.applyDeposit */
  findCustomerDepositsById(db: DbOrTx, id: string) {
    return db.select().from(customerDeposits).where(eq(customerDeposits.id, id));
  }

  /** Dipakai oleh CustomerDepositsService.applyDeposit */
  findInvoicesById(db: DbOrTx, invoiceId: string) {
    return db.select().from(invoices).where(eq(invoices.id, invoiceId));
  }

  /** Dipakai oleh CustomerDepositsService.applyDeposit */
  queryDepositApplication(db: DbOrTx, id: string) {
    return db.execute<{ dpp: string; tax: string }>(sql`
          SELECT COALESCE(SUM(dpp), 0) AS dpp, COALESCE(SUM(tax_amount), 0) AS tax FROM deposit_applications WHERE deposit_id = ${id}`);
  }
}
