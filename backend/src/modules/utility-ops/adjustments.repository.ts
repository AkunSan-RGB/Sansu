import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NON_AIR_CHARGE_KEYS } from '@sansu/shared';
import { DbOrTx } from '../../db/db';
import { firstOf, inList, rowsOf } from './ops.repository';

export interface AdjustmentRow {
  id: string; number: string; invoice_id: string; invoice_number: string; customer_name: string; connection_number: string | null; kind: string; amount: string; reason: string; status: string;
  requested_by_id: string; requester_name: string | null; decided_by_id: string | null; decider_name: string | null; decided_at: string | null; decision_note: string | null; return_id: string | null; created_at: string;
}
export interface InvoiceFacts { id: string; number: string; customer_id: string; subtotal: string; tax_amount: string; total: string; paid_amount: string; returned_amount: string; date: string; late_fee_lines: string; is_utility: boolean }

@Injectable()
export class AdjustmentsRepository {
  private base() {
    return sql`SELECT a.id, a.number, a.invoice_id, i.number AS invoice_number, cu.name AS customer_name, uc.number AS connection_number, a.kind, a.amount::text, a.reason, a.status, a.requested_by_id, ru.name AS requester_name,
        a.decided_by_id, du.name AS decider_name, a.decided_at::text, a.decision_note, a.return_id, a.created_at::text
      FROM utility_adjustments a JOIN invoices i ON i.id = a.invoice_id JOIN customers cu ON cu.id = i.customer_id LEFT JOIN utility_connections uc ON uc.id = a.connection_id
      LEFT JOIN users ru ON ru.id = a.requested_by_id LEFT JOIN users du ON du.id = a.decided_by_id`;
  }
  list(db: DbOrTx, tenantId: string, status?: string) {
    return rowsOf<AdjustmentRow>(db, sql`${this.base()} WHERE a.tenant_id = ${tenantId} AND (${status ?? null}::text IS NULL OR a.status = ${status ?? null}) ORDER BY (a.status <> 'DIAJUKAN'), a.created_at DESC LIMIT 300`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) { return firstOf<AdjustmentRow>(db, sql`${this.base()} WHERE a.tenant_id = ${tenantId} AND a.id = ${id}`); }

  /** Faktur air/non-air yang masih punya sisa untuk dicari saat mengajukan koreksi */
  searchInvoices(db: DbOrTx, tenantId: string, q: string) {
    const like = `%${q.trim()}%`;
    return rowsOf<{ id: string; number: string; customer: string; connection: string | null; date: string; total: string; paid: string; open: string; kind: string }>(db, sql`
      SELECT * FROM (
        SELECT i.id, i.number, cu.name AS customer, uc.number AS connection, i.date::text AS date, i.total::text AS total, i.paid_amount::text AS paid, (i.total - i.paid_amount - i.returned_amount)::text AS open, 'AIR' AS kind
        FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN customers cu ON cu.id = i.customer_id JOIN utility_connections uc ON uc.id = b.connection_id
        WHERE b.tenant_id = ${tenantId} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND (cu.name ILIKE ${like} OR i.number ILIKE ${like} OR uc.number ILIKE ${like})
        UNION ALL
        SELECT i.id, i.number, cu.name, NULL, i.date::text, i.total::text, i.paid_amount::text, (i.total - i.paid_amount - i.returned_amount)::text, 'NON_AIR'
        FROM invoices i JOIN customers cu ON cu.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND NOT EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id)
          AND EXISTS (SELECT 1 FROM service_invoice_lines sl JOIN accounts sa ON sa.id = sl.account_id WHERE sl.invoice_id = i.id AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}))
          AND i.total - i.paid_amount - i.returned_amount > 0.5 AND (cu.name ILIKE ${like} OR i.number ILIKE ${like})
      ) x ORDER BY x.date DESC LIMIT 30`);
  }
  /** Faktur beserta bagian denda; `lock` mengunci barisnya selama transaksi persetujuan */
  async invoice(db: DbOrTx, tenantId: string, id: string, lock = false) {
    return firstOf<InvoiceFacts>(db, sql`
      SELECT i.id, i.number, i.customer_id, i.subtotal::text, i.tax_amount::text, i.total::text, i.paid_amount::text, i.returned_amount::text, i.date::text,
        COALESCE((SELECT SUM(sl.line_total) FROM service_invoice_lines sl JOIN accounts sa ON sa.id = sl.account_id WHERE sl.invoice_id = i.id AND sa.system_key = 'UTILITY_LATE_FEE_REVENUE'), 0)::text AS late_fee_lines,
        (EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id) OR EXISTS (SELECT 1 FROM service_invoice_lines sl JOIN accounts sa ON sa.id = sl.account_id WHERE sl.invoice_id = i.id AND sa.system_key IN (${inList(NON_AIR_CHARGE_KEYS)}))) AS is_utility
      FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.id = ${id} ${lock ? sql`FOR UPDATE OF i` : sql``}`);
  }
  async connectionOf(db: DbOrTx, tenantId: string, invoiceId: string) {
    const r = await firstOf<{ connection_id: string }>(db, sql`SELECT connection_id FROM utility_bills WHERE tenant_id = ${tenantId} AND invoice_id = ${invoiceId}`);
    return r?.connection_id ?? null;
  }
  /** Jumlah koreksi yang sudah menunggu atau disetujui untuk sebuah faktur, boleh dibatasi satu jenis */
  async reserved(db: DbOrTx, tenantId: string, invoiceId: string, kind?: string) {
    const r = await firstOf<{ v: string }>(db, sql`SELECT COALESCE(SUM(amount), 0)::text AS v FROM utility_adjustments WHERE tenant_id = ${tenantId} AND invoice_id = ${invoiceId} AND status IN ('DIAJUKAN', 'DISETUJUI')
      AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null})`);
    return Number(r?.v ?? 0);
  }
  /** Hanya yang masih menunggu (belum memotong faktur) */
  async pending(db: DbOrTx, tenantId: string, invoiceId: string) {
    const r = await firstOf<{ v: string }>(db, sql`SELECT COALESCE(SUM(amount), 0)::text AS v FROM utility_adjustments WHERE tenant_id = ${tenantId} AND invoice_id = ${invoiceId} AND status = 'DIAJUKAN'`);
    return Number(r?.v ?? 0);
  }
  async insert(db: DbOrTx, v: { tenantId: string; number: string; invoiceId: string; connectionId: string | null; kind: string; amount: string; reason: string; requestedById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_adjustments (tenant_id, number, invoice_id, connection_id, kind, amount, reason, requested_by_id) VALUES (${v.tenantId}, ${v.number}, ${v.invoiceId}, ${v.connectionId}, ${v.kind}, ${v.amount}::numeric, ${v.reason}, ${v.requestedById}) RETURNING id`);
    return r!.id;
  }
  async decide(db: DbOrTx, tenantId: string, id: string, status: string, userId: string, note: string | null, returnId: string | null) {
    await db.execute(sql`UPDATE utility_adjustments SET status = ${status}, decided_by_id = ${userId}, decided_at = now(), decision_note = ${note}, return_id = ${returnId} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async defaultWarehouse(db: DbOrTx, tenantId: string) {
    const r = await firstOf<{ id: string }>(db, sql`SELECT id FROM warehouses WHERE tenant_id = ${tenantId} ORDER BY id LIMIT 1`);
    return r?.id ?? null;
  }
  /** Nota kredit tanpa baris barang: dicatat di daftar retur penjualan agar semua laporan piutang dan PPN ikut berubah */
  async insertCreditNote(db: DbOrTx, v: { tenantId: string; number: string; date: string; invoiceId: string; customerId: string; warehouseId: string; reason: string; subtotal: string; tax: string; total: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO sales_returns (tenant_id, number, date, invoice_id, customer_id, warehouse_id, reason, subtotal, tax_amount, total, cost_amount)
      VALUES (${v.tenantId}, ${v.number}, ${v.date}::date, ${v.invoiceId}, ${v.customerId}, ${v.warehouseId}, ${v.reason}, ${v.subtotal}::numeric, ${v.tax}::numeric, ${v.total}::numeric, 0) RETURNING id`);
    return r!.id;
  }
  async linkCreditNoteJournal(db: DbOrTx, tenantId: string, returnId: string, journalId: string) {
    await db.execute(sql`UPDATE sales_returns SET journal_id = ${journalId} WHERE tenant_id = ${tenantId} AND id = ${returnId}`);
  }
  async applyToInvoice(db: DbOrTx, tenantId: string, invoiceId: string, amount: string) {
    await db.execute(sql`UPDATE invoices SET returned_amount = returned_amount + ${amount}::numeric,
      status = CASE WHEN returned_amount + ${amount}::numeric + paid_amount >= total THEN 'PAID'::invoice_status ELSE 'PARTIAL'::invoice_status END WHERE tenant_id = ${tenantId} AND id = ${invoiceId}`);
  }
  summary(db: DbOrTx, tenantId: string) {
    return firstOf<{ pending: number; pending_amount: string; approved_30d: string }>(db, sql`SELECT COUNT(*) FILTER (WHERE status = 'DIAJUKAN')::int AS pending, COALESCE(SUM(amount) FILTER (WHERE status = 'DIAJUKAN'), 0)::text AS pending_amount,
      COALESCE(SUM(amount) FILTER (WHERE status = 'DISETUJUI' AND decided_at >= now() - interval '30 days'), 0)::text AS approved_30d FROM utility_adjustments WHERE tenant_id = ${tenantId}`);
  }
}
