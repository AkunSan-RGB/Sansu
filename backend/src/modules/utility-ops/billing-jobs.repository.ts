import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface JobRow { id: string; period: string; status: string; total: number; done: number; failed: number; billed_total: string; held: number; error: string | null; started_by: string | null; started_at: string; finished_at: string | null; stale: boolean }

@Injectable()
export class BillingJobsRepository {
  private cols() { return sql`j.id, j.period, j.status, j.total, j.done, j.failed, j.billed_total::text, j.held, j.error, u.name AS started_by, j.started_at::text, j.finished_at::text, (j.status = 'BERJALAN' AND j.heartbeat_at < now() - interval '3 minutes') AS stale`; }
  /** Pekerjaan yang masih BERJALAN tetapi tak ada detak lebih dari 3 menit (server berhenti): ditandai terhenti agar bisa dimulai lagi */
  async expireStale(db: DbOrTx, tenantId: string) {
    await db.execute(sql`UPDATE utility_billing_jobs SET status = 'TERHENTI', finished_at = now(), error = 'Server berhenti di tengah proses; jalankan lagi, sambungan yang sudah ditagih dilewati' WHERE tenant_id = ${tenantId} AND status = 'BERJALAN' AND heartbeat_at < now() - interval '3 minutes'`);
  }
  async insert(db: DbOrTx, tenantId: string, period: string, userId: string) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_billing_jobs (tenant_id, period, started_by_id) VALUES (${tenantId}, ${period}, ${userId}) RETURNING id`);
    return r!.id;
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<JobRow>(db, sql`SELECT ${this.cols()} FROM utility_billing_jobs j LEFT JOIN users u ON u.id = j.started_by_id WHERE j.tenant_id = ${tenantId} AND j.id = ${id}`);
  }
  recent(db: DbOrTx, tenantId: string) {
    return rowsOf<JobRow>(db, sql`SELECT ${this.cols()} FROM utility_billing_jobs j LEFT JOIN users u ON u.id = j.started_by_id WHERE j.tenant_id = ${tenantId} ORDER BY j.started_at DESC LIMIT 10`);
  }
  async progress(db: DbOrTx, id: string, v: { total: number; done: number; failed: number }) {
    await db.execute(sql`UPDATE utility_billing_jobs SET total = ${v.total}, done = ${v.done}, failed = ${v.failed}, heartbeat_at = now() WHERE id = ${id}`);
  }
  async finish(db: DbOrTx, id: string, v: { status: 'SELESAI' | 'GAGAL'; total: number; done: number; failed: number; billedTotal: number; held: number; error?: string }) {
    await db.execute(sql`UPDATE utility_billing_jobs SET status = ${v.status}, total = ${v.total}, done = ${v.done}, failed = ${v.failed}, billed_total = ${v.billedTotal.toFixed(2)}, held = ${v.held}, error = ${v.error ?? null}, finished_at = now(), heartbeat_at = now() WHERE id = ${id}`);
  }
}
