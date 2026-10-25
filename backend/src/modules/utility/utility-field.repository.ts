import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, isNull, desc } from 'drizzle-orm';
import { utilityIngestKeys, utilityBills, utilityCounterReceipts, utilityRemittances } from '../../db/schema';

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
  queryUtilityBill(db: DbOrTx, tenantId: string, like: string) {
    return db.execute(sql`
      SELECT i.id AS "invoiceId", i.number AS "invoiceNumber", c.number AS "connectionNumber", cu.name AS "customerName", c.address, b.period,
             (i.total - i.paid_amount - i.returned_amount) AS outstanding, i.due_date AS "dueDate"
      FROM utility_bills b
      JOIN invoices i ON i.id = b.invoice_id
      JOIN utility_connections c ON c.id = b.connection_id
      JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.status IN ('UNPAID','PARTIAL') AND i.total - i.paid_amount - i.returned_amount > 0
        AND (c.number ILIKE ${like} OR cu.name ILIKE ${like} OR i.number ILIKE ${like} OR c.meter_no ILIKE ${like})
      ORDER BY i.due_date LIMIT 50`);
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
  queryUtilityConnectionForFieldRoute(db: DbOrTx, tenantId: string, period: string) {
    return db.execute(sql`
      SELECT c.id, c.number, c.meter_no AS "meterNo", c.address, cu.name AS "customerName", cu.geo_lat AS lat, cu.geo_lng AS lng, t.unit,
             COALESCE((SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1), c.initial_reading) AS previous
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')
      ORDER BY c.address LIMIT 1000`);
  }

  /** Dipakai oleh UtilityFieldService.photo */
  queryUtilityReadingForPhoto(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ photo: string | null }>(
      sql`SELECT photo FROM utility_readings WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }
}
