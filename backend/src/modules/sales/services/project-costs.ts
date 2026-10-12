/**
 * Biaya langsung proyek dari semua sumber: tagihan biaya, kas keluar, jurnal umum, dan gaji karyawan yang ditempatkan di proyek.
 * Dipakai di halaman proyek (laba per proyek) dan rekonsiliasi fiskal (biaya penghasilan PPh final).
 * Dokumen yang jurnalnya sudah dibalik (dibatalkan) tidak dihitung.
 */
import { sql, SQL } from 'drizzle-orm';

const notReversed = (col: SQL) => sql`NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversal_of_id = ${col})`;

/** Subquery: project_id, source, doc_id, number, date, description, account_id, amount */
export function projectCostsSql(tenantId: string, from?: string, to?: string): SQL {
  const range = (col: SQL) =>
    sql`${from ? sql`AND ${col} >= ${from}` : sql``} ${to ? sql`AND ${col} <= ${to}` : sql``}`;
  return sql`(
    SELECT b.project_id, 'BILL' AS source, b.id AS doc_id, b.number, b.date, COALESCE(l.description, b.description) AS description,
           l.account_id, l.line_total AS amount
    FROM purchase_invoice_lines l JOIN purchase_invoices b ON b.id = l.invoice_id
    WHERE b.tenant_id = ${tenantId} AND b.project_id IS NOT NULL AND l.account_id IS NOT NULL ${range(sql`b.date`)}
      AND ${notReversed(sql`b.journal_id`)}
    UNION ALL
    SELECT l.project_id, 'CASH', t.id, t.number, t.date, COALESCE(l.memo, t.description), l.account_id, l.amount
    FROM cash_transaction_lines l JOIN cash_transactions t ON t.id = l.transaction_id
    WHERE t.tenant_id = ${tenantId} AND t.type = 'OUT' AND l.project_id IS NOT NULL ${range(sql`t.date`)}
      AND ${notReversed(sql`t.journal_id`)}
    UNION ALL
    SELECT l.project_id, 'JOURNAL', j.id, j.number, j.date, COALESCE(l.memo, j.description), l.account_id, l.debit - l.credit
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts ja ON ja.id = l.account_id
    WHERE j.tenant_id = ${tenantId} AND ja.type = 'EXPENSE' AND j.source_type IN ('MANUAL', 'ADJUSTMENT', 'RECURRING') AND l.project_id IS NOT NULL ${range(sql`j.date`)}
      AND ${notReversed(sql`j.id`)}    UNION ALL
    SELECT ps.project_id, 'PAYROLL', r.id, r.number, r.pay_date, 'Gaji ' || e.name || ' (' || r.period || ')', a.id,
           CASE WHEN a.system_key = 'SALARY_EXPENSE' THEN ps.gross_pay
                ELSE ps.bpjs_kes_company + ps.jht_company + ps.jp_company + ps.jkk_company + ps.jkm_company END
    FROM payslips ps
    JOIN payroll_runs r ON r.id = ps.run_id
    JOIN employees e ON e.id = ps.employee_id
    JOIN accounts a ON a.tenant_id = r.tenant_id AND a.system_key IN ('SALARY_EXPENSE', 'BPJS_EXPENSE')
    WHERE r.tenant_id = ${tenantId} AND r.status IN ('POSTED', 'PAID') AND ps.project_id IS NOT NULL ${range(sql`r.pay_date`)}
      AND ${notReversed(sql`r.journal_id`)}
  )`;
}
