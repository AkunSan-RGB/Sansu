import { NON_AIR_CHARGE_KEYS } from '@sansu/shared';
import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, isNull, desc } from 'drizzle-orm';
import { utilityIngestKeys, utilityBills, utilityCounterReceipts, utilityRemittances } from '../../db/schema';
import { createHash } from 'node:crypto';
import { todayJakarta } from '../../common/utils/dates';

export const hash = (k: string) => createHash('sha256').update(k).digest('hex');

export const addMonths = () => {
  const d = new Date(`${todayJakarta()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 3);
  return d.toISOString().slice(0, 10);
};

/** Akses data untuk UtilityField: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class UtilityFieldRepository {
  /** Dipakai oleh UtilityFieldService.idsByNumber */
  queryUtilityConnection(db: DbOrTx, tenantId: string, numbers: string[]) {
    return db.execute<{ id: string; number: string }>(
      sql`SELECT id, number FROM utility_connections WHERE tenant_id = ${tenantId} AND number IN (${sql.join(
        [...new Set(numbers)].map((n) => sql`${n}`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh UtilityFieldService.importRows */
  queryUtilityReading(db: DbOrTx, connectionId: string, period: string, current: string) {
    return db.execute(
      sql`SELECT 1 FROM utility_readings WHERE connection_id = ${connectionId} AND period = ${period} AND status <> 'REJECTED' AND source = 'API' AND current = ${current}::numeric LIMIT 1`,
    );
  }

  /** Dipakai oleh UtilityFieldService.revokeKey */
  updateUtilityIngestKeysByIdAndRevokedAtAndName(db: DbOrTx, id: string, tenantId: string) {
    return db
      .update(utilityIngestKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(utilityIngestKeys.id, id),
          eq(utilityIngestKeys.tenantId, tenantId),
          isNull(utilityIngestKeys.revokedAt),
        ),
      )
      .returning({ id: utilityIngestKeys.id, name: utilityIngestKeys.name });
  }

  /** Dipakai oleh UtilityFieldService.counterSearch */
  /** Tagihan air bulanan dan tagihan layanan non-air yang masih bisa dibayar di loket */
  queryUtilityBill(db: DbOrTx, tenantId: string, like: string) {
    return db.execute(sql`
      SELECT * FROM (
        SELECT i.id AS "invoiceId", i.number AS "invoiceNumber", c.number AS "connectionNumber", cu.name AS "customerName", c.address, b.period, 'AIR' AS kind,
               (i.total - i.paid_amount - i.returned_amount) AS outstanding, i.due_date AS "dueDate"
        FROM utility_bills b
        JOIN invoices i ON i.id = b.invoice_id
        JOIN utility_connections c ON c.id = b.connection_id
        JOIN customers cu ON cu.id = c.customer_id
        WHERE b.tenant_id = ${tenantId} AND i.status IN ('UNPAID','PARTIAL') AND i.total - i.paid_amount - i.returned_amount > 0
          AND (c.number ILIKE ${like} OR cu.name ILIKE ${like} OR i.number ILIKE ${like} OR c.meter_no ILIKE ${like})
        UNION ALL
        SELECT i.id, i.number, '-', cu.name, COALESCE(cu.address, '-'), COALESCE(i.description, 'Layanan non-air'), 'NON_AIR',
               (i.total - i.paid_amount - i.returned_amount), i.due_date
        FROM invoices i JOIN customers cu ON cu.id = i.customer_id
        WHERE ${this.chargeInvoice(tenantId)} AND i.status IN ('UNPAID','PARTIAL') AND i.total - i.paid_amount - i.returned_amount > 0
          AND (cu.name ILIKE ${like} OR i.number ILIKE ${like})
      ) x ORDER BY x."dueDate" LIMIT 50`);
  }

  recentReceipts(db: DbOrTx, tenantId: string, collectorId: string) {
    return db.execute(sql`
      SELECT r.id, to_char(r.received_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS at, c.name AS counter, COALESCE(r.channel, r.method) AS channel, r.amount::text AS amount,
             i.number AS invoice, cu.name AS customer
      FROM utility_counter_receipts r JOIN invoices i ON i.id = r.invoice_id JOIN customers cu ON cu.id = i.customer_id LEFT JOIN utility_counters c ON c.id = r.counter_id
      WHERE r.tenant_id = ${tenantId} AND r.collector_id = ${collectorId} ORDER BY r.received_at DESC LIMIT 15`);
  }

  /** Faktur layanan non-air: barisnya masuk akun pendapatan non-air dan bukan tagihan meter bulanan */
  private chargeInvoice(tenantId: string) {
    return sql`i.tenant_id = ${tenantId} AND NOT EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id)
      AND EXISTS (SELECT 1 FROM service_invoice_lines sl JOIN accounts sa ON sa.id = sl.account_id WHERE sl.invoice_id = i.id AND sa.system_key IN (${sql.join(NON_AIR_CHARGE_KEYS.map((k) => sql`${k}`), sql`, `)}))`;
  }

  async isChargeInvoice(db: DbOrTx, tenantId: string, invoiceId: string) {
    const r = await db.execute(sql`SELECT 1 FROM invoices i WHERE i.id = ${invoiceId} AND ${this.chargeInvoice(tenantId)}`);
    return r.rows.length > 0;
  }

  /** Dipakai oleh UtilityFieldService.counterPay */
  findUtilityBillsByInvoiceId(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db
      .select({ id: utilityBills.id })
      .from(utilityBills)
      .where(and(eq(utilityBills.invoiceId, invoiceId), eq(utilityBills.tenantId, tenantId)));
  }

  /** Dipakai oleh UtilityFieldService.openReceipts */
  listUtilityCounterReceiptsByCollectorIdAndMethodAndRemittanceId(db: DbOrTx, tenantId: string, sub: string) {
    return db
      .select()
      .from(utilityCounterReceipts)
      .where(
        and(
          eq(utilityCounterReceipts.tenantId, tenantId),
          eq(utilityCounterReceipts.collectorId, sub),
          eq(utilityCounterReceipts.method, 'CASH'),
          isNull(utilityCounterReceipts.remittanceId),
        ),
      )
      .orderBy(utilityCounterReceipts.receivedAt);
  }

  /** Dipakai oleh UtilityFieldService.remit */
  queryUtilityCounterReceipt(db: DbOrTx, tenantId: string, sub: string) {
    return db.execute(
      sql`SELECT id FROM utility_counter_receipts WHERE tenant_id = ${tenantId} AND collector_id = ${sub} AND method = 'CASH' AND remittance_id IS NULL FOR UPDATE`,
    );
  }

  /** Dipakai oleh UtilityFieldService.remit */
  listUtilityCounterReceiptsByCollectorIdAndMethodAndRemittanceIdForRemit(db: DbOrTx, tenantId: string, sub: string) {
    return db
      .select()
      .from(utilityCounterReceipts)
      .where(
        and(
          eq(utilityCounterReceipts.tenantId, tenantId),
          eq(utilityCounterReceipts.collectorId, sub),
          eq(utilityCounterReceipts.method, 'CASH'),
          isNull(utilityCounterReceipts.remittanceId),
        ),
      );
  }

  /** Dipakai oleh UtilityFieldService.remit */
  updateUtilityCounterReceiptsById(db: DbOrTx, id: string, rows: (typeof utilityCounterReceipts.$inferSelect)[]) {
    return db
      .update(utilityCounterReceipts)
      .set({ remittanceId: id })
      .where(
        sql`${utilityCounterReceipts.id} IN (${sql.join(
          rows.map((r) => sql`${r.id}::uuid`),
          sql`, `,
        )})`,
      );
  }

  /** Dipakai oleh UtilityFieldService.remit */
  findUtilityRemittancesByCollectorIdAndCreatedAt(db: DbOrTx, tenantId: string, sub: string) {
    return db
      .select()
      .from(utilityRemittances)
      .where(and(eq(utilityRemittances.tenantId, tenantId), eq(utilityRemittances.collectorId, sub)))
      .orderBy(desc(utilityRemittances.createdAt))
      .limit(1);
  }

  /** Dipakai oleh UtilityFieldService.decide */
  queryUtilityRemittance(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT * FROM utility_remittances WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh UtilityFieldService.counterControls */
  queryPayment(db: DbOrTx, tenantId: string) {
    return db.execute(sql`
      SELECT p.number, p.date, p.amount, i.number AS "invoiceNumber"
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN utility_bills b ON b.invoice_id = i.id
      WHERE p.tenant_id = ${tenantId} AND p.notes LIKE 'Loket%'
        AND NOT EXISTS (SELECT 1 FROM utility_counter_receipts r WHERE r.payment_id = p.id)
      ORDER BY p.date DESC LIMIT 100`);
  }

  /** Dipakai oleh UtilityFieldService.counterControls */
  queryUtilityCounterReceiptForCounterControls(db: DbOrTx, tenantId: string) {
    return db.execute(sql`
      SELECT collector_id AS "collectorId", count(*)::int AS count, sum(amount) AS amount, min(received_at) AS since
      FROM utility_counter_receipts WHERE tenant_id = ${tenantId} AND method = 'CASH' AND remittance_id IS NULL AND received_at < now() - interval '1 day'
      GROUP BY collector_id`);
  }

  /** Dipakai oleh UtilityFieldService.counterControls */
  queryUtilityRemittanceForCounterControls(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT number, date, difference FROM utility_remittances WHERE tenant_id = ${tenantId} AND status = 'SUBMITTED' AND created_at < now() - interval '2 days' ORDER BY date`,
    );
  }

  /** Dipakai oleh UtilityFieldService.fieldRoute */
  queryUtilityConnectionForFieldRoute(db: DbOrTx, tenantId: string, period: string, routeId?: string) {
    return db.execute(sql`
      SELECT c.id, c.number, c.meter_no AS "meterNo", c.address, cu.name AS "customerName", cu.geo_lat AS lat, cu.geo_lng AS lng, t.unit,
             COALESCE((SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1), c.initial_reading) AS previous
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')
        AND (${routeId ?? null}::uuid IS NULL OR c.route_id = ${routeId ?? null}::uuid)
      ORDER BY c.route_seq NULLS LAST, c.address LIMIT 1000`);
  }

  /** Dipakai oleh UtilityFieldService.photo */
  queryUtilityReadingForPhoto(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ photo: string | null }>(
      sql`SELECT photo FROM utility_readings WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh UtilityFieldService.createKey */
  insertUtilityIngestKeys(db: DbOrTx, tenantId: string, name: string, key: string, sub: string) {
    return db
      .insert(utilityIngestKeys)
      .values({
        tenantId: tenantId,
        name: name.trim(),
        keyHash: hash(key),
        keyPrefix: key.slice(0, 8),
        createdById: sub,
      })
      .returning({ id: utilityIngestKeys.id, name: utilityIngestKeys.name, keyPrefix: utilityIngestKeys.keyPrefix });
  }

  /** Dipakai oleh UtilityFieldService.counterControls */
  queryUtilityRemittanceForCounterControls2(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT number, date, difference, status FROM utility_remittances WHERE tenant_id = ${tenantId} AND difference <> 0 AND date >= ${addMonths()} ORDER BY date DESC LIMIT 50`,
    );
  }

  /** Dipakai oleh UtilityIngestGuard.canActivate */
  findUtilityIngestKeysByKeyHash(db: DbOrTx, raw: string) {
    return db
      .select()
      .from(utilityIngestKeys)
      .where(eq(utilityIngestKeys.keyHash, hash(raw)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh UtilityFieldService.keys */
  listUtilityIngestKeysByCreatedAt(
    db: DbOrTx,
    tenantId: NonNullable<(typeof utilityIngestKeys.$inferSelect)['tenantId']>,
  ) {
    return db
      .select({
        id: utilityIngestKeys.id,
        name: utilityIngestKeys.name,
        keyPrefix: utilityIngestKeys.keyPrefix,
        createdAt: utilityIngestKeys.createdAt,
        lastUsedAt: utilityIngestKeys.lastUsedAt,
        revokedAt: utilityIngestKeys.revokedAt,
      })
      .from(utilityIngestKeys)
      .where(eq(utilityIngestKeys.tenantId, tenantId))
      .orderBy(desc(utilityIngestKeys.createdAt));
  }

  /** Dipakai oleh UtilityFieldService.remittances */
  listUtilityRemittancesByCreatedAt(
    db: DbOrTx,
    tenantId: NonNullable<(typeof utilityRemittances.$inferSelect)['tenantId']>,
  ) {
    return db
      .select()
      .from(utilityRemittances)
      .where(eq(utilityRemittances.tenantId, tenantId))
      .orderBy(desc(utilityRemittances.createdAt))
      .limit(200);
  }
}
