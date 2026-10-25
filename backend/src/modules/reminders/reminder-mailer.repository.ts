import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk ReminderMailer: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ReminderMailerRepository {
  /** Dipakai oleh ReminderMailer.claim */
  queryReminderLog(
    db: DbOrTx,
    force: boolean,
    tenantId: string,
    kind: 'DIGEST' | 'CUSTOMER' | 'BANK_ESC',
    ref: string,
    stage: string,
    sentTo: string,
  ) {
    return db.execute<{ id: string }>(
      force
        ? sql`INSERT INTO reminder_log (tenant_id, kind, ref, stage, sent_to) VALUES (${tenantId}, ${kind}, ${ref}, ${stage}, ${sentTo})
              ON CONFLICT (tenant_id, kind, ref, stage) DO UPDATE SET sent_at = now(), sent_to = EXCLUDED.sent_to RETURNING id`
        : sql`INSERT INTO reminder_log (tenant_id, kind, ref, stage, sent_to) VALUES (${tenantId}, ${kind}, ${ref}, ${stage}, ${sentTo})
              ON CONFLICT (tenant_id, kind, ref, stage) DO NOTHING RETURNING id`,
    );
  }

  /** Dipakai oleh ReminderMailer.sendDigest */
  queryTenant(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string }>(sql`SELECT name FROM tenants WHERE id = ${tenantId}`);
  }

  /** Dipakai oleh ReminderMailer.sendDigestTo */
  queryUser(db: DbOrTx, sub: string) {
    return db.execute<{ email: string; name: string }>(sql`SELECT email, name FROM users WHERE id = ${sub}`);
  }

  /** Dipakai oleh ReminderMailer.invoiceInfo */
  queryInvoice(db: DbOrTx, tenantId: string, invoiceId: string) {
    return db.execute<{
      number: string;
      due: string;
      outstanding: string;
      name: string;
      email: string | null;
      company: string;
    }>(sql`
      SELECT i.number, i.due_date::text AS due, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding, c.name, c.email, t.name AS company
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.id = ${invoiceId} AND i.status <> 'PAID'`);
  }

  /** Dipakai oleh ReminderMailer.runCustomerReminders */
  queryInvoiceForRunCustomerReminders(db: DbOrTx, tenantId: string) {
    return db.execute<{
      id: string;
      number: string;
      due: string;
      outstanding: string;
      name: string;
      email: string;
      company: string;
    }>(sql`
      SELECT i.id, i.number, i.due_date::text AS due, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding, c.name, c.email, t.name AS company
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND c.email IS NOT NULL AND c.email <> ''
        AND (i.total - i.paid_amount - i.returned_amount) > 0.005 AND i.is_opening = false`);
  }

  /** Dipakai oleh ReminderMailer.runBankEscalation */
  queryBankStatementLine(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number; total: string; oldest: number }>(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest
      FROM bank_statement_lines WHERE tenant_id = ${tenantId} AND status = 'UNMATCHED' AND amount > 0 AND date < CURRENT_DATE`);
  }

  /** Dipakai oleh ReminderMailer.schedulableTenants */
  queryTenantForSchedulableTenants(db: DbOrTx) {
    return db.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE NOT (settings ? 'demo')`);
  }
}
