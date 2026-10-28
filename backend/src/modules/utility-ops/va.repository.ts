import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { textArray } from '../../common/utils/sql-guard';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface VaRow { id: string; reference: string; va_number: string; connection_id: string | null; connection_number: string | null; customer_name: string | null; amount: string; paid_at: string; channel: string | null; status: string; applied: string; unapplied: string; payment_numbers: string[]; message: string | null; created_at: string }

@Injectable()
export class VaRepository {
  connectionBySuffix(db: DbOrTx, tenantId: string, suffix: string) {
    return firstOf<{ id: string; number: string; customer_id: string }>(db, sql`SELECT id, number, customer_id FROM utility_connections WHERE tenant_id = ${tenantId} AND va_suffix = ${suffix}`);
  }
  connectionById(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; number: string; customer_id: string; va_suffix: string | null }>(db, sql`SELECT id, number, customer_id, va_suffix FROM utility_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  byReference(db: DbOrTx, tenantId: string, reference: string) {
    return firstOf<VaRow>(db, sql`SELECT ${this.cols()} FROM utility_va_payments p LEFT JOIN utility_connections c ON c.id = p.connection_id LEFT JOIN customers cu ON cu.id = c.customer_id WHERE p.tenant_id = ${tenantId} AND p.reference = ${reference}`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<VaRow>(db, sql`SELECT ${this.cols()} FROM utility_va_payments p LEFT JOIN utility_connections c ON c.id = p.connection_id LEFT JOIN customers cu ON cu.id = c.customer_id WHERE p.tenant_id = ${tenantId} AND p.id = ${id}`);
  }
  private cols() { return sql`p.id, p.reference, p.va_number, p.connection_id, c.number AS connection_number, cu.name AS customer_name, p.amount::text, p.paid_at::text, p.channel, p.status, p.applied::text, p.unapplied::text, p.payment_numbers, p.message, p.created_at::text`; }
  list(db: DbOrTx, tenantId: string, status?: string) {
    return rowsOf<VaRow>(db, sql`SELECT ${this.cols()} FROM utility_va_payments p LEFT JOIN utility_connections c ON c.id = p.connection_id LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE p.tenant_id = ${tenantId} AND (${status ?? null}::text IS NULL OR p.status = ${status ?? null}) ORDER BY p.created_at DESC LIMIT 300`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; reference: string; vaNumber: string; connectionId: string | null; amount: string; paidAt: string; channel: string | null; status: string; unapplied: string; message: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_va_payments (tenant_id, reference, va_number, connection_id, amount, paid_at, channel, status, unapplied, message)
      VALUES (${v.tenantId}, ${v.reference}, ${v.vaNumber}, ${v.connectionId}, ${v.amount}, ${v.paidAt}, ${v.channel}, ${v.status}, ${v.unapplied}, ${v.message}) RETURNING id`);
    return r!.id;
  }
  async update(db: DbOrTx, id: string, v: { connectionId?: string | null; status: string; applied: string; unapplied: string; paymentNumbers: string[]; message: string | null; handledById?: string }) {
    await db.execute(sql`UPDATE utility_va_payments SET connection_id = COALESCE(${v.connectionId ?? null}, connection_id), status = ${v.status}, applied = ${v.applied}, unapplied = ${v.unapplied},
      payment_numbers = ${textArray(v.paymentNumbers)}, message = ${v.message}, handled_by_id = COALESCE(${v.handledById ?? null}::uuid, handled_by_id) WHERE id = ${id}`);
  }
  /** Catatan penerimaan agar pembayaran VA ikut laporan penerimaan (tanpa loket); dipanggil di dalam transaksi pembayaran */
  async insertReceipt(db: DbOrTx, v: { tenantId: string; paymentId: string; invoiceId: string; collectorId: string; amount: string }) {
    await db.execute(sql`INSERT INTO utility_counter_receipts (tenant_id, payment_id, invoice_id, collector_id, amount, method, counter_id, channel) VALUES (${v.tenantId}, ${v.paymentId}, ${v.invoiceId}, ${v.collectorId}, ${v.amount}, 'TRANSFER', NULL, 'VA')`);
  }
  /** Tagihan air terbuka satu sambungan, paling lama jatuh tempo lebih dulu */
  openInvoices(db: DbOrTx, tenantId: string, connectionId: string) {
    return rowsOf<{ id: string; number: string; outstanding: string }>(db, sql`
      SELECT i.id, i.number, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.total - i.paid_amount - i.returned_amount > 0.005 ORDER BY i.due_date, i.date, i.number`);
  }
  async summary(db: DbOrTx, tenantId: string) {
    return rowsOf<{ status: string; n: number; amount: string; unapplied: string }>(db, sql`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS amount, COALESCE(SUM(unapplied), 0)::text AS unapplied FROM utility_va_payments WHERE tenant_id = ${tenantId} GROUP BY status`);
  }
  vaOf(db: DbOrTx, tenantId: string, connectionIds: string[]) {
    return rowsOf<{ id: string; va_suffix: string | null }>(db, sql`SELECT id, va_suffix FROM utility_connections WHERE tenant_id = ${tenantId} AND id IN (${sql.join(connectionIds.map((c) => sql`${c}::uuid`), sql`, `)})`);
  }
}
