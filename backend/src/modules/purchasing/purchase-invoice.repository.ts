import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, purchaseInvoices, supplierPayments, suppliers } from '../../db/schema';

/** Akses data faktur pembelian: pencarian satu baris per id, selalu memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseInvoiceRepository {
  async supplierById(db: DbOrTx, id: string) {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    return s;
  }

  async supplierOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [s] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
    return s;
  }

  async accountOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  async invoiceById(db: DbOrTx, id: string) {
    const [i] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, id));
    return i;
  }

  async paymentById(db: DbOrTx, id: string) {
    const [p] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, id));
    return p;
  }
}
