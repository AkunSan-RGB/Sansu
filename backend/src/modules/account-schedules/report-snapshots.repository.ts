import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { reportSnapshots, users } from '../../db/schema';

/** Akses data snapshot laporan keuangan yang dibekukan (rekaman tambah-saja) */
@Injectable()
export class ReportSnapshotsRepository {
  async maxVersion(db: DbOrTx, tenantId: string, year: number) {
    const r = await db.execute<{ v: number }>(sql`SELECT COALESCE(MAX(version), 0)::int AS v FROM report_snapshots WHERE tenant_id = ${tenantId} AND year = ${year}`);
    return r.rows[0].v;
  }

  async insert(db: DbOrTx, row: typeof reportSnapshots.$inferInsert) {
    const [r] = await db.insert(reportSnapshots).values(row).returning();
    return r;
  }

  /** Daftar versi tanpa isi (isi snapshot besar) */
  list(db: DbOrTx, tenantId: string, year?: number) {
    return db
      .select({
        id: reportSnapshots.id,
        year: reportSnapshots.year,
        version: reportSnapshots.version,
        signedByName: reportSnapshots.signedByName,
        signedAt: reportSnapshots.signedAt,
        note: reportSnapshots.note,
        contentHash: reportSnapshots.contentHash,
      })
      .from(reportSnapshots)
      .where(and(eq(reportSnapshots.tenantId, tenantId), year ? eq(reportSnapshots.year, year) : undefined))
      .orderBy(desc(reportSnapshots.year), desc(reportSnapshots.version));
  }

  /** Versi tertentu, atau yang terbaru bila versi tidak disebut */
  async find(db: DbOrTx, tenantId: string, year: number, version?: number) {
    const [r] = await db
      .select()
      .from(reportSnapshots)
      .where(and(eq(reportSnapshots.tenantId, tenantId), eq(reportSnapshots.year, year), version ? eq(reportSnapshots.version, version) : undefined))
      .orderBy(desc(reportSnapshots.version))
      .limit(1);
    return r;
  }

  async userName(db: DbOrTx, userId: string) {
    const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    return u ? `${u.name}` : userId;
  }

  /** Jurnal bertanggal dalam tahun itu yang dibukukan SETELAH snapshot dibekukan (jurnal susulan) */
  lateJournals(db: DbOrTx, tenantId: string, year: number, since: Date) {
    return db.execute<{ number: string; date: string; description: string; source_type: string; created_at: string; total: string }>(sql`
      SELECT j.number, j.date::text AS date, j.description, j.source_type, j.created_at::text AS created_at,
             COALESCE((SELECT SUM(l.debit) FROM journal_lines l WHERE l.journal_id = j.id), 0)::text AS total
      FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`} AND j.created_at > ${since.toISOString()}
      ORDER BY j.created_at LIMIT 500`);
  }
}
