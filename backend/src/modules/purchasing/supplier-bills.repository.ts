import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants, projects, accounts, purchaseInvoiceLines } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { SYS } from '../accounting/default-coa';

/** Akses data untuk SupplierBills: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SupplierBillsRepository {
  /** Dipakai oleh SupplierBillsService.createBill */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db
      .select({ ppnRate: tenants.ppnRate, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh SupplierBillsService.createBill */
  findProjectsById(db: DbOrTx, projectId: string, tenantId: string) {
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  }

  /** Dipakai oleh SupplierBillsService.createBill */
  findAccountsBySystemKey(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, SYS.SMALL_ASSET_EXPENSE)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SupplierBillsService.createBill */
  insertPurchaseInvoiceLines(db: DbOrTx, values: typeof purchaseInvoiceLines.$inferInsert) {
    return db.insert(purchaseInvoiceLines).values(values);
  }
}
