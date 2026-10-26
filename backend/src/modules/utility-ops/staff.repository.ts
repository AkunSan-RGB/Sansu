import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.shared';

@Injectable()
export class StaffRepository {
  /** Pengguna aktif perusahaan (untuk memilih petugas/teknisi/kolektor) */
  list(db: DbOrTx, tenantId: string) {
    return rowsOf<{ id: string; name: string; role: string }>(db, sql`SELECT id, name, role::text AS role FROM users WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; name: string; role: string }>(db, sql`SELECT id, name, role::text AS role FROM users WHERE tenant_id = ${tenantId} AND id = ${id} AND is_active`);
  }
  connection(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; number: string; customer_id: string; address: string; status: string; zone: string | null }>(db, sql`SELECT id, number, customer_id, address, status::text AS status, zone FROM utility_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  customer(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; name: string; phone: string | null; address: string | null }>(db, sql`SELECT id, name, phone, address FROM customers WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
}
