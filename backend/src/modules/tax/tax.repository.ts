import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { accounts, taxPayments } from '../../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { SYS } from '../accounting/default-coa';
import { type TaxPaymentType } from '@sansu/shared';

/** Akses data untuk Tax: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TaxRepository {
  /** Dipakai oleh TaxService.keyAccounts */
  listAccountsBySystemKey(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: accounts.id, key: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.systemKey, Object.values(SYS))));
  }

  /** Dipakai oleh TaxService.paidThrough */
  queryTaxPayment(
    db: DbOrTx,
    tenantId: string,
    type: 'PPH23' | 'PPH4_2' | 'PPN' | 'PPH21' | 'PPH25' | 'PPH29' | 'PPH_FINAL' | 'BPJS' | 'PB1',
    period: string,
  ) {
    return db.execute<{ amount: string; vat_out: string; vat_in: string }>(sql`
        SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(vat_out), 0) AS vat_out, COALESCE(SUM(vat_in), 0) AS vat_in
        FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period <= ${period}`);
  }

  /** Dipakai oleh TaxService.paidIn */
  queryTaxPaymentForPaidIn(
    db: DbOrTx,
    tenantId: string,
    type: 'PPH23' | 'PPH4_2' | 'PPN' | 'PPH21' | 'PPH25' | 'PPH29' | 'PPH_FINAL' | 'BPJS' | 'PB1',
    period: string,
  ) {
    return db.execute<{ amount: string }>(sql`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period = ${period}`);
  }

  /** Dipakai oleh TaxService.create */
  queryCreate(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tax:${tenantId}`}))`);
  }

  /** Dipakai oleh TaxService.annualRecap */
  queryTaxPaymentForAnnualRecap(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{
      type: TaxPaymentType;
      period: string;
      amount: string;
      last_date: string;
      first_date: string;
      ntpn: string | null;
      n: number;
    }>(sql`
        SELECT type, period, SUM(amount)::text AS amount, MAX(date)::text AS last_date, MIN(date)::text AS first_date,
               STRING_AGG(NULLIF(ntpn, ''), ', ' ORDER BY date) AS ntpn, COUNT(*)::int AS n
        FROM tax_payments WHERE tenant_id = ${tenantId} AND period LIKE ${`${year}-%`} GROUP BY type, period`);
  }

  /** Dipakai oleh TaxService.withholdingRecap */
  queryPurchaseInvoice(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<Record<string, string | null>>(sql`
        SELECT pi.id, pi.number, pi.supplier_invoice_no AS "supplierInvoiceNo", pi.date::text AS date, pi.description,
               pi.withholding_type AS type, pi.withholding_base AS base, pi.withholding_rate AS rate, pi.withholding_amount AS amount,
               s.id AS "supplierId", s.code AS "supplierCode", s.name AS "supplierName", s.npwp AS "supplierNpwp", s.address AS "supplierAddress"
        FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
        WHERE pi.tenant_id = ${tenantId} AND pi.withholding_amount > 0 AND pi.date BETWEEN ${from} AND ${to}
        ORDER BY pi.withholding_type, pi.date, pi.number`);
  }

  /** Dipakai oleh TaxService.remove */
  findTaxPaymentsByTypeAndPeriod(db: DbOrTx, tenantId: string, type: string, period: string) {
    return db
      .select({ n: taxPayments.number })
      .from(taxPayments)
      .where(
        and(eq(taxPayments.tenantId, tenantId), eq(taxPayments.type, type), sql`${taxPayments.period} > ${period}`),
      )
      .limit(1);
  }

  /** Dipakai oleh TaxService.remove */
  deleteTaxPaymentsById(db: DbOrTx, id: string) {
    return db.delete(taxPayments).where(eq(taxPayments.id, id));
  }
}
