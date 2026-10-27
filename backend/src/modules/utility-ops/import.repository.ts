import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { rowsOf } from './ops.repository';

const uuidList = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

@Injectable()
export class ImportRepository {
  tariffs(db: DbOrTx, tenantId: string) {
    return rowsOf<{ id: string; name: string; metered: boolean; service_type: string }>(db, sql`SELECT id, name, metered, service_type::text AS service_type FROM utility_tariffs WHERE tenant_id = ${tenantId} AND is_active`);
  }
  routes(db: DbOrTx, tenantId: string) { return rowsOf<{ id: string; code: string }>(db, sql`SELECT id, code FROM utility_routes WHERE tenant_id = ${tenantId} AND is_active`); }
  customersByCodes(db: DbOrTx, tenantId: string, codes: string[]) {
    if (!codes.length) return Promise.resolve([] as { id: string; code: string }[]);
    return rowsOf<{ id: string; code: string }>(db, sql`SELECT id, code FROM customers WHERE tenant_id = ${tenantId} AND code IN (${uuidList(codes)})`);
  }
  metersTaken(db: DbOrTx, tenantId: string, meters: string[]) {
    if (!meters.length) return Promise.resolve([] as { meter_no: string; number: string }[]);
    return rowsOf<{ meter_no: string; number: string }>(db, sql`SELECT meter_no, number FROM utility_connections WHERE tenant_id = ${tenantId} AND status <> 'DISCONNECTED' AND meter_no IN (${uuidList(meters)})`);
  }
  addressesTaken(db: DbOrTx, tenantId: string, addresses: string[]) {
    if (!addresses.length) return Promise.resolve([] as { address: string; number: string; service_type: string }[]);
    return rowsOf<{ address: string; number: string; service_type: string }>(db, sql`SELECT lower(btrim(c.address)) AS address, c.number, t.service_type::text AS service_type FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED' AND lower(btrim(c.address)) IN (${uuidList(addresses)})`);
  }
  async deleteCustomer(db: DbOrTx, tenantId: string, id: string) { await db.execute(sql`DELETE FROM customers WHERE tenant_id = ${tenantId} AND id = ${id}`); }
}
