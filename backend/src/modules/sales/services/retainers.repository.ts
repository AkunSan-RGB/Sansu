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
  included_hours: string | null;
  overage_rate: string | null;
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
      sql`INSERT INTO service_retainers (tenant_id, customer_id, project_id, title, monthly_fee, with_vat, included_hours, overage_rate, start_date, end_date, created_by_id) VALUES (${tenantId}, ${dto.customerId}, ${dto.projectId ?? null}, ${dto.title.trim()}, ${fee.toFixed(2)}, ${dto.withVat ?? null}, ${dto.includedHours ?? null}, ${dto.overageRate ?? null}, ${start}, ${end}, ${sub}) RETURNING id`,
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
    included_hours: string | null,
    overage_rate: string | null,
  ) {
    return db.execute(
      sql`UPDATE service_retainers SET monthly_fee = ${fee ? fee.toFixed(2) : monthly_fee}, end_date = ${end ?? end_date}, is_active = ${dto.isActive ?? is_active},
          included_hours = ${dto.includedHours !== undefined ? (Number(dto.includedHours) > 0 ? dto.includedHours : null) : included_hours},
          overage_rate = ${dto.overageRate !== undefined ? dto.overageRate : overage_rate} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh RetainerService.bill: jam tertagih yang sudah disetujui pada bulan penagihan (proyek retainer bila ada, jika tidak seluruh pelanggan) */
  queryApprovedHours(db: DbOrTx, tenantId: string, customerId: string, projectId: string | null, period: string) {
    return db.execute<{ id: string; hours: string }>(sql`
      SELECT id, hours FROM time_entries
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND billable AND status = 'APPROVED'
        AND to_char(work_date, 'YYYY-MM') = ${period} ${projectId ? sql`AND project_id = ${projectId}` : sql``}`);
  }

  /** Dipakai oleh RetainerService.bill: catatan waktu bulan itu yang belum diputuskan menahan penagihan */
  countPendingHours(db: DbOrTx, tenantId: string, customerId: string, projectId: string | null, period: string) {
    return db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM time_entries
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND billable AND status IN ('DRAFT', 'SUBMITTED')
        AND to_char(work_date, 'YYYY-MM') = ${period} ${projectId ? sql`AND project_id = ${projectId}` : sql``}`);
  }

  /** Dipakai oleh RetainerService.bill: catatan waktu yang tercakup retainer ditandai sudah ditagih pada faktur retainer (tidak dapat ditagih lagi lewat timesheet) */
  markHoursBilled(db: DbOrTx, tenantId: string, ids: string[], invoiceId: string) {
    return db.execute<{ id: string }>(sql`
      UPDATE time_entries SET status = 'BILLED', invoice_id = ${invoiceId}
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) RETURNING id`);
  }
}
