import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk Retainers: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class RetainersRepository {
  /** Dipakai oleh RetainerService.list */
  queryServiceRetainerInvoice(db: DbOrTx, tenantId: string) {
    return db.execute<{ retainer_id: string; period: string; number: string }>(
      sql`SELECT ri.retainer_id, ri.period, i.number FROM service_retainer_invoices ri JOIN invoices i ON i.id = ri.invoice_id WHERE ri.tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh RetainerService.create */
  queryCustomer(db: DbOrTx, customerId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} AND is_active`);
  }

  /** Dipakai oleh RetainerService.create */
  queryProject(db: DbOrTx, projectId: string, tenantId: string) {
    return db.execute<{ customer_id: string; status: string }>(
      sql`SELECT customer_id, status FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh RetainerService.bill */
  queryServiceRetainerInvoiceForBill(db: DbOrTx, id: string, period: string) {
    return db.execute(sql`SELECT 1 FROM service_retainer_invoices WHERE retainer_id = ${id} AND period = ${period}`);
  }

  /** Dipakai oleh RetainerService.bill */
  queryServiceRetainerInvoiceForBill2(db: DbOrTx, tenantId: string, id: string, period: string, invoiceId: string) {
    return db.execute(
      sql`INSERT INTO service_retainer_invoices (tenant_id, retainer_id, period, invoice_id) VALUES (${tenantId}, ${id}, ${period}, ${invoiceId})`,
    );
  }
}
