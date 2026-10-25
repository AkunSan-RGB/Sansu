import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenantApps } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

/** Akses data untuk Apps: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AppsRepository {
  /** Dipakai oleh AppsService.enabled */
  listTenantApps(db: DbOrTx, tenantId: string) {
    return db.select({ k: tenantApps.appKey }).from(tenantApps).where(eq(tenantApps.tenantId, tenantId));
  }

  /** Dipakai oleh AppsService.install */
  insertTenantApps(
    db: DbOrTx,
    keys: ('sales' | 'purchase' | 'inventory' | 'accounting' | 'cash' | 'pos' | 'crm' | 'hr' | 'payroll' | 'utility')[],
    tenantId: string,
  ) {
    return db
      .insert(tenantApps)
      .values(keys.map((k) => ({ tenantId: tenantId, appKey: k })))
      .onConflictDoNothing();
  }

  /** Dipakai oleh AppsService.uninstall */
  deleteTenantAppsByAppKey(
    db: DbOrTx,
    tenantId: string,
    key: 'sales' | 'purchase' | 'inventory' | 'accounting' | 'cash' | 'pos' | 'crm' | 'hr' | 'payroll' | 'utility',
  ) {
    return db.delete(tenantApps).where(and(eq(tenantApps.tenantId, tenantId), eq(tenantApps.appKey, key)));
  }
}
