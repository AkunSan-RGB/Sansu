import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { projectCostsSql } from '../../common/project-costs';

/** Angka mentah satu profil (kolom bernama, nilai teks/angka dari PostgreSQL) */
export type MetricRow = Record<string, string | number | null>;

/**
 * Angka khas profil layanan Jasa untuk ubin dashboard dan saran: satu kueri per profil.
 * `month` = awal bulan berjalan (YYYY-MM-01), `prevMonth` = awal bulan lalu, `today` = hari ini (YYYY-MM-DD).
 */
@Injectable()
export class ProfileMetricsRepository {
  private async one(db: DbOrTx, q: ReturnType<typeof sql>): Promise<MetricRow> {
    return ((await db.execute<MetricRow>(q)).rows[0] ?? {}) as MetricRow;
  }

  kontraktor(db: DbOrTx, tenantId: string, today: string) {
    return this.one(db, sql`
      WITH act AS (SELECT id, contract_value, cost_budget FROM projects WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'),
           cost AS (SELECT c.project_id, SUM(c.amount) AS amount FROM ${projectCostsSql(tenantId)} c GROUP BY c.project_id),
           ret AS (SELECT i.total - i.paid_amount - i.returned_amount AS open, i.due_date FROM invoices i
                   WHERE i.tenant_id = ${tenantId} AND i.retention_of_invoice_id IS NOT NULL AND i.status <> 'PAID')
      SELECT
        (SELECT COUNT(*) FROM act)::int AS projects_active,
        (SELECT COALESCE(SUM(contract_value), 0) FROM act)::text AS contract_active,
        (SELECT COALESCE(SUM(i.subtotal), 0) FROM invoices i JOIN act ON act.id = i.project_id WHERE i.tenant_id = ${tenantId})::text AS billed_active,
        (SELECT COALESCE(SUM(open), 0) FROM ret)::text AS retention_held,
        (SELECT COALESCE(SUM(open), 0) FROM ret WHERE due_date < ${today}::date)::text AS retention_due,
        (SELECT COALESCE(SUM(cost_budget), 0) FROM act WHERE cost_budget > 0)::text AS budget,
        (SELECT COALESCE(SUM(cost.amount), 0) FROM act JOIN cost ON cost.project_id = act.id WHERE act.cost_budget > 0)::text AS budget_cost,
        (SELECT COUNT(*) FROM act LEFT JOIN cost ON cost.project_id = act.id WHERE act.cost_budget > 0 AND COALESCE(cost.amount, 0) > act.cost_budget)::int AS over_budget`);
  }

  konsultan(db: DbOrTx, tenantId: string, month: string, today: string) {
    return this.one(db, sql`
      SELECT
        (SELECT COALESCE(SUM(hours * COALESCE(rate, 0)), 0) FROM time_entries WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND billable)::text AS unbilled_value,
        (SELECT COALESCE(SUM(hours), 0) FROM time_entries WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND billable)::text AS unbilled_hours,
        (SELECT MIN(work_date)::text FROM time_entries WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND billable) AS unbilled_oldest,
        (SELECT COALESCE(SUM(hours), 0) FROM time_entries WHERE tenant_id = ${tenantId} AND billable AND status IN ('APPROVED', 'BILLED') AND work_date BETWEEN ${month}::date AND ${today}::date)::text AS hours_month,
        (SELECT COALESCE(SUM(hours), 0) FROM time_entries WHERE tenant_id = ${tenantId} AND status NOT IN ('REJECTED', 'WRITTEN_OFF') AND work_date BETWEEN ${month}::date AND ${today}::date)::text AS logged_month,
        (SELECT COALESCE(SUM(monthly_fee), 0) FROM service_retainers WHERE tenant_id = ${tenantId} AND is_active AND (end_date IS NULL OR end_date >= ${today}::date))::text AS retainer_mrr,
        (SELECT COUNT(*) FROM service_retainers r WHERE r.tenant_id = ${tenantId} AND r.is_active AND r.start_date <= ${today}::date
           AND COALESCE((SELECT MAX(x.period) FROM service_retainer_invoices x WHERE x.retainer_id = r.id), '') < to_char(${month}::date - 1, 'YYYY-MM'))::int AS retainers_behind,
        (SELECT COUNT(*) FROM projects WHERE tenant_id = ${tenantId} AND status = 'ACTIVE')::int AS projects_active`);
  }

