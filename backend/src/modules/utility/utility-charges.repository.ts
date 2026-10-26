import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, utilityCharges } from '../../db/schema';

@Injectable()
export class UtilityChargesRepository {
  list(db: DbOrTx, tenantId: string) {
    return db.select().from(utilityCharges).where(eq(utilityCharges.tenantId, tenantId)).orderBy(asc(utilityCharges.name));
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return db.select().from(utilityCharges).where(and(eq(utilityCharges.tenantId, tenantId), eq(utilityCharges.id, id)));
  }
  insert(db: DbOrTx, rows: (typeof utilityCharges.$inferInsert)[]) {
    return db.insert(utilityCharges).values(rows).onConflictDoNothing().returning();
  }
  update(db: DbOrTx, tenantId: string, id: string, set: Partial<typeof utilityCharges.$inferInsert>) {
    return db.update(utilityCharges).set(set).where(and(eq(utilityCharges.tenantId, tenantId), eq(utilityCharges.id, id))).returning();
  }
  accountByKey(db: DbOrTx, tenantId: string, key: string) {
    return db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, key)));
  }
}
