import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface DepositRow { id: string; number: string; customer_id: string; customer_name: string; connection_id: string | null; connection_number: string | null; amount: string; received_on: string; method: string; note: string | null; created_by_id: string | null; remaining: string; created_at: string }
export interface MovementRow { id: string; deposit_id: string; date: string; kind: string; amount: string; invoice_number: string | null; user_name: string | null; note: string | null }

@Injectable()
export class DepositsRepository {
  private base() {
    return sql`SELECT d.id, d.number, d.customer_id, cu.name AS customer_name, d.connection_id, uc.number AS connection_number, d.amount::text, d.received_on::text, d.method, d.note, d.created_by_id,
        (d.amount - COALESCE((SELECT SUM(m.amount) FROM utility_deposit_movements m WHERE m.deposit_id = d.id AND m.kind <> 'PENERIMAAN'), 0))::text AS remaining, d.created_at::text
      FROM utility_deposits d JOIN customers cu ON cu.id = d.customer_id LEFT JOIN utility_connections uc ON uc.id = d.connection_id`;
  }
  list(db: DbOrTx, tenantId: string, openOnly: boolean) {
    return rowsOf<DepositRow>(db, sql`SELECT * FROM (${this.base()} WHERE d.tenant_id = ${tenantId}) x WHERE (${openOnly}::boolean = false OR x.remaining::numeric > 0.005) ORDER BY x.received_on DESC, x.number DESC LIMIT 300`);
  }
  byId(db: DbOrTx, tenantId: string, id: string, lock = false) {
    return firstOf<DepositRow>(db, sql`${this.base()} WHERE d.tenant_id = ${tenantId} AND d.id = ${id} ${lock ? sql`FOR UPDATE OF d` : sql``}`);
  }
  movements(db: DbOrTx, tenantId: string, depositId: string) {
    return rowsOf<MovementRow>(db, sql`SELECT m.id, m.deposit_id, m.date::text, m.kind, m.amount::text, i.number AS invoice_number, u.name AS user_name, m.note FROM utility_deposit_movements m
      LEFT JOIN invoices i ON i.id = m.invoice_id LEFT JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId} AND m.deposit_id = ${depositId} ORDER BY m.date, m.created_at`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; number: string; customerId: string; connectionId: string | null; amount: string; receivedOn: string; method: string; cashAccountId: string; note: string | null; createdById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_deposits (tenant_id, number, customer_id, connection_id, amount, received_on, method, cash_account_id, note, created_by_id)
      VALUES (${v.tenantId}, ${v.number}, ${v.customerId}, ${v.connectionId}, ${v.amount}::numeric, ${v.receivedOn}::date, ${v.method}, ${v.cashAccountId}, ${v.note}, ${v.createdById}) RETURNING id`);
    return r!.id;
  }
  async setJournal(db: DbOrTx, tenantId: string, id: string, journalId: string) {
    await db.execute(sql`UPDATE utility_deposits SET journal_id = ${journalId} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setPaymentJournal(db: DbOrTx, tenantId: string, id: string, journalId: string) {
    await db.execute(sql`UPDATE payments SET journal_id = ${journalId} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async addMovement(db: DbOrTx, v: { tenantId: string; depositId: string; date: string; kind: string; amount: string; invoiceId?: string | null; paymentId?: string | null; journalId?: string | null; userId: string; note?: string | null }) {
    await db.execute(sql`INSERT INTO utility_deposit_movements (tenant_id, deposit_id, date, kind, amount, invoice_id, payment_id, journal_id, user_id, note)
      VALUES (${v.tenantId}, ${v.depositId}, ${v.date}::date, ${v.kind}, ${v.amount}::numeric, ${v.invoiceId ?? null}, ${v.paymentId ?? null}, ${v.journalId ?? null}, ${v.userId}, ${v.note ?? null})`);
  }
  async insertPayment(db: DbOrTx, v: { tenantId: string; number: string; date: string; customerId: string; invoiceId: string; amount: string; notes: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO payments (tenant_id, number, date, customer_id, invoice_id, amount, method, cash_account_id, notes)
      VALUES (${v.tenantId}, ${v.number}, ${v.date}::date, ${v.customerId}, ${v.invoiceId}, ${v.amount}::numeric, 'JAMINAN', NULL, ${v.notes}) RETURNING id`);
    return r!.id;
  }
  async payInvoice(db: DbOrTx, tenantId: string, invoiceId: string, amount: string) {
    await db.execute(sql`UPDATE invoices SET paid_amount = paid_amount + ${amount}::numeric, status = CASE WHEN paid_amount + ${amount}::numeric + returned_amount >= total THEN 'PAID'::invoice_status ELSE 'PARTIAL'::invoice_status END WHERE tenant_id = ${tenantId} AND id = ${invoiceId}`);
  }
  /** Sisa tagihan air/non-air seluruh sambungan pelanggan (dipakai menahan pengembalian jaminan) */
  async customerOpenUtility(db: DbOrTx, tenantId: string, customerId: string) {
    const r = await firstOf<{ v: string }>(db, sql`SELECT COALESCE(SUM(i.total - i.paid_amount - i.returned_amount), 0)::text AS v FROM invoices i
      WHERE i.tenant_id = ${tenantId} AND i.customer_id = ${customerId} AND i.total - i.paid_amount - i.returned_amount > 0.5
        AND (EXISTS (SELECT 1 FROM utility_bills b WHERE b.invoice_id = i.id) OR EXISTS (SELECT 1 FROM service_invoice_lines sl JOIN accounts a ON a.id = sl.account_id WHERE sl.invoice_id = i.id AND a.system_key LIKE 'UTILITY\\_%'))`);
    return Number(r?.v ?? 0);
  }
  summary(db: DbOrTx, tenantId: string) {
    return firstOf<{ held: string; count: number }>(db, sql`SELECT COALESCE(SUM(x.remaining::numeric), 0)::text AS held, COUNT(*) FILTER (WHERE x.remaining::numeric > 0.005)::int AS count FROM (${this.base()} WHERE d.tenant_id = ${tenantId}) x`);
  }
}
