import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface CandidateRow {
  connection_id: string; number: string; address: string; customer: string; phone: string | null; email: string | null;
  outstanding: string; bills: number; periods: string; invoice_numbers: string; invoice_id: string; oldest_due: string; days_late: number; last_notice_at: string | null; last_notice_kind: string | null;
}

@Injectable()
export class NoticesRepository {
  /**
   * Sambungan yang layak menerima surat: satu baris per sambungan dengan tagihan air yang masih terbuka.
   * `mode` menyaring tagihan: REKENING = tagihan satu periode, PENGINGAT = jatuh tempo dalam 3 hari, TUNGGAKAN = sudah lewat jatuh tempo.
   */
  candidates(db: DbOrTx, tenantId: string, today: string, mode: 'REKENING' | 'PENGINGAT' | 'TUNGGAKAN', period: string | null, limit = 1000) {
    const cond =
      mode === 'REKENING' ? sql`b.period = ${period}`
      : mode === 'PENGINGAT' ? sql`i.due_date >= ${today}::date AND i.due_date <= ${today}::date + 3`
      : sql`i.due_date < ${today}::date`;
    return rowsOf<CandidateRow>(db, sql`
      SELECT c.id AS connection_id, c.number, c.address, cu.name AS customer, cu.phone, cu.email,
        SUM(i.total - i.paid_amount - i.returned_amount)::text AS outstanding, COUNT(*)::int AS bills, string_agg(b.period, ', ' ORDER BY b.period) AS periods, string_agg(i.number, ', ' ORDER BY b.period) AS invoice_numbers,
        (array_agg(i.id ORDER BY i.due_date))[1] AS invoice_id, MIN(i.due_date)::text AS oldest_due, GREATEST(0, ${today}::date - MIN(i.due_date))::int AS days_late,
        (ln.sent_at AT TIME ZONE 'Asia/Jakarta')::date::text AS last_notice_at, ln.kind AS last_notice_kind
      FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN LATERAL (SELECT sent_at, kind FROM utility_notices n WHERE n.connection_id = c.id ORDER BY n.sent_at DESC LIMIT 1) ln ON true
      WHERE i.tenant_id = ${tenantId} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND ${cond}
      GROUP BY c.id, cu.name, cu.phone, cu.email, ln.sent_at, ln.kind ORDER BY c.number LIMIT ${limit}`);
  }
  tenantName(db: DbOrTx, tenantId: string) { return firstOf<{ name: string; address: string | null }>(db, sql`SELECT name, address FROM tenants WHERE id = ${tenantId}`); }
  /** Sambungan yang memang milik perusahaan ini (menolak id sembarang pada pencatatan massal) */
  validConnections(db: DbOrTx, tenantId: string, ids: string[]) {
    return rowsOf<{ id: string }>(db, sql`SELECT id FROM utility_connections WHERE tenant_id = ${tenantId} AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }
  async log(db: DbOrTx, tenantId: string, userId: string, kind: string, channel: string, items: { connectionId: string; invoiceId?: string }[], note: string | null) {
    for (const it of items) {
      await db.execute(sql`INSERT INTO utility_notices (tenant_id, kind, connection_id, invoice_id, channel, sent_by_id, note) VALUES (${tenantId}, ${kind}, ${it.connectionId}, ${it.invoiceId ?? null}, ${channel}, ${userId}, ${note})`);
    }
  }
  history(db: DbOrTx, tenantId: string, f: { connectionId?: string; kind?: string }) {
    return rowsOf(db, sql`
      SELECT n.id, n.kind, n.channel, n.sent_at, n.note, c.number AS connection, cu.name AS customer, u.name AS sent_by
      FROM utility_notices n JOIN utility_connections c ON c.id = n.connection_id JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = n.sent_by_id
      WHERE n.tenant_id = ${tenantId} AND (${f.connectionId ?? null}::uuid IS NULL OR n.connection_id = ${f.connectionId ?? null}::uuid) AND (${f.kind ?? null}::text IS NULL OR n.kind = ${f.kind ?? null})
      ORDER BY n.sent_at DESC LIMIT 300`);
  }
  summary(db: DbOrTx, tenantId: string) {
    return rowsOf<{ kind: string; channel: string; n: number }>(db, sql`SELECT kind, channel, COUNT(*)::int AS n FROM utility_notices WHERE tenant_id = ${tenantId} AND sent_at >= now() - interval '30 days' GROUP BY kind, channel`);
  }
}
