import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { Reconciliation, num, TOLERANCE } from './support-shared';

@Injectable()
export class SupportQueriesRepository {
  constructor(@InjectDb() private readonly db: Db) {}

  async rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>) {
    return (await this.db.execute<T>(q)).rows;
  }

  recon(
    key: string,
    title: string,
    left: Reconciliation['left'],
    right: Reconciliation['right'],
    note?: string,
  ): Reconciliation {
    const diff = num(left.value - right.value);
    return {
      key,
      title,
      left: { ...left, value: num(left.value) },
      right: { ...right, value: num(right.value) },
      diff,
      ok: Math.abs(diff) < TOLERANCE,
      note,
    };
  }

  /** Saldo akun (debit − kredit) per tanggal untuk akun bersistem tertentu atau seluruh akun kas */
  async glBalance(tenantId: string, asOf: string, where: ReturnType<typeof sql>) {
    const [r] = await this.rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${asOf} AND ${where}`);
    return Number(r.v);
  }
}
