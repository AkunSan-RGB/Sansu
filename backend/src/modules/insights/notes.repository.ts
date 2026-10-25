import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { reportNotes } from '../../db/schema';

/** Akses data untuk Notes: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class NotesRepository {
  /** Dipakai oleh NotesService.build */
  queryProductionOrder(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM production_orders WHERE tenant_id = ${tenantId} AND status = 'COMPLETED'`,
    );
  }

  /** Dipakai oleh NotesService.build */
  queryBuild(db: DbOrTx, tenantId: string) {
    return db.execute<{ has: boolean }>(sql`
      SELECT (EXISTS (SELECT 1 FROM invoices WHERE tenant_id = ${tenantId} AND currency <> 'IDR')
           OR EXISTS (SELECT 1 FROM purchase_invoices WHERE tenant_id = ${tenantId} AND currency <> 'IDR')) AS has`);
  }

  /** Dipakai oleh NotesService.build */
  queryJournalLine(db: DbOrTx, tenantId: string, year: number, to: string) {
    return db.execute<{ source_type: string; net: string }>(sql`
            SELECT e.source_type, SUM(l.credit - l.debit) AS net FROM journal_lines l
            JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id
            WHERE e.tenant_id = ${tenantId} AND a.system_key IN ('FX_GAIN', 'FX_LOSS') AND e.date >= ${`${year}-01-01`} AND e.date <= ${to}
            GROUP BY e.source_type`);
  }

  /** Dipakai oleh NotesService.build */
  queryInvoice(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ name: string; v: string }>(sql`
        SELECT c.name, SUM(i.total - i.paid_amount - i.returned_amount) AS v FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date <= ${to} AND i.status <> 'PAID' GROUP BY c.name ORDER BY v DESC LIMIT 10`);
  }

  /** Dipakai oleh NotesService.build */
  queryInvoiceForBuild(db: DbOrTx, to: string, tenantId: string) {
    return db.execute<{ bucket: string; v: string }>(sql`
        SELECT CASE WHEN due_date >= ${to} THEN '1. Belum jatuh tempo'
                    WHEN due_date >= (${to}::date - 30) THEN '2. 1–30 hari'
                    WHEN due_date >= (${to}::date - 60) THEN '3. 31–60 hari'
                    WHEN due_date >= (${to}::date - 90) THEN '4. 61–90 hari'
                    ELSE '5. Lebih dari 90 hari' END AS bucket,
               SUM(total - paid_amount - returned_amount) AS v
        FROM invoices WHERE tenant_id = ${tenantId} AND date <= ${to} AND status <> 'PAID' GROUP BY 1 ORDER BY 1`);
  }

  /** Dipakai oleh NotesService.build */
  queryStockBalance(db: DbOrTx, tenantId: string) {
    return db.execute<{ category: string | null; v: string }>(sql`
        SELECT p.category, SUM(b.qty * b.avg_cost) AS v FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId} GROUP BY p.category ORDER BY v DESC`);
  }

  /** Dipakai oleh NotesService.build */
  queryInventoryWritedown(db: DbOrTx, tenantId: string, year: number, to: string) {
    return db.execute<{ v: string; r: string }>(sql`
        SELECT COALESCE(SUM(total) FILTER (WHERE kind = 'WRITEDOWN'), 0) AS v, COALESCE(SUM(total) FILTER (WHERE kind = 'REVERSAL'), 0) AS r
        FROM inventory_writedowns
        WHERE tenant_id = ${tenantId} AND date BETWEEN ${`${year}-01-01`} AND ${to}`);
  }

  /** Dipakai oleh NotesService.build */
  queryBuildForBuild(db: DbOrTx, tenantId: string, year: number, to: string) {
    return db.execute<{ category: string | null; v: string }>(sql`
        SELECT category, SUM(v) AS v FROM (
          SELECT p.category, l.line_total AS v FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
            WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${`${year}-01-01`} AND ${to}
          UNION ALL
          SELECT p.category, CASE WHEN o.prices_include_vat AND o.total <> 0 THEN l.line_total * o.subtotal / o.total ELSE l.line_total END FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id
            WHERE o.tenant_id = ${tenantId} AND o.date BETWEEN ${`${year}-01-01`} AND ${to}
        ) x GROUP BY category ORDER BY v DESC`);
  }

  /** Dipakai oleh NotesService.build */
  queryPurchaseOrder(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ number: string; supplier: string; date: string; total: string }>(sql`
        SELECT o.number, s.name AS supplier, o.date, o.total FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.status = 'CONFIRMED' AND o.date <= ${to} ORDER BY o.date, o.number`);
  }

  /** Dipakai oleh NotesService.save */
  insertReportNotes(db: DbOrTx, tenantId: string, year: number, key: string, content: string) {
    return db
      .insert(reportNotes)
      .values({ tenantId: tenantId, year: year, key: key, content: content })
      .onConflictDoUpdate({
        target: [reportNotes.tenantId, reportNotes.year, reportNotes.key],
        set: { content: content, updatedAt: new Date() },
      });
  }

  /** Dipakai oleh NotesService.reset */
  deleteReportNotesByYearAndKey(db: DbOrTx, tenantId: string, year: number, key: string) {
    return db
      .delete(reportNotes)
      .where(and(eq(reportNotes.tenantId, tenantId), eq(reportNotes.year, year), eq(reportNotes.key, key)));
  }
}
