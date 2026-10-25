import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, and } from 'drizzle-orm';
import { utilityTariffs, customers, accounts, utilityLateFees, utilityBills } from '../../db/schema';
import { TariffDto, ZoneSupplyDto } from './utility.dto';
import { type TariffBlock } from '@sansu/shared';
import { todayJakarta } from '../../common/utils/dates';
import { AuthUser } from '../../common/auth/auth-user';
import type { Decimal } from 'decimal.js';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Utility: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class UtilityRepository {
  /** Dipakai oleh UtilityService.tariffs */
  queryUtilityTariff(db: DbOrTx, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.service_type AS "serviceType", t.unit, t.metered, t.fixed_fee AS "fixedFee", t.admin_fee AS "adminFee", t.min_usage AS "minUsage", t.blocks, t.vatable, t.is_active AS "isActive",
             (SELECT COUNT(*)::int FROM utility_connections c WHERE c.tariff_id = t.id AND c.status <> 'DISCONNECTED') AS "connections"
      FROM utility_tariffs t WHERE t.tenant_id = ${tenantId} ORDER BY t.service_type, t.name`);
  }

  /** Dipakai oleh UtilityService.updateTariff */
  updateUtilityTariffsById(
    db: DbOrTx,
    dto: TariffDto,
    n: { blocks: TariffBlock[]; metered: boolean; unit: string },
    isActive: boolean,
    id: string,
  ) {
    return db
      .update(utilityTariffs)
      .set({
        name: dto.name.trim(),
        unit: n.unit,
        fixedFee: dto.fixedFee.toFixed(2),
        adminFee: dto.adminFee.toFixed(2),
        minUsage: String(dto.minUsage ?? 0),
        blocks: n.blocks,
        vatable: !!dto.vatable,
        isActive: dto.isActive ?? isActive,
      })
      .where(eq(utilityTariffs.id, id))
      .returning();
  }

  /** Dipakai oleh UtilityService.connections */
  queryUtilityConnection(db: DbOrTx, tenantId: string, q: { status?: string; search?: string }) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.status, c.meter_no AS "meterNo", c.address, c.zone, c.installed_at::text AS "installedAt", c.status_note AS "statusNote",
             c.customer_id AS "customerId", cu.name AS "customerName", c.tariff_id AS "tariffId", t.name AS "tariffName", t.service_type AS "serviceType", t.unit, t.metered,
             (SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1) AS "lastReading",
             (SELECT r.period FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1) AS "lastPeriod"
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
        ${q.search ? sql`AND (cu.name ILIKE ${'%' + q.search + '%'} OR c.number ILIKE ${'%' + q.search + '%'} OR c.meter_no ILIKE ${'%' + q.search + '%'} OR c.address ILIKE ${'%' + q.search + '%'})` : sql``}
      ORDER BY c.number DESC LIMIT 500`);
  }

  /** Dipakai oleh UtilityService.connection */
  queryUtilityReading(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.period, r.previous, r.current, r.usage, r.status, r.flags, r.meter_replaced AS "meterReplaced", r.note, eu.name AS "enteredByName", vu.name AS "verifiedByName", r.verify_note AS "verifyNote"
      FROM utility_readings r LEFT JOIN users eu ON eu.id = r.entered_by_id LEFT JOIN users vu ON vu.id = r.verified_by_id
      WHERE r.connection_id = ${id} AND r.tenant_id = ${tenantId} ORDER BY r.period DESC LIMIT 24`);
  }

  /** Dipakai oleh UtilityService.connection */
  queryUtilityBill(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT b.id, b.period, b.usage, b.subtotal, b.late_fee AS "lateFee", i.id AS "invoiceId", i.number AS "invoiceNumber", i.total, i.paid_amount AS "paidAmount", i.status, i.due_date::text AS "dueDate"
      FROM utility_bills b LEFT JOIN invoices i ON i.id = b.invoice_id WHERE b.connection_id = ${id} AND b.tenant_id = ${tenantId} ORDER BY b.period DESC LIMIT 24`);
  }

  /** Dipakai oleh UtilityService.createConnection */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id, isActive: customers.isActive })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }

  /** Dipakai oleh UtilityService.createConnection */
  queryUtilityConnectionForCreateConnection(
    db: DbOrTx,
    tenantId: string,
    serviceType: 'AIR' | 'LISTRIK' | 'INTERNET' | 'GAS' | 'TV_KABEL' | 'KEBERSIHAN',
    address: string,
    meterNo: string | null,
  ) {
    return db.execute(sql`
        SELECT c.number FROM utility_connections c JOIN utility_tariffs t2 ON t2.id = c.tariff_id
        WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED' AND t2.service_type = ${serviceType}
          AND (lower(btrim(c.address)) = lower(btrim(${address})) OR (${meterNo}::text IS NOT NULL AND c.meter_no = ${meterNo})) LIMIT 1`);
  }

  /** Dipakai oleh UtilityService.lockConnection */
  queryUtilityConnectionForLockConnection(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(
      sql`SELECT c.*, cu.name AS customer_name FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = ${id} AND c.tenant_id = ${tenantId} FOR UPDATE OF c`,
    );
  }

  /** Dipakai oleh UtilityService.overdueOf */
  queryUtilityBillForOverdueOf(db: DbOrTx, tenantId: string, connectionId: string) {
    return db.execute<{ outstanding: string; days_late: number }>(sql`
      SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS outstanding, COALESCE(MAX(${todayJakarta()}::date - i.due_date), 0)::int AS days_late
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.status <> 'PAID' AND i.due_date < ${todayJakarta()}::date`);
  }

  /** Dipakai oleh UtilityService.unpaidOf */
  queryUtilityBillForUnpaidOf(db: DbOrTx, tenantId: string, connectionId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.status <> 'PAID'`,
    );
  }

  /** Dipakai oleh UtilityService.saveSupply */
  queryUtilityConnectionForSaveSupply(db: DbOrTx, tenantId: string, zone: string) {
    return db.execute<{ units: string[] | null; n: number }>(
      sql`SELECT array_agg(DISTINCT t.unit) AS units, COUNT(*)::int AS n FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.zone = ${zone} AND t.metered`,
    );
  }

  /** Dipakai oleh UtilityService.saveSupply */
  queryUtilityZoneSupply(db: DbOrTx, tenantId: string, zone: string, period: string) {
    return db.execute<{ supplied: string }>(
      sql`SELECT supplied FROM utility_zone_supply WHERE tenant_id = ${tenantId} AND zone = ${zone} AND period = ${period}`,
    );
  }

  /** Dipakai oleh UtilityService.readings */
  queryUtilityReadingForReadings(
    db: DbOrTx,
    tenantId: string,
    q: { period?: string; status?: string; connectionId?: string },
  ) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.period, r.previous, r.current, r.usage, r.status, r.flags, r.meter_replaced AS "meterReplaced", r.note, r.verify_note AS "verifyNote",
             r.connection_id AS "connectionId", c.number AS "connectionNumber", c.meter_no AS "meterNo", cu.name AS "customerName", t.unit,
             eu.name AS "enteredByName", r.entered_by_id AS "enteredById", vu.name AS "verifiedByName", r.entered_at AS "enteredAt", r.source, (r.photo IS NOT NULL) AS "hasPhoto"
      FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      LEFT JOIN users eu ON eu.id = r.entered_by_id LEFT JOIN users vu ON vu.id = r.verified_by_id
      WHERE r.tenant_id = ${tenantId} ${q.period ? sql`AND r.period = ${q.period}` : sql``} ${q.status ? sql`AND r.status = ${q.status}` : sql``} ${q.connectionId ? sql`AND r.connection_id = ${q.connectionId}` : sql``}
      ORDER BY (r.status = 'ENTERED') DESC, r.entered_at DESC LIMIT 500`);
  }

  /** Dipakai oleh UtilityService.due */
  queryUtilityConnectionForDue(db: DbOrTx, tenantId: string, period: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.meter_no AS "meterNo", c.address, cu.name AS "customerName", t.unit,
             COALESCE((SELECT r.current FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY r.period DESC LIMIT 1), c.initial_reading) AS previous
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')
      ORDER BY c.address LIMIT 1000`);
  }

  /** Dipakai oleh UtilityService.enterReading */
  findUtilityTariffsById(db: DbOrTx, tariff_id: string) {
    return db.select().from(utilityTariffs).where(eq(utilityTariffs.id, tariff_id));
  }

  /** Dipakai oleh UtilityService.enterReading */
  queryUtilityReadingForEnterReading(db: DbOrTx, id: string) {
    return db.execute<{ period: string; current: string; status: string; id: string }>(
      sql`SELECT id, period, current, status FROM utility_readings WHERE connection_id = ${id} AND status <> 'REJECTED' ORDER BY period DESC LIMIT 1`,
    );
  }

  /** Dipakai oleh UtilityService.enterReading */
  queryUtilityReadingForEnterReading2(db: DbOrTx, id: string) {
    return db.execute<{ usage: string }>(
      sql`SELECT usage FROM utility_readings WHERE connection_id = ${id} AND status <> 'REJECTED' ORDER BY period DESC LIMIT 3`,
    );
  }

  /** Dipakai oleh UtilityService.enterReading */
  findCustomersByIdForEnterReading(db: DbOrTx, customer_id: string) {
    return db
      .select({ lat: customers.geoLat, lng: customers.geoLng })
      .from(customers)
      .where(eq(customers.id, customer_id));
  }

  /** Dipakai oleh UtilityService.lockReading */
  queryUtilityReadingForLockReading(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT * FROM utility_readings WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh UtilityService.lateFeesByConnection */
  queryUtilityBillForLateFeesByConnection(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{
      connection_id: string;
      invoice_id: string;
      number: string;
      total: string;
      paid_amount: string;
      due_date: string;
      bill_id: string;
    }>(sql`
      SELECT b.connection_id, i.id AS invoice_id, i.number, i.total, i.paid_amount, i.due_date::text, b.id AS bill_id
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.due_date < ${today}::date
        AND NOT EXISTS (SELECT 1 FROM utility_late_fees f WHERE f.invoice_id = i.id)`);
  }

  /** Dipakai oleh UtilityService.plan */
  queryUtilityConnectionForPlan(db: DbOrTx, period: string, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id AS connection_id, c.number, c.status, c.address, cu.id AS customer_id, cu.name AS customer_name, t.id AS tariff_id, t.name AS tariff_name, t.unit, t.metered, t.fixed_fee, t.admin_fee, t.min_usage, t.blocks, t.vatable,
             r.id AS reading_id, r.status AS reading_status, r.usage, b.id AS bill_id, b.invoice_id AS bill_invoice_id
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      LEFT JOIN utility_readings r ON r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED'
      LEFT JOIN utility_bills b ON b.connection_id = c.id AND b.period = ${period}
      WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED' AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
      ORDER BY c.number`);
  }

  /** Dipakai oleh UtilityService.key */
  findAccountsBySystemKey(db: DbOrTx, tenantId: string, systemKey: string) {
    return db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, systemKey)));
  }

  /** Dipakai oleh UtilityService.run */
  insertUtilityLateFees(db: DbOrTx, tenantId: string, invoiceId: string, claimId: string, amount: number) {
    return db
      .insert(utilityLateFees)
      .values({ tenantId: tenantId, invoiceId: invoiceId, billId: claimId, amount: amount.toFixed(2) })
      .onConflictDoNothing();
  }

  /** Dipakai oleh UtilityService.run */
  deleteUtilityBillsByIdAndInvoiceId(db: DbOrTx, claimId: string) {
    return db.delete(utilityBills).where(and(eq(utilityBills.id, claimId), sql`${utilityBills.invoiceId} IS NULL`));
  }

  /** Dipakai oleh UtilityService.overdue */
  queryUtilityBillForOverdue(db: DbOrTx, today: string, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.number, c.status, c.address, cu.name AS "customerName", cu.phone,
             SUM(i.total - i.paid_amount) AS outstanding, MAX(${today}::date - i.due_date)::int AS "daysLate", COUNT(*)::int AS bills
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE b.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.due_date < ${today}::date AND c.status <> 'DISCONNECTED'
      GROUP BY c.id, c.number, c.status, c.address, cu.name, cu.phone ORDER BY MAX(${today}::date - i.due_date) DESC LIMIT 500`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh UtilityService.saveSupply */
  queryUtilityZoneSupplyForSaveSupply(
    db: DbOrTx,
    tenantId: string,
    zone: string,
    dto: ZoneSupplyDto,
    supplied: Decimal,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO utility_zone_supply (tenant_id, zone, period, supplied, note, entered_by_id) VALUES (${tenantId}, ${zone}, ${dto.period}, ${supplied.toFixed(3)}, ${dto.note?.trim() || null}, ${sub}) ON CONFLICT (tenant_id, zone, period) DO UPDATE SET supplied = EXCLUDED.supplied, note = EXCLUDED.note, entered_by_id = EXCLUDED.entered_by_id, updated_at = now()`,
    );
  }

  /** Dipakai oleh UtilityService.run */
  insertUtilityBills(
    db: DbOrTx,
    u: AuthUser,
    itemValues: string,
    period: string,
    itemItemValues: number | null,
    itemValues2: string,
    itemValues3: string,
  ) {
    return db
      .insert(utilityBills)
      .values({
        tenantId: u.tenantId,
        connectionId: itemValues,
        period: period,
        usage: itemItemValues === null ? null : String(itemItemValues),
        subtotal: itemValues2,
        lateFee: itemValues3,
        createdById: u.sub,
      })
      .returning({ id: utilityBills.id });
  }

  /** Dipakai oleh UtilityService.controls */
  queryControls(db: DbOrTx, query: SQL<unknown>) {
    return db.execute<Record<string, unknown>>(query);
  }

  /** Dipakai oleh UtilityService.summary */
  querySummary(db: DbOrTx, query: SQL<unknown>) {
    return db.execute<{ n: number }>(query);
  }
}
