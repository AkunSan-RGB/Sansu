import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { AccountType } from '../../db/schema';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk FinancialReports: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class FinancialReportsRepository {
  /** Dipakai oleh FinancialReportsService.ledger */
  queryJournalLine(db: DbOrTx, accountId: string, fromDate: string, brCond: SQL<unknown>) {
    return db.execute<{ debit: string; credit: string }>(sql`
            SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
            FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
            WHERE l.account_id = ${accountId} AND j.date < ${fromDate} ${brCond}`);
  }

  /** Dipakai oleh FinancialReportsService.ledger */
  queryJournalLineForLedger(
    db: DbOrTx,
    accountId: string,
    brCond: SQL<unknown>,
    fromDate: string | undefined,
    toDate: string | undefined,
    rowLimit: number,
  ) {
    return db.execute<{
      journal_id: string;
      number: string;
      date: string;
      description: string;
      source_type: string;
      source_id: string | null;
      debit: string;
      credit: string;
      memo: string | null;
    }>(sql`
      SELECT j.id AS journal_id, j.number, j.date, j.description, j.source_type, j.source_id, l.debit, l.credit, l.memo
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE l.account_id = ${accountId} ${brCond}
        ${fromDate ? sql`AND j.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND j.date <= ${toDate}` : sql``}
      ORDER BY j.date, j.number, l.id
      LIMIT ${Math.min(Math.max(1, Math.floor(rowLimit)), 20000)}`);
  }

  /** Dipakai oleh FinancialReportsService.ledger */
  queryJournalLineForLedger2(
    db: DbOrTx,
    accountId: string,
    brCond: SQL<unknown>,
    fromDate: string | undefined,
    toDate: string | undefined,
  ) {
    return db.execute<{ debit: string; credit: string; n: number }>(sql`
        SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit, COUNT(*)::int AS n
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE l.account_id = ${accountId} ${brCond}
          ${fromDate ? sql`AND j.date >= ${fromDate}` : sql``}
          ${toDate ? sql`AND j.date <= ${toDate}` : sql``}`);
  }

  /** Dipakai oleh FinancialReportsService.cashFlow */
  queryJournalLineForCashFlow(db: DbOrTx, tenantId: string, fromDate: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account = true AND j.date < ${fromDate}`);
  }

  /** Dipakai oleh FinancialReportsService.cashFlow */
  queryJournalEntry(db: DbOrTx, tenantId: string, fromDate: string, toDate: string) {
    return db.execute<{
      journal_id: string;
      debit: string;
      credit: string;
      account_id: string;
      code: string;
      name: string;
      type: AccountType;
      is_cash: boolean;
      system_key: string | null;
    }>(sql`
      SELECT j.id AS journal_id, l.debit, l.credit, a.id AS account_id, a.code, a.name, a.type,
             a.is_cash_account AS is_cash, a.system_key
      FROM journal_entries j
      JOIN journal_lines l ON l.journal_id = j.id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND j.source_type <> 'CLOSING'
        AND EXISTS (SELECT 1 FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                    WHERE l2.journal_id = j.id AND a2.is_cash_account = true)`);
  }

  /** Dipakai oleh FinancialReportsService.vatReport */
  queryJournalLineForVatReport(db: DbOrTx, tenantId: string, fromDate: string, toDate: string) {
    return db.execute<{ key: string; debit: string; credit: string }>(sql`
      SELECT a.system_key AS key, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND a.system_key IN ('VAT_OUT', 'VAT_IN')
      GROUP BY a.system_key`);
  }

  /** Dipakai oleh FinancialReportsService.vatReport */
  queryInvoice(db: DbOrTx, tenantId: string, fromDate: string, toDate: string) {
    return db.execute<{
      kind: string;
      number: string;
      ref: string | null;
      date: string;
      party: string;
      npwp: string | null;
      dpp: string;
      ppn: string;
    }>(sql`
      SELECT 'Faktur jual' AS kind, i.number, NULL AS ref, i.date, c.name AS party, c.npwp, i.subtotal AS dpp, i.tax_amount AS ppn
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${fromDate} AND ${toDate} AND NOT i.is_opening
      UNION ALL
      SELECT 'Retur jual', r.number, i.number, r.date, c.name, c.npwp, -r.subtotal, -r.tax_amount
        FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      UNION ALL
      SELECT 'Faktur beli', p.number, p.supplier_invoice_no, p.date, s.name, s.npwp, p.subtotal, p.tax_amount
        FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = ${tenantId} AND p.date BETWEEN ${fromDate} AND ${toDate} AND p.kind <> 'OPENING'
      UNION ALL
      SELECT 'Retur beli', r.number, p.number, r.date, s.name, s.npwp, -r.subtotal, -r.tax_amount
        FROM purchase_returns r JOIN purchase_invoices p ON p.id = r.purchase_invoice_id JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      ORDER BY date, number`);
  }
}
