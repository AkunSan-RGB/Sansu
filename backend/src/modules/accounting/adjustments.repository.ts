import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { ADJUSTING_SOURCES } from './ledger-data';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk Adjustments: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AdjustmentsRepository {
  /** Dipakai oleh AdjustmentsService.summary */
  queryJournalEntry(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ source_type: string; n: number; total: string }>(sql`
      SELECT j.source_type, COUNT(DISTINCT j.id)::int AS n, COALESCE(SUM(l.debit), 0) AS total
      FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${from} AND ${to}
        AND j.source_type IN (${sql.join(
          ADJUSTING_SOURCES.map((s) => sql`${s}`),
          sql`, `,
        )})
      GROUP BY j.source_type`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AdjustmentsService.checklist */
  queryChecklist(db: DbOrTx, tenantId: string, to: string, period: string) {
    return db.execute<{ active: number; posted: number; amount: string }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM fixed_assets WHERE tenant_id = ${tenantId} AND status = 'ACTIVE' AND method <> 'NONE'
           AND depreciation_start <= ${to}) AS active,
        (SELECT COUNT(*)::int FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${period}) AS posted,
        (SELECT COALESCE(SUM(amount), 0) FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${period}) AS amount`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryRecurringJournal(db: DbOrTx, to: string, tenantId: string) {
    return db.execute<{ due: number; active: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE next_date <= ${to})::int AS due, COUNT(*)::int AS active
      FROM recurring_journals WHERE tenant_id = ${tenantId} AND is_active = true AND is_adjustment = true`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryJournalLine(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${to} AND a.report_group = 'PREPAID'`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryInvoice(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM invoices
      WHERE tenant_id = ${tenantId} AND status <> 'PAID' AND date <= ${to} AND due_date < ${addDays(to, -90)}`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryJournalLineForChecklist(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.credit - l.debit), 0) AS v FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${to} AND a.report_group = 'ALLOWANCE_RECEIVABLE'`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryPayrollRun(db: DbOrTx, tenantId: string, period: string) {
    return db.execute<{ n: number; posted: number }>(sql`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status <> 'DRAFT')::int AS posted
      FROM payroll_runs WHERE tenant_id = ${tenantId} AND period = ${period}`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryEmployee(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM employees WHERE tenant_id = ${tenantId} AND is_active = true`,
    );
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryJournalEntryForChecklist(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'STOCK_ADJUSTMENT'
        AND date BETWEEN ${from} AND ${to} AND description ILIKE '%STOCK_OPNAME%'`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryJournalEntryForChecklist2(db: DbOrTx, tenantId: string, year: string) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'INCOME_TAX' AND source_id = ${year}
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = journal_entries.id)`);
  }

  /** Dipakai oleh AdjustmentsService.checklist */
  queryJournalEntryForChecklist3(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ n: number; total: string }>(sql`
      SELECT COUNT(DISTINCT j.id)::int AS n, COALESCE(SUM(l.debit), 0) AS total FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'ADJUSTMENT' AND j.date BETWEEN ${from} AND ${to}`);
  }
}
