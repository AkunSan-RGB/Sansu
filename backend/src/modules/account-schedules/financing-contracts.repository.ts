import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { financingContracts } from '../../db/schema';

/** Akses data kontrak pembiayaan (pinjaman, sewa pembiayaan, biaya dibayar di muka) */
@Injectable()
export class FinancingContractsRepository {
  list(db: DbOrTx, tenantId: string) {
    return db.select().from(financingContracts).where(eq(financingContracts.tenantId, tenantId)).orderBy(asc(financingContracts.startDate), asc(financingContracts.name));
  }

  async find(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db.select().from(financingContracts).where(and(eq(financingContracts.tenantId, tenantId), eq(financingContracts.id, id)));
    return r;
  }

  async insert(db: DbOrTx, row: typeof financingContracts.$inferInsert) {
    const [r] = await db.insert(financingContracts).values(row).returning();
    return r;
  }

  async update(db: DbOrTx, tenantId: string, id: string, patch: Partial<typeof financingContracts.$inferInsert>) {
    const [r] = await db.update(financingContracts).set(patch).where(and(eq(financingContracts.tenantId, tenantId), eq(financingContracts.id, id))).returning();
    return r;
  }
}
