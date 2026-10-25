import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbOrTx } from './db';
import { accounts, customers, employees, warehouses } from './schema';

/**
 * Pencarian satu baris data acuan (gudang, pelanggan, akun, karyawan) milik satu perusahaan.
 * Dipakai bersama oleh banyak modul agar kueri id+tenant yang sama tidak ditulis ulang di tiap service.
 */
@Injectable()
export class ReferenceRepository {
  async warehouse(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
    return r;
  }

  async customer(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
    return r;
  }

  async account(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return r;
  }

  async employee(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)));
    return r;
  }
}
