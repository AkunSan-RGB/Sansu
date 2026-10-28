import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbOrTx } from '../../../db/db';
import { projectBoqItems, projects } from '../../../db/schema';

/** Akses data kontraktor: BoQ proyek dan tagihan retensi */
@Injectable()
export class ServiceContractingRepository {
  /** Dipakai oleh ServiceContractingService: proyek milik perusahaan */
  findProject(db: DbOrTx, tenantId: string, id: string) {
    return db.select().from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  }

  /** Kunci baris proyek agar dua pembaruan BoQ/kemajuan tidak bertabrakan */
  lockProject(db: DbOrTx, tenantId: string, id: string) {
    return db.execute(sql`SELECT id FROM projects WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  listBoqItems(db: DbOrTx, projectId: string) {
    return db.select().from(projectBoqItems).where(eq(projectBoqItems.projectId, projectId)).orderBy(asc(projectBoqItems.lineNo));
  }

  insertBoqItem(db: DbOrTx, v: typeof projectBoqItems.$inferInsert) {
    return db.insert(projectBoqItems).values(v);
  }

  updateBoqItem(db: DbOrTx, id: string, v: Partial<typeof projectBoqItems.$inferInsert>) {
    return db.update(projectBoqItems).set(v).where(eq(projectBoqItems.id, id));
  }

  deleteBoqItems(db: DbOrTx, ids: string[]) {
    if (!ids.length) return Promise.resolve();
    return db.delete(projectBoqItems).where(inArray(projectBoqItems.id, ids));
  }

  /** Tagihan retensi proyek beserta tagihan termin induknya */
  listRetentionInvoices(db: DbOrTx, tenantId: string, projectId: string) {
    return db
      .execute<{ id: string; number: string; date: string; due_date: string; total: string; paid_amount: string; returned_amount: string; parent_number: string | null; term_label: string | null }>(sql`
        SELECT r.id, r.number, r.date::text, r.due_date::text, r.total, r.paid_amount, r.returned_amount, p.number AS parent_number, r.term_label
        FROM invoices r LEFT JOIN invoices p ON p.id = r.retention_of_invoice_id
        WHERE r.tenant_id = ${tenantId} AND r.project_id = ${projectId} AND r.retention_of_invoice_id IS NOT NULL
        ORDER BY r.date, r.number`)
      .then((x) => x.rows);
  }

  /** Mundurkan/ubah jatuh tempo tagihan retensi yang belum lunas */
  releaseRetentionInvoices(db: DbOrTx, tenantId: string, projectId: string, dueDate: string) {
    return db
      .execute<{ id: string }>(sql`
        UPDATE invoices SET due_date = ${dueDate}
        WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND retention_of_invoice_id IS NOT NULL AND total - paid_amount - returned_amount > 0
        RETURNING id`)
      .then((x) => x.rows);
  }
}
