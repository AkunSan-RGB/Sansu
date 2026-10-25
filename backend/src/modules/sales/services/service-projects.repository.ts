import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { type Project } from '@sansu/shared';
import { sql, eq, desc, and, asc } from 'drizzle-orm';
import { projectCostsSql } from './project-costs';
import { projects, projectProgress, customers } from '../../../db/schema';
import { money } from '../../../common/utils/money';
import { toDocDate } from '../../../common/utils/dates';
import { CreateProjectDto } from './service-billing.dto';

/** Akses data untuk ServiceProjects: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ServiceProjectsRepository {
  /** Dipakai oleh ServiceProjectsService.listProjects */
  queryProject(db: DbOrTx, tenantId: string, id: string | undefined) {
    return db.execute<{
      id: string;
      code: string;
      name: string;
      customer_id: string;
      customer_code: string;
      customer_name: string;
      contract_value: string;
      start_date: string | null;
      end_date: string | null;
      status: Project['status'];
      notes: string | null;
      billed: string;
      outstanding: string;
      deposits: string;
      deposits_remaining: string;
      progress_pct: string | null;
      progress_date: string | null;
      accrual: string;
      direct_cost: string;
    }>(sql`
        SELECT p.id, p.code, p.name, p.customer_id, c.code AS customer_code, c.name AS customer_name, p.contract_value,
               p.start_date::text, p.end_date::text, p.status, p.notes,
               COALESCE((SELECT SUM(subtotal) FROM invoices i WHERE i.project_id = p.id), 0) AS billed,
               COALESCE((SELECT SUM(total - paid_amount - returned_amount) FROM invoices i WHERE i.project_id = p.id), 0) AS outstanding,
               COALESCE((SELECT SUM(amount) FROM customer_deposits d WHERE d.project_id = p.id), 0) AS deposits,
               COALESCE((SELECT SUM(amount - applied_amount) FROM customer_deposits d WHERE d.project_id = p.id), 0) AS deposits_remaining,
               (SELECT percent FROM project_progress g WHERE g.project_id = p.id ORDER BY date DESC, created_at DESC LIMIT 1) AS progress_pct,
               (SELECT date::text FROM project_progress g WHERE g.project_id = p.id ORDER BY date DESC, created_at DESC LIMIT 1) AS progress_date,
               COALESCE((SELECT SUM(adjustment) FROM project_progress g WHERE g.project_id = p.id), 0) AS accrual,
               COALESCE(pc.v, 0) AS direct_cost
        FROM projects p JOIN customers c ON c.id = p.customer_id
        LEFT JOIN (SELECT project_id, SUM(amount) AS v FROM ${projectCostsSql(tenantId)} x GROUP BY project_id) pc ON pc.project_id = p.id
        WHERE p.tenant_id = ${tenantId} ${id ? sql`AND p.id = ${id}` : sql``}
        ORDER BY (p.status = 'ACTIVE') DESC, p.created_at DESC
        LIMIT 500`);
  }

  /** Dipakai oleh ServiceProjectsService.recordProgress */
  queryProjectForRecordProgress(db: DbOrTx, projectId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh ServiceProjectsService.recordProgress */
  findProjectsById(db: DbOrTx, projectId: string) {
    return db.select().from(projects).where(eq(projects.id, projectId));
  }

  /** Dipakai oleh ServiceProjectsService.recordProgress */
  listProjectProgressByProjectIdAndDateAndCreatedAt(db: DbOrTx, projectId: string) {
    return db
      .select()
      .from(projectProgress)
      .where(eq(projectProgress.projectId, projectId))
      .orderBy(desc(projectProgress.date), desc(projectProgress.createdAt));
  }

  /** Dipakai oleh ServiceProjectsService.recordProgress */
  queryInvoice(db: DbOrTx, projectId: string, date: string) {
    return db.execute<{ v: string }>(sql`
          SELECT COALESCE(SUM(subtotal), 0) AS v FROM invoices WHERE project_id = ${projectId} AND date <= ${date}`);
  }

  /** Dipakai oleh ServiceProjectsService.recordProgress */
  queryServiceInvoiceLine(db: DbOrTx, projectId: string) {
    return db.execute<{ account_id: string }>(sql`
          SELECT l.account_id FROM service_invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE i.project_id = ${projectId} GROUP BY l.account_id ORDER BY SUM(l.line_total) DESC LIMIT 1`);
  }

  /** Dipakai oleh ServiceProjectsService.getProject */
  queryAccount(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{
      source: string;
      doc_id: string;
      number: string;
      date: string;
      description: string | null;
      account: string;
      amount: string;
    }>(sql`
        SELECT x.source, x.doc_id, x.number, x.date::text, x.description, a.code || ' ' || a.name AS account, x.amount
        FROM ${projectCostsSql(tenantId)} x JOIN accounts a ON a.id = x.account_id
        WHERE x.project_id = ${id} AND x.amount <> 0
        ORDER BY x.date, x.number`);
  }

  /** Dipakai oleh ServiceProjectsService.createProject */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }

  /** Dipakai oleh ServiceProjectsService.createProject */
  findProjectsByCode(db: DbOrTx, tenantId: string, code: string) {
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.code, code)));
  }

  /** Dipakai oleh ServiceProjectsService.createProject */
  insertProjects(db: DbOrTx, tenantId: string, code: string, dto: CreateProjectDto) {
    return db
      .insert(projects)
      .values({
        tenantId: tenantId,
        code: code,
        name: dto.name.trim(),
        customerId: dto.customerId,
        contractValue: money(dto.contractValue).toFixed(2),
        startDate: dto.startDate ? toDocDate(dto.startDate) : null,
        endDate: dto.endDate ? toDocDate(dto.endDate) : null,
        notes: dto.notes,
      })
      .returning({ id: projects.id });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ServiceProjectsService.listProgress */
  listProjectProgressByProjectIdAndDateAndCreatedAtForListProgress(
    db: DbOrTx,
    tenantId: NonNullable<(typeof projectProgress.$inferSelect)['tenantId']>,
    projectId: NonNullable<(typeof projectProgress.$inferSelect)['projectId']>,
  ) {
    return db
      .select()
      .from(projectProgress)
      .where(and(eq(projectProgress.tenantId, tenantId), eq(projectProgress.projectId, projectId)))
      .orderBy(asc(projectProgress.date), asc(projectProgress.createdAt));
  }
}
