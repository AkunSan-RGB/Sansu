import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, utilityCounterClosings, utilityCounters } from '../../db/schema';

@Injectable()
export class UtilityCountersRepository {
  list(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: utilityCounters.id, code: utilityCounters.code, name: utilityCounters.name, location: utilityCounters.location, bankAccountId: utilityCounters.bankAccountId, isActive: utilityCounters.isActive, bankName: accounts.name })
      .from(utilityCounters)
      .leftJoin(accounts, eq(accounts.id, utilityCounters.bankAccountId))
      .where(eq(utilityCounters.tenantId, tenantId))
      .orderBy(asc(utilityCounters.code));
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return db.select().from(utilityCounters).where(and(eq(utilityCounters.tenantId, tenantId), eq(utilityCounters.id, id)));
  }
  insert(db: DbOrTx, row: typeof utilityCounters.$inferInsert) {
    return db.insert(utilityCounters).values(row).returning();
  }
  update(db: DbOrTx, tenantId: string, id: string, set: Partial<typeof utilityCounters.$inferInsert>) {
    return db.update(utilityCounters).set(set).where(and(eq(utilityCounters.tenantId, tenantId), eq(utilityCounters.id, id))).returning();
  }
  bankAccount(db: DbOrTx, tenantId: string, id: string) {
    return db.select({ id: accounts.id, isCashAccount: accounts.isCashAccount, currency: accounts.currency }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id)));
  }

  /** Penerimaan loket per loket, tanggal, dan kanal dalam rentang tanggal (tanggal = tanggal pembayaran) */
  recap(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ counter_id: string | null; code: string | null; name: string | null; date: string; channel: string; n: number; total: string }>(sql`
      SELECT r.counter_id, c.code, c.name, p.date::text AS date, COALESCE(r.channel, r.method) AS channel, COUNT(*)::int AS n, COALESCE(SUM(r.amount), 0)::text AS total
      FROM utility_counter_receipts r JOIN payments p ON p.id = r.payment_id LEFT JOIN utility_counters c ON c.id = r.counter_id
      WHERE r.tenant_id = ${tenantId} AND p.date BETWEEN ${from} AND ${to}
      GROUP BY r.counter_id, c.code, c.name, p.date, COALESCE(r.channel, r.method) ORDER BY p.date DESC, c.code NULLS LAST`);
  }

  /** Rincian penerimaan satu hari (opsional satu loket) */
  dayDetail(db: DbOrTx, tenantId: string, date: string, counterId?: string) {
    return db.execute<{ id: string; time: string; counter: string | null; channel: string; amount: string; invoice: string; customer: string; connection: string | null; collector: string | null; payment: string }>(sql`
      SELECT r.id, to_char(r.received_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time, c.name AS counter, COALESCE(r.channel, r.method) AS channel, r.amount::text AS amount,
             i.number AS invoice, cu.name AS customer, uc.number AS connection, u.name AS collector, p.number AS payment
      FROM utility_counter_receipts r JOIN payments p ON p.id = r.payment_id JOIN invoices i ON i.id = r.invoice_id JOIN customers cu ON cu.id = i.customer_id
      LEFT JOIN utility_counters c ON c.id = r.counter_id LEFT JOIN users u ON u.id = r.collector_id
      LEFT JOIN utility_bills ub ON ub.invoice_id = i.id LEFT JOIN utility_connections uc ON uc.id = ub.connection_id
      WHERE r.tenant_id = ${tenantId} AND p.date = ${date}::date AND (${counterId ?? null}::uuid IS NULL OR r.counter_id = ${counterId ?? null}::uuid)
      ORDER BY r.received_at`);
  }

  /** Pengumpul (penerima) yang menerima pembayaran di loket itu pada hari itu */
  dayCollectors(db: DbOrTx, tenantId: string, counterId: string, date: string) {
    return db.execute<{ collector_id: string; n: number; total: string }>(sql`
      SELECT r.collector_id, COUNT(*)::int AS n, COALESCE(SUM(r.amount), 0)::text AS total
      FROM utility_counter_receipts r JOIN payments p ON p.id = r.payment_id
      WHERE r.tenant_id = ${tenantId} AND r.counter_id = ${counterId} AND p.date = ${date}::date GROUP BY r.collector_id`);
  }

  closings(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db
      .select()
      .from(utilityCounterClosings)
      .where(and(eq(utilityCounterClosings.tenantId, tenantId), sql`${utilityCounterClosings.date} BETWEEN ${from} AND ${to}`));
  }
  insertClosing(db: DbOrTx, row: typeof utilityCounterClosings.$inferInsert) {
    return db.insert(utilityCounterClosings).values(row).returning();
  }
}
