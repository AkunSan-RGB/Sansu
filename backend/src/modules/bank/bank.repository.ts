import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, bankLineExtraMatches, bankRules, bankStatementLines, bankStatements, journalLines } from '../../db/schema';

type LinePatch = Partial<typeof bankStatementLines.$inferInsert>;
type RuleValues = Partial<typeof bankRules.$inferInsert>;

/** Akses data rekening koran, mutasi, pencocokan, dan aturan bank. Setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BankRepository {
  // ---- rekening koran ----
  async statementById(db: DbOrTx, id: string) {
    const [st] = await db.select().from(bankStatements).where(eq(bankStatements.id, id));
    return st;
  }

  async deleteStatement(db: DbOrTx, id: string) {
    await db.delete(bankStatements).where(eq(bankStatements.id, id));
  }

  // ---- mutasi ----
  unmatchedLines(db: DbOrTx, statementId: string) {
    return db
      .select()
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.statementId, statementId), eq(bankStatementLines.status, 'UNMATCHED')))
      .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.seq));
  }

  async patchLine(db: DbOrTx, lineId: string, patch: LinePatch) {
    await db.update(bankStatementLines).set(patch).where(eq(bankStatementLines.id, lineId));
  }

  // ---- pencocokan dengan transaksi buku ----
  async journalLineById(db: DbOrTx, id: string) {
    const [b] = await db.select().from(journalLines).where(eq(journalLines.id, id));
    return b;
  }

  /** Apakah transaksi buku sudah dipakai mutasi lain (sebagai pasangan utama atau tambahan) */
  async journalLineTaken(db: DbOrTx, journalLineId: string) {
    const [main] = await db.select({ id: bankStatementLines.id }).from(bankStatementLines).where(eq(bankStatementLines.journalLineId, journalLineId));
    const [extra] = await db.select({ id: bankLineExtraMatches.id }).from(bankLineExtraMatches).where(eq(bankLineExtraMatches.journalLineId, journalLineId));
    return !!(main || extra);
  }

  async insertExtraMatches(db: DbOrTx, tenantId: string, lineId: string, journalLineIds: string[]) {
    await db.insert(bankLineExtraMatches).values(journalLineIds.map((jl) => ({ tenantId, lineId, journalLineId: jl })));
  }

  async clearExtraMatches(db: DbOrTx, lineId: string) {
    await db.delete(bankLineExtraMatches).where(eq(bankLineExtraMatches.lineId, lineId));
  }

  // ---- aturan otomatis ----
  listRules(db: DbOrTx, tenantId: string) {
    return db.select().from(bankRules).where(eq(bankRules.tenantId, tenantId)).orderBy(asc(bankRules.name));
  }

  activeRules(db: DbOrTx, tenantId: string) {
    return db.select().from(bankRules).where(and(eq(bankRules.tenantId, tenantId), eq(bankRules.isActive, true)));
  }

  async insertRule(db: DbOrTx, values: typeof bankRules.$inferInsert) {
    const [row] = await db.insert(bankRules).values(values).returning();
    return row;
  }

  async updateRule(db: DbOrTx, tenantId: string, id: string, values: RuleValues) {
    const [row] = await db.update(bankRules).set(values).where(and(eq(bankRules.id, id), eq(bankRules.tenantId, tenantId))).returning();
    return row;
  }

  async deleteRule(db: DbOrTx, tenantId: string, id: string) {
    const r = await db.delete(bankRules).where(and(eq(bankRules.id, id), eq(bankRules.tenantId, tenantId))).returning({ id: bankRules.id });
    return r.length > 0;
  }

  // ---- akun ----
  accountsOfTenant(db: DbOrTx, tenantId: string) {
    return db.select({ id: accounts.id, code: accounts.code, type: accounts.type, isPostable: accounts.isPostable }).from(accounts).where(eq(accounts.tenantId, tenantId));
  }

  accountsByIds(db: DbOrTx, tenantId: string, ids: string[]) {
    return db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  }

  async postableAccountByCode(db: DbOrTx, tenantId: string, code: string) {
    const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code), eq(accounts.isPostable, true)));
    return a;
  }
}
