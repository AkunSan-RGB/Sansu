import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk AutoBookkeeping: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AutoBookkeepingRepository {
  /** Dipakai oleh AutoBookkeepingService.candidates */
  queryCandidates(db: DbOrTx) {
    return db.execute<{ id: string }>(sql`
      SELECT DISTINCT id FROM (
        SELECT tenant_id AS id FROM payroll_runs WHERE status = 'DRAFT'
        UNION SELECT tenant_id FROM invoices WHERE currency <> 'IDR' AND status <> 'PAID'
        UNION SELECT tenant_id FROM purchase_invoices WHERE currency <> 'IDR' AND status <> 'PAID'
        UNION SELECT id FROM tenants WHERE settings->'autoBookkeeping'->>'lock' = 'true' OR settings->'autoBookkeeping'->>'closeYear' = 'true'
      ) t`);
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryUser(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; email: string }>(
      sql`SELECT id, email FROM users WHERE tenant_id = ${tenantId} AND role = 'OWNER' AND is_active ORDER BY created_at LIMIT 1`,
    );
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryPayrollRun(db: DbOrTx, tenantId: string, today: string, minAge: number) {
    return db.execute<{ id: string; number: string; period: string }>(sql`
        SELECT id, number, period FROM payroll_runs
        WHERE tenant_id = ${tenantId} AND status = 'DRAFT' AND pay_date <= ${today} AND created_at <= now() - (${minAge} * interval '1 hour')
        ORDER BY period`);
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryJournalEntry(db: DbOrTx, tenantId: string, prevMonthEnd: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'FX_REVAL' AND date = ${prevMonthEnd}`,
    );
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryPayrollRunForRunTenant(db: DbOrTx, tenantId: string, prevMonthEnd: string) {
    return db.execute<{ period: string }>(
      sql`SELECT period FROM payroll_runs WHERE tenant_id = ${tenantId} AND status = 'DRAFT' AND period <= ${prevMonthEnd.slice(0, 7)} ORDER BY period LIMIT 1`,
    );
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryApprovalRequest(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING'`,
    );
  }

  /** Dipakai oleh AutoBookkeepingService.runTenant */
  queryJournalEntryForRunTenant(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'CLOSING' AND source_id = ${String(year)}`,
    );
  }

  /** Dipakai oleh AutoBookkeepingService.lastRuns: pekerjaan otomatis terakhir per jenis (dari jejak audit) */
  queryLastRuns(db: DbOrTx, tenantId: string) {
    return db.execute<{ action: string; at: string; data: unknown }>(sql`
      SELECT DISTINCT ON (action) action, created_at::text AS at, data
      FROM audit_logs
      WHERE tenant_id = ${tenantId} AND action IN ('AUTO_PAYROLL_POST', 'AUTO_FX_REVALUATION', 'AUTO_LOCK_PERIOD', 'AUTO_CLOSE_YEAR')
      ORDER BY action, created_at DESC`);
  }
}
