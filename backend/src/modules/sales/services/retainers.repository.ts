import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';
import { RetainerDto, RetainerUpdateDto } from './retainers.dto';
import type { Decimal } from 'decimal.js';

export type Ret = {
  id: string;
  customer_id: string;
  project_id: string | null;
  title: string;
  monthly_fee: string;
  with_vat: boolean | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

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

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh RetainerService.list */
  queryServiceRetainer(db: DbOrTx, tenantId: string) {
    return db.execute<Ret & { customer_name: string; project_name: string | null }>(
      sql`SELECT r.*, c.name AS customer_name, p.name AS project_name FROM service_retainers r JOIN customers c ON c.id = r.customer_id LEFT JOIN projects p ON p.id = r.project_id WHERE r.tenant_id = ${tenantId} ORDER BY r.is_active DESC, c.name, r.title`,
    );
  }

  /** Dipakai oleh RetainerService.create */
  queryServiceRetainerForCreate(
    db: DbOrTx,
    tenantId: string,
    dto: RetainerDto,
    fee: Decimal,
    start: string,
    end: string | null,
    sub: string,
  ) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO service_retainers (tenant_id, customer_id, project_id, title, monthly_fee, with_vat, start_date, end_date, created_by_id) VALUES (${tenantId}, ${dto.customerId}, ${dto.projectId ?? null}, ${dto.title.trim()}, ${fee.toFixed(2)}, ${dto.withVat ?? null}, ${start}, ${end}, ${sub}) RETURNING id`,
    );
  }

  /** Dipakai oleh RetainerService.update */
  queryServiceRetainerForUpdate(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Ret>(sql`SELECT * FROM service_retainers WHERE id = ${id} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh RetainerService.update */
  queryUpdate(
    db: DbOrTx,
    fee: Decimal | null,
    monthly_fee: string,
    end: string | undefined,
    end_date: string | null,
    dto: RetainerUpdateDto,
    is_active: boolean,
    id: string,
  ) {
    return db.execute(
      sql`UPDATE service_retainers SET monthly_fee = ${fee ? fee.toFixed(2) : monthly_fee}, end_date = ${end ?? end_date}, is_active = ${dto.isActive ?? is_active} WHERE id = ${id}`,
    );
  }
}