  pendidikan(db: DbOrTx, tenantId: string, month: string, today: string) {
    const period = month.slice(0, 7);
    return this.one(db, sql`
      WITH act AS (SELECT e.id, e.class_id, e.customer_id FROM edu_enrollments e JOIN edu_classes c ON c.id = e.class_id
                   WHERE e.tenant_id = ${tenantId} AND c.is_active AND (e.left_on IS NULL OR e.left_on > ${today}::date) AND e.enrolled_on <= ${today}::date),
           spp AS (SELECT DISTINCT i.id, i.customer_id, i.total, i.paid_amount, i.returned_amount, i.due_date, i.status, i.date, f.period
                   FROM edu_fee_invoices f JOIN invoices i ON i.id = f.invoice_id WHERE f.tenant_id = ${tenantId})
      SELECT
        (SELECT COUNT(*) FROM act)::int AS students_active,
        (SELECT COALESCE(SUM(amount), 0) FROM edu_fee_invoices WHERE tenant_id = ${tenantId} AND period = ${period})::text AS fee_month,
        (SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) FROM spp WHERE status <> 'PAID' AND due_date < ${today}::date)::text AS arrears,
        (SELECT COUNT(DISTINCT customer_id) FROM spp WHERE status <> 'PAID' AND due_date < ${today}::date)::int AS arrears_families,
        (SELECT COALESCE(SUM(total), 0) FROM spp WHERE date >= (${month}::date - interval '3 months') AND date < ${month}::date)::text AS billed3,
        (SELECT COALESCE(SUM(paid_amount), 0) FROM spp WHERE date >= (${month}::date - interval '3 months') AND date < ${month}::date)::text AS paid3,
        (SELECT COALESCE(SUM(c.capacity), 0) FROM edu_classes c WHERE c.tenant_id = ${tenantId} AND c.is_active AND c.capacity > 0)::int AS capacity,
        (SELECT COUNT(*) FROM act JOIN edu_classes c ON c.id = act.class_id WHERE c.capacity > 0)::int AS seated,
        (SELECT COUNT(*) FROM act WHERE NOT EXISTS (SELECT 1 FROM edu_fee_invoices f WHERE f.enrollment_id = act.id AND f.period = ${period}))::int AS unbilled_now`);
  }

  alihDaya(db: DbOrTx, tenantId: string, month: string, prevMonth: string, today: string) {
    const period = month.slice(0, 7);
    const prev = prevMonth.slice(0, 7);
    return this.one(db, sql`
      WITH ac AS (SELECT id, start_date, end_date FROM site_contracts WHERE tenant_id = ${tenantId} AND is_active),
           days AS (SELECT d::date AS d FROM generate_series(${month}::date, ${today}::date, interval '1 day') d),
           need AS (SELECT COALESCE(SUM(p.headcount), 0) AS n FROM site_posts p JOIN ac ON ac.id = p.contract_id JOIN days ON days.d >= ac.start_date AND (ac.end_date IS NULL OR days.d <= ac.end_date)),
           sci AS (SELECT s.contract_id, s.period, s.shortfall_head_days, i.subtotal, i.total, i.paid_amount, i.returned_amount, i.due_date, i.status, i.date
                   FROM site_contract_invoices s JOIN invoices i ON i.id = s.invoice_id WHERE s.tenant_id = ${tenantId})
      SELECT
        (SELECT COUNT(*) FROM ac)::int AS sites_active,
        (SELECT n FROM need)::int AS need_head_days,
        (SELECT COUNT(*) FROM site_duty x JOIN site_posts p ON p.id = x.post_id JOIN ac ON ac.id = p.contract_id WHERE x.tenant_id = ${tenantId} AND x.duty_date BETWEEN ${month}::date AND ${today}::date)::int AS duty_head_days,
        (SELECT COALESCE(SUM(subtotal), 0) FROM sci WHERE date BETWEEN ${month}::date AND ${today}::date)::text AS billing_month,
        (SELECT COALESCE(SUM(shortfall_head_days), 0) FROM sci WHERE period = ${prev})::text AS shortfall_prev,
        (SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) FROM sci WHERE status <> 'PAID' AND due_date < ${today}::date)::text AS ar_overdue,
        (SELECT COUNT(*) FROM ac WHERE ac.start_date <= ${month}::date - 1 AND NOT EXISTS (SELECT 1 FROM sci WHERE sci.contract_id = ac.id AND sci.period = ${prev}))::int AS unbilled_prev,
        (SELECT COUNT(*) FROM site_posts p JOIN ac ON ac.id = p.contract_id
          WHERE ac.start_date <= ${today}::date AND (ac.end_date IS NULL OR ac.end_date >= ${today}::date)
            AND (SELECT COUNT(*) FROM site_duty x WHERE x.post_id = p.id AND x.duty_date = ${today}::date) < p.headcount)::int AS posts_short_today,
        ${period}::text AS period`);
  }

  bengkel(db: DbOrTx, tenantId: string, month: string, today: string) {
    return this.one(db, sql`
      WITH ln AS (SELECT l.line_total, l.staff_id, p.is_service FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
                  WHERE o.tenant_id = ${tenantId} AND o.date BETWEEN ${month}::date AND ${today}::date)
      SELECT
        (SELECT COUNT(*) FROM pos_orders WHERE tenant_id = ${tenantId} AND date BETWEEN ${month}::date AND ${today}::date)::int AS orders_month,
        (SELECT COALESCE(SUM(line_total), 0) FROM ln WHERE is_service)::text AS service_month,
        (SELECT COALESCE(SUM(line_total), 0) FROM ln WHERE NOT is_service)::text AS parts_month,
        (SELECT e.name FROM ln JOIN employees e ON e.id = ln.staff_id WHERE ln.is_service GROUP BY e.id, e.name ORDER BY SUM(ln.line_total) DESC, e.name LIMIT 1) AS top_mechanic,
        (SELECT COALESCE(SUM(ln.line_total), 0) FROM ln WHERE ln.is_service AND ln.staff_id IS NULL)::text AS service_no_staff,
        (SELECT COUNT(*) FROM stock_minimums m JOIN products p ON p.id = m.product_id AND p.is_active
           LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
           WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty)::int AS low_parts`);
  }
}
