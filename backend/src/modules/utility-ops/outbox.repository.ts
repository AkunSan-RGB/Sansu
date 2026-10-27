import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { rowsOf } from './ops.repository';

export interface OutboxRow { id: string; tenant_id: string; kind: string; channel: string; connection_id: string; invoice_id: string | null; to_address: string; message: string; status: string; attempts: number; last_error: string | null; next_try_at: string; sent_at: string | null; created_by_id: string | null; created_at: string; customer?: string; connection?: string }

@Injectable()
export class OutboxRepository {
  /** Masukkan ke antrean; baris yang masih menunggu untuk sambungan, jenis, dan kanal yang sama dilewati (indeks unik sebagian) */
  async enqueue(db: DbOrTx, v: { tenantId: string; kind: string; channel: string; connectionId: string; invoiceId: string | null; to: string; message: string; userId: string }) {
    const r = await rowsOf<{ id: string }>(db, sql`INSERT INTO utility_outbox (tenant_id, kind, channel, connection_id, invoice_id, to_address, message, created_by_id)
      VALUES (${v.tenantId}, ${v.kind}, ${v.channel}, ${v.connectionId}, ${v.invoiceId}, ${v.to}, ${v.message}, ${v.userId}) ON CONFLICT DO NOTHING RETURNING id`);
    return r.length > 0;
  }
  list(db: DbOrTx, tenantId: string, status?: string) {
    return rowsOf<OutboxRow>(db, sql`SELECT o.id, o.kind, o.channel, o.connection_id, o.to_address, o.message, o.status, o.attempts, o.last_error, o.next_try_at::text, o.sent_at::text, o.created_at::text, cu.name AS customer, c.number AS connection
      FROM utility_outbox o JOIN utility_connections c ON c.id = o.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE o.tenant_id = ${tenantId} AND (${status ?? null}::text IS NULL OR o.status = ${status ?? null}) ORDER BY o.created_at DESC LIMIT 300`);
  }
  summary(db: DbOrTx, tenantId: string) { return rowsOf<{ status: string; n: number }>(db, sql`SELECT status, COUNT(*)::int AS n FROM utility_outbox WHERE tenant_id = ${tenantId} GROUP BY status`); }
  /** Ambil sejumlah pesan untuk dikirim dan tandai MENGIRIM; aman dijalankan beberapa server sekaligus (SKIP LOCKED) */
  claim(db: DbOrTx, limit: number, tenantId?: string) {
    return rowsOf<OutboxRow>(db, sql`UPDATE utility_outbox SET status = 'MENGIRIM', next_try_at = now() + interval '2 minutes'
      WHERE id IN (SELECT id FROM utility_outbox WHERE status IN ('ANTRE', 'MENGIRIM') AND next_try_at <= now() AND (${tenantId ?? null}::uuid IS NULL OR tenant_id = ${tenantId ?? null}::uuid) ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id, kind, channel, connection_id, invoice_id, to_address, message, attempts, created_by_id`);
  }
  async markSent(db: DbOrTx, id: string) { await db.execute(sql`UPDATE utility_outbox SET status = 'TERKIRIM', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${id}`); }
  async markFailed(db: DbOrTx, id: string, attempts: number, error: string, final: boolean) {
    await db.execute(sql`UPDATE utility_outbox SET status = ${final ? 'GAGAL' : 'ANTRE'}, attempts = ${attempts}, last_error = ${error.slice(0, 300)}, next_try_at = now() + make_interval(mins => ${Math.min(60, 2 ** attempts)}) WHERE id = ${id}`);
  }
  async retry(db: DbOrTx, tenantId: string, id: string) {
    const r = await rowsOf(db, sql`UPDATE utility_outbox SET status = 'ANTRE', attempts = 0, last_error = NULL, next_try_at = now() WHERE tenant_id = ${tenantId} AND id = ${id} AND status IN ('GAGAL', 'BATAL') RETURNING id`);
    return r.length > 0;
  }
  async cancel(db: DbOrTx, tenantId: string, id: string) {
    const r = await rowsOf(db, sql`UPDATE utility_outbox SET status = 'BATAL' WHERE tenant_id = ${tenantId} AND id = ${id} AND status IN ('ANTRE', 'GAGAL') RETURNING id`);
    return r.length > 0;
  }
}
