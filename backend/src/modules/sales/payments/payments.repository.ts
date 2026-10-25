import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { invoices, customers } from '../../../db/schema';
import { and, eq, sql } from 'drizzle-orm';

/** Akses data untuk Payments: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PaymentsRepository {
  /** Dipakai oleh PaymentsService.create */
  findInvoicesById(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db
      .select({ n: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  }

  /** Dipakai oleh PaymentsService.create */
  queryInvoice(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`
        SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh PaymentsService.create */
  findInvoicesByIdForCreate(db: DbOrTx, invoiceId: string) {
    return db.select().from(invoices).where(eq(invoices.id, invoiceId));
  }

  /** Dipakai oleh PaymentsService.create */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select().from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh PaymentsService.writeOff */
  queryInvoiceForWriteOff(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh PaymentsService.writeOff */
  queryAccount(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; bal: string }>(sql`
        SELECT a.id::text, COALESCE((SELECT SUM(l.credit - l.debit) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE l.account_id = a.id AND j.tenant_id = ${tenantId}), 0)::text AS bal
        FROM accounts a WHERE a.tenant_id = ${tenantId} AND a.report_group = 'ALLOWANCE_RECEIVABLE' ORDER BY a.code LIMIT 1`);
  }

  /** Dipakai oleh PaymentsService.writeOff */
  queryAccountForWriteOff(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id::text FROM accounts WHERE tenant_id = ${tenantId} AND code = '6-7300' LIMIT 1`,
    );
  }
}
