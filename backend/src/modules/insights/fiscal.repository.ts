import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { projectCostsSql } from '../../common/project-costs';
import { SYS } from '../accounting/default-coa';
import { fiscalYears, fiscalAdjustments } from '../../db/schema';
import { money } from '../../common/utils/money';

/** Akses data untuk Fiscal: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class FiscalRepository {
  /** Dipakai oleh FiscalService.reconcile */
  queryProj(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ final: string; other: string }>(sql`
          WITH proj AS (
            SELECT p.id, EXISTS (
              SELECT 1 FROM invoices i JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts ra ON ra.id = sl.account_id
              WHERE i.project_id = p.id AND ra.fiscal_treatment = 'FINAL_INCOME') AS is_final
            FROM projects p WHERE p.tenant_id = ${tenantId}
          )
          SELECT COALESCE(SUM(x.amount) FILTER (WHERE proj.is_final), 0) AS final,
                 COALESCE(SUM(x.amount) FILTER (WHERE NOT proj.is_final), 0) AS other
          FROM ${projectCostsSql(tenantId, from, to)} x
          JOIN proj ON proj.id = x.project_id
          JOIN accounts a ON a.id = x.account_id
          WHERE a.type = 'EXPENSE' AND a.fiscal_treatment = 'NORMAL'
            AND a.report_group IN ('COST_OF_SALES', 'SELLING_EXPENSE', 'ADMIN_EXPENSE', 'OTHER_EXPENSE', 'FINANCE_COST')
            AND COALESCE(a.system_key, '') NOT IN ('COGS', 'INVENTORY_ADJ', 'INVENTORY_WRITEDOWN')`);
  }

  /** Dipakai oleh FiscalService.reconcile */
  queryStockMove(db: DbOrTx, from: string, tenantId: string, to: string) {
    return db.execute<{ realized: string; reserve: string }>(sql`
        SELECT COALESCE(-SUM(writedown_value) FILTER (WHERE type <> 'REVALUATION' AND date >= ${from}), 0) AS realized,
               COALESCE(SUM(writedown_value), 0) AS reserve
        FROM stock_moves WHERE tenant_id = ${tenantId} AND date <= ${to}`);
  }

  /** Dipakai oleh FiscalService.reconcile */
  queryJournalLine(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND a.system_key = ${SYS.PREPAID_TAX} AND j.date BETWEEN ${from} AND ${to}
          AND j.source_type NOT IN ('TAX_PAYMENT', 'INCOME_TAX', 'CLOSING')`);
  }

  /** Dipakai oleh FiscalService.postedJournal */
  queryJournalEntry(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{ id: string; number: string; date: string }>(sql`
      SELECT j.id, j.number, j.date FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'INCOME_TAX' AND j.source_id = ${String(year)}
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      ORDER BY j.created_at DESC LIMIT 1`);
  }

  /** Dipakai oleh FiscalService.saveYear */
  insertFiscalYears(
    db: DbOrTx,
    tenantId: string,
    year: number,
    dto: { lossCarryforward?: string; grossRevenueOverride?: string | null; finalCostOverride?: string | null },
  ) {
    return db
      .insert(fiscalYears)
      .values({
        tenantId: tenantId,
        year: year,
        lossCarryforward: dto.lossCarryforward ?? '0',
        grossRevenueOverride: dto.grossRevenueOverride ?? null,
        finalCostOverride: dto.finalCostOverride ?? null,
      })
      .onConflictDoUpdate({
        target: [fiscalYears.tenantId, fiscalYears.year],
        set: {
          ...(dto.lossCarryforward !== undefined ? { lossCarryforward: dto.lossCarryforward } : {}),
          ...(dto.grossRevenueOverride !== undefined ? { grossRevenueOverride: dto.grossRevenueOverride } : {}),
          ...(dto.finalCostOverride !== undefined ? { finalCostOverride: dto.finalCostOverride } : {}),
        },
      });
  }

  /** Dipakai oleh FiscalService.addAdjustment */
  insertFiscalAdjustments(
    db: DbOrTx,
    tenantId: string,
    year: number,
    dto: { description: string; kind: 'POSITIVE' | 'NEGATIVE'; amount: string },
    amount: string,
  ) {
    return db
      .insert(fiscalAdjustments)
      .values({ tenantId: tenantId, year: year, ...dto, amount: money(amount).toFixed(2) });
  }

  /** Dipakai oleh FiscalService.removeAdjustment */
  deleteFiscalAdjustmentsById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .delete(fiscalAdjustments)
      .where(and(eq(fiscalAdjustments.id, id), eq(fiscalAdjustments.tenantId, tenantId)));
  }

  /** Dipakai oleh FiscalService.postTax */
  insertFiscalYearsForPostTax(db: DbOrTx, tenantId: string, year: number, id: string) {
    return db
      .insert(fiscalYears)
      .values({ tenantId: tenantId, year: year, taxJournalId: id })
      .onConflictDoUpdate({ target: [fiscalYears.tenantId, fiscalYears.year], set: { taxJournalId: id } });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh FiscalService.reconcile */
  listFiscalAdjustmentsByYear(
    db: DbOrTx,
    tenantId: NonNullable<(typeof fiscalAdjustments.$inferSelect)['tenantId']>,
    year: NonNullable<(typeof fiscalAdjustments.$inferSelect)['year']>,
  ) {
    return db
      .select()
      .from(fiscalAdjustments)
      .where(and(eq(fiscalAdjustments.tenantId, tenantId), eq(fiscalAdjustments.year, year)));
  }

  /** Dipakai oleh FiscalService.reconcile */
  listFiscalYearsByYear(
    db: DbOrTx,
    tenantId: NonNullable<(typeof fiscalYears.$inferSelect)['tenantId']>,
    year: NonNullable<(typeof fiscalYears.$inferSelect)['year']>,
  ) {
    return db
      .select()
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.year, year)));
  }
}
