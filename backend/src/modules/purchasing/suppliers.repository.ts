import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, ne } from 'drizzle-orm';
import { purchaseInvoices, suppliers } from '../../db/schema';

/** Akses data untuk Suppliers: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SuppliersRepository {
  /** Dipakai oleh SuppliersService.get */
  sumPurchaseInvoicesBySupplierIdAndStatus(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
      })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.tenantId, tenantId),
          eq(purchaseInvoices.supplierId, id),
          ne(purchaseInvoices.status, 'PAID'),
        ),
      );
  }

  /** Dipakai oleh SuppliersService.findLookalikes */
  listSuppliers(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, npwp: suppliers.npwp })
      .from(suppliers)
      .where(eq(suppliers.tenantId, tenantId));
  }

  /** Dipakai oleh SuppliersService.applyBankChange */
  updateSuppliersById(
    db: DbOrTx,
    bank: { bankName?: string; bankAccountNo?: string; bankAccountName?: string },
    supplierId: string,
  ) {
    return db
      .update(suppliers)
      .set({ ...bank, bankChangedAt: new Date() })
      .where(eq(suppliers.id, supplierId))
      .returning();
  }
}
