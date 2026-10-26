import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InstallmentRow } from '@sansu/shared';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.shared';

export interface PlanRow { id: string; number: string; customer_id: string; customer_name: string; connection_id: string | null; connection_number: string | null; total: string; status: string; note: string | null; requested_by_id: string; requester_name: string | null; decided_by_id: string | null; decided_at: string | null; start_date: string | null; created_at: string; paid_since: string }

@Injectable()
export class InstallmentsRepository {
  private base() {
    return sql`SELECT p.id, p.number, p.customer_id, cu.name AS customer_name, p.connection_id, uc.number AS connection_number, p.total::text, p.status, p.note, p.requested_by_id, ru.name AS requester_name,
        p.decided_by_id, p.decided_at::text, p.start_date::text, p.created_at::text,
        COALESCE((SELECT SUM(i.paid_amount + i.returned_amount - ii.paid_at_start) FROM utility_installment_invoices ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.plan_id = p.id), 0)::text AS paid_since
      FROM utility_installment_plans p JOIN customers cu ON cu.id = p.customer_id LEFT JOIN utility_connections uc ON uc.id = p.connection_id LEFT JOIN users ru ON ru.id = p.requested_by_id`;
  }
  list(db: DbOrTx, tenantId: string, status?: string) {
    return rowsOf<PlanRow>(db, sql`${this.base()} WHERE p.tenant_id = ${tenantId} AND (${status ?? null}::text IS NULL OR p.status = ${status ?? null}) ORDER BY (p.status IN ('LUNAS', 'BATAL')), p.created_at DESC LIMIT 200`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) { return firstOf<PlanRow>(db, sql`${this.base()} WHERE p.tenant_id = ${tenantId} AND p.id = ${id}`); }
  items(db: DbOrTx, planId: string) {
    return rowsOf<{ seq: number; due_date: string; amount: string }>(db, sql`SELECT seq, due_date::text, amount::text FROM utility_installment_items WHERE plan_id = ${planId} ORDER BY seq`);
  }
  invoices(db: DbOrTx, planId: string) {
    return rowsOf<{ invoice_id: string; number: string; total: string; open: string }>(db, sql`SELECT ii.invoice_id, i.number, i.total::text, (i.total - i.paid_amount - i.returned_amount)::text AS open FROM utility_installment_invoices ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.plan_id = ${planId} ORDER BY i.date`);
  }
  /** Tagihan tunggakan milik sambungan yang masih punya sisa dan belum dicakup rencana aktif/diajukan */
  async coverable(db: DbOrTx, tenantId: string, connectionId: string) {
    return rowsOf<{ id: string; number: string; due_date: string; open: string; paid_at_start: string; late_days: number }>(db, sql`
      SELECT i.id, i.number, i.due_date::text, (i.total - i.paid_amount - i.returned_amount)::text AS open, (i.paid_amount + i.returned_amount)::text AS paid_at_start, GREATEST(0, (now() AT TIME ZONE 'Asia/Jakarta')::date - i.due_date)::int AS late_days
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND NOT EXISTS (SELECT 1 FROM utility_installment_invoices ii JOIN utility_installment_plans p ON p.id = ii.plan_id WHERE ii.invoice_id = i.id AND p.status IN ('DIAJUKAN', 'AKTIF', 'MACET'))
      ORDER BY i.due_date`);
  }
  connection(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; customer_id: string; number: string }>(db, sql`SELECT id, customer_id, number FROM utility_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; number: string; customerId: string; connectionId: string; total: string; note: string | null; requestedById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_installment_plans (tenant_id, number, customer_id, connection_id, total, note, requested_by_id) VALUES (${v.tenantId}, ${v.number}, ${v.customerId}, ${v.connectionId}, ${v.total}::numeric, ${v.note}, ${v.requestedById}) RETURNING id`);
    return r!.id;
  }
  async addItems(db: DbOrTx, tenantId: string, planId: string, items: InstallmentRow[]) {
    for (const it of items) await db.execute(sql`INSERT INTO utility_installment_items (tenant_id, plan_id, seq, due_date, amount) VALUES (${tenantId}, ${planId}, ${it.seq}, ${it.dueDate}::date, ${it.amount.toFixed(2)}::numeric)`);
  }
  async addInvoice(db: DbOrTx, tenantId: string, planId: string, invoiceId: string, paidAtStart: string) {
    await db.execute(sql`INSERT INTO utility_installment_invoices (tenant_id, plan_id, invoice_id, paid_at_start) VALUES (${tenantId}, ${planId}, ${invoiceId}, ${paidAtStart}::numeric)`);
  }
  async setStatus(db: DbOrTx, tenantId: string, id: string, status: string, userId?: string) {
    await db.execute(sql`UPDATE utility_installment_plans SET status = ${status}, decided_by_id = COALESCE(${userId ?? null}::uuid, decided_by_id), decided_at = CASE WHEN ${userId ?? null}::uuid IS NULL THEN decided_at ELSE now() END,
      start_date = CASE WHEN ${status} = 'AKTIF' AND start_date IS NULL THEN (now() AT TIME ZONE 'Asia/Jakarta')::date ELSE start_date END WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setNote(db: DbOrTx, tenantId: string, id: string, note: string) {
    await db.execute(sql`UPDATE utility_installment_plans SET note = ${note} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
}
