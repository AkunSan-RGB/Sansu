/**
 * Rekonsiliasi bank: impor mutasi rekening (CSV/Excel dari internet banking), cocokkan otomatis
 * dengan transaksi di buku, buat jurnal untuk mutasi yang belum tercatat (biaya admin, bunga, dll.)
 * dan susun laporan rekonsiliasi saldo bank vs saldo buku.
 */
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { CONTROL_PROFILES, DEFAULT_BANK_RULES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, diffDays, DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, bankReconciliations, bankRules, bankStatementLines, bankStatements, journalLines } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingService } from '../accounting/posting.service';

// ---------- DTO ----------
export class StatementLineDto {
  @ApiProperty({ example: '2026-09-03' }) @IsDateString() date: string;
  @ApiProperty({ example: 'TRSF E-BANKING CR 0309/FTSCY/WS95051 TOKO SUMBER' }) @IsString() @MaxLength(300) description: string;
  @ApiProperty({ example: '1500000', description: '+ uang masuk (kredit), − uang keluar (debet)' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ example: '25000000' }) @IsOptional() @IsNumberString() balance?: string;
}
export class ImportStatementDto {
  @ApiProperty({ description: 'Akun bank di Bagan Akun' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() openingBalance?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() closingBalance?: string;
  @ApiProperty({ type: [StatementLineDto] })
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  lines: StatementLineDto[];
}
export class MatchDto {
  @ApiProperty() @IsUUID() journalLineId: string;
}
export class CreateFromLineDto {
  @ApiProperty({ description: 'Akun lawan, mis. Beban Administrasi Bank atau Pendapatan Bunga' }) @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class ReasonDto {
  @ApiProperty({ description: 'Alasan (wajib, min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
}
export class BankRuleDto {
  @ApiProperty({ example: 'Biaya admin bank' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: 'BIAYA ADM', description: 'Kata yang ada di keterangan mutasi (tidak peka huruf besar/kecil)' }) @IsString() @MinLength(3) @MaxLength(80) keyword: string;
  @ApiProperty({ enum: ['IN', 'OUT', 'ANY'] }) @IsIn(['IN', 'OUT', 'ANY']) direction: 'IN' | 'OUT' | 'ANY';
  @ApiProperty({ description: 'Akun pendapatan / beban lawan' }) @IsUUID() accountId: string;
  @ApiPropertyOptional({ example: '5000000', description: 'Di atas nilai ini tetap diproses manual' }) @IsOptional() @IsNumberString() maxAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class SignReconciliationDto {
  @ApiProperty() @IsUUID() cashAccountId: string;
  @ApiProperty({ example: '2026-09' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

const MATCH_BEFORE = 7;
const MATCH_AFTER = 4;

type BookLine = { id: string; journal_id: string; date: string; number: string; description: string; reference: string | null; debit: string; credit: string; source_type: string };

const tokens = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 4 && !/^\d{1,3}$/.test(t)),
  );

// ---------- Service ----------
@Injectable()
export class BankService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async bankAccount(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    if (!a || !a.isCashAccount) throw new BadRequestException('Pilih akun kas / bank');
    return a;
  }

  list(tenantId: string, cashAccountId?: string) {
    return this.db.execute<{
      id: string;
      cash_account_id: string;
      account_code: string;
      account_name: string;
      file_name: string | null;
      period_from: string;
      period_to: string;
      closing_balance: string | null;
      lines: number;
      matched: number;
      created_at: string;
    }>(sql`
      SELECT s.id, s.cash_account_id, a.code AS account_code, a.name AS account_name, s.file_name, s.period_from, s.period_to,
             s.closing_balance, s.created_at,
             COUNT(l.id)::int AS lines, COUNT(l.id) FILTER (WHERE l.status <> 'UNMATCHED')::int AS matched
      FROM bank_statements s JOIN accounts a ON a.id = s.cash_account_id
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE s.tenant_id = ${tenantId} ${cashAccountId ? sql`AND s.cash_account_id = ${cashAccountId}` : sql``}
      GROUP BY s.id, a.code, a.name ORDER BY s.period_to DESC, s.created_at DESC`).then((r) => r.rows);
  }

  async get(tenantId: string, id: string) {
    const st = await this.db.query.bankStatements.findFirst({
      where: and(eq(bankStatements.id, id), eq(bankStatements.tenantId, tenantId)),
      with: { cashAccount: { columns: { id: true, code: true, name: true } }, lines: { orderBy: asc(bankStatementLines.seq) } },
    });
    if (!st) throw new NotFoundException('Rekening koran tidak ditemukan');
    const ids = st.lines.map((l) => l.journalLineId).filter(Boolean) as string[];
    const book = ids.length
      ? await this.db.execute<BookLine>(sql`
          SELECT l.id, j.id AS journal_id, j.date, j.number, j.description, j.reference, l.debit, l.credit, j.source_type
          FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
          WHERE l.id IN (${sql.join(
            ids.map((x) => sql`${x}`),
            sql`, `,
          )})`)
      : { rows: [] as BookLine[] };
    const byId = new Map(book.rows.map((b) => [b.id, b]));
    const lines = st.lines.map((l) => {
      const b = l.journalLineId ? byId.get(l.journalLineId) : undefined;
      return { ...l, book: b ? { journalId: b.journal_id, number: b.number, date: b.date, description: b.description, sourceType: b.source_type } : null };
    });
    const sumIn = st.lines.filter((l) => D(l.amount).gt(0)).reduce<Dec>((a, l) => a.plus(l.amount), ZERO);
    const sumOut = st.lines.filter((l) => D(l.amount).lt(0)).reduce<Dec>((a, l) => a.plus(l.amount), ZERO);
    const counts = { UNMATCHED: 0, MATCHED: 0, CREATED: 0, IGNORED: 0 } as Record<string, number>;
    for (const l of st.lines) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return { ...st, lines, summary: { totalIn: sumIn.toFixed(2), totalOut: sumOut.toFixed(2), counts } };
  }

  async import(user: AuthUser, dto: ImportStatementDto) {
    let skipped = 0;
    const id = await this.db.transaction(async (tx) => {
      await this.bankAccount(tx, user.tenantId, dto.cashAccountId);
      const rows = dto.lines.map((l, i) => ({ ...l, date: toDocDate(l.date), amount: money(l.amount), seq: i + 1 })).filter((l) => !l.amount.isZero());
      if (!rows.length) throw new BadRequestException('Tidak ada mutasi bernilai di file');
      const dates = rows.map((r) => r.date).sort();
      // Integritas: saldo awal + jumlah mutasi harus = saldo akhir; saldo berjalan tiap baris harus konsisten (anti file diubah / salah baca)
      const sumAmt = rows.reduce<Dec>((a, r) => a.plus(r.amount), ZERO);
      if (dto.openingBalance && dto.closingBalance && !money(dto.openingBalance).plus(sumAmt).equals(money(dto.closingBalance))) {
        throw new BadRequestException({ statusCode: 400, code: 'BANK_STATEMENT_INCONSISTENT', message: `Saldo awal ${money(dto.openingBalance).toFixed(2)} + mutasi ${sumAmt.toFixed(2)} tidak sama dengan saldo akhir ${money(dto.closingBalance).toFixed(2)}. File tampak tidak lengkap atau diubah.` });
      }
      if (rows.length > 1 && rows.every((r) => r.balance != null)) {
        const chain = (list: typeof rows) => list.every((r, i) => i === 0 || money(r.balance!).minus(money(list[i - 1].balance!)).minus(r.amount).abs().lte(0.01));
        if (!chain(rows) && !chain([...rows].reverse())) {
          throw new BadRequestException({ statusCode: 400, code: 'BANK_STATEMENT_INCONSISTENT', message: 'Saldo berjalan pada file tidak cocok dengan jumlah mutasinya. File tampak diubah atau salah baca; unduh ulang dari internet banking.' });
        }
      }
      // Anti catat ganda: mutasi yang sama persis (tanggal, nilai, keterangan) yang sudah pernah diimpor dilewati
      // (banyaknya diperhitungkan, jadi dua mutasi kembar yang sah di hari yang sama tetap masuk)
      const existing = await tx.execute<{ k: string; n: number }>(sql`
        SELECT l.date::text || '|' || l.amount::text || '|' || l.description AS k, COUNT(*)::int AS n
        FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
        WHERE s.tenant_id = ${user.tenantId} AND s.cash_account_id = ${dto.cashAccountId} AND l.date BETWEEN ${dates[0]} AND ${dates[dates.length - 1]}
        GROUP BY 1`);
      const seen = new Map(existing.rows.map((r) => [r.k, r.n]));
      const fresh = rows.filter((r) => {
        const k = `${r.date}|${r.amount.toFixed(2)}|${r.description.trim()}`;
        const left = seen.get(k) ?? 0;
        if (left > 0) {
          seen.set(k, left - 1);
          return false;
        }
        return true;
      });
      skipped = rows.length - fresh.length;
      if (!fresh.length) throw new BadRequestException(`Mutasi ${dates[0]} s/d ${dates[dates.length - 1]} untuk rekening ini sudah pernah diimpor`);
      const last = rows.filter((r) => r.balance != null).at(-1);
      const [st] = await tx
        .insert(bankStatements)
        .values({
          tenantId: user.tenantId,
          cashAccountId: dto.cashAccountId,
          fileName: dto.fileName,
          periodFrom: dates[0],
          periodTo: dates[dates.length - 1],
          openingBalance: dto.openingBalance ? money(dto.openingBalance).toFixed(2) : null,
          closingBalance: dto.closingBalance ? money(dto.closingBalance).toFixed(2) : last?.balance ? money(last.balance).toFixed(2) : null,
          importedById: user.sub,
        })
        .returning();
      await tx.insert(bankStatementLines).values(
        fresh.map((r, i) => ({
          tenantId: user.tenantId,
          statementId: st.id,
          seq: i + 1,
          date: r.date,
          description: r.description.trim(),
          amount: r.amount.toFixed(2),
          balance: r.balance ? money(r.balance).toFixed(2) : null,
        })),
      );
      await this.autoMatchTx(tx, user.tenantId, st.id);
      const byRule = await this.applyRules(tx, user, st.id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'IMPORT', entity: 'BankStatement', entityId: st.id, data: { lines: fresh.length, skippedDuplicates: skipped, byRule } });
      return st.id;
    });
    return { ...(await this.get(user.tenantId, id)), skippedDuplicates: skipped };
  }

  async autoMatch(user: AuthUser, id: string) {
    const n = await this.db.transaction((tx) => this.autoMatchTx(tx, user.tenantId, id));
    return { matched: n, statement: await this.get(user.tenantId, id) };
  }

  /** Transaksi buku di rekening ini yang belum dicocokkan dengan mutasi bank mana pun */
  private async openBookLines(db: DbOrTx, tenantId: string, cashAccountId: string, from: DocDate, to: DocDate) {
    const r = await db.execute<BookLine>(sql`
      SELECT l.id, j.id AS journal_id, j.date, j.number, j.description, j.reference, l.debit, l.credit, j.source_type
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${cashAccountId} AND j.source_type <> 'CLOSING'
        AND j.date BETWEEN ${from} AND ${to}
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = l.id)
      ORDER BY j.date, j.number`);
    return r.rows;
  }

  private async autoMatchTx(tx: Tx, tenantId: string, statementId: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bank:${tenantId}`}))`);
    const [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, statementId), eq(bankStatements.tenantId, tenantId)));
    if (!st) throw new NotFoundException('Rekening koran tidak ditemukan');
    const lines = await tx
      .select()
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.statementId, statementId), eq(bankStatementLines.status, 'UNMATCHED')))
      .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.seq));
    if (!lines.length) return 0;
    const pool = await this.openBookLines(tx, tenantId, st.cashAccountId, addDays(st.periodFrom, -MATCH_BEFORE), addDays(st.periodTo, MATCH_AFTER));
    const used = new Set<string>();
    let matched = 0;
    for (const l of lines) {
      const amt = D(l.amount);
      const words = tokens(l.description);
      let best: { b: BookLine; score: number } | null = null;
      for (const b of pool) {
        if (used.has(b.id)) continue;
        const bookAmt = D(b.debit).minus(b.credit);
        if (!bookAmt.equals(amt)) continue;
        const gap = diffDays(b.date, l.date); // positif = bank mencatat setelah buku
        if (gap < -MATCH_AFTER || gap > MATCH_BEFORE) continue;
        const hay = `${b.number} ${b.reference ?? ''} ${b.description}`.toUpperCase();
        let hits = 0;
        for (const w of words) if (hay.includes(w)) hits++;
        const score = Math.abs(gap) * 10 - hits * 15;
        if (!best || score < best.score) best = { b, score };
      }
      if (best) {
        used.add(best.b.id);
        await tx.update(bankStatementLines).set({ status: 'MATCHED', journalLineId: best.b.id, matchedBy: 'AUTO' }).where(eq(bankStatementLines.id, l.id));
        matched++;
      }
    }
    return matched;
  }

  private async lockLine(tx: Tx, tenantId: string, id: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bank:${tenantId}`}))`);
    const [l] = await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.id, id), eq(bankStatementLines.tenantId, tenantId)));
    if (!l) throw new NotFoundException('Mutasi tidak ditemukan');
    const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, l.statementId));
    return { l, st };
  }

  /** Kandidat transaksi buku untuk dicocokkan manual (nilai sama didahulukan) */
  async candidates(tenantId: string, lineId: string) {
    const [l] = await this.db.select().from(bankStatementLines).where(and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.tenantId, tenantId)));
    if (!l) throw new NotFoundException('Mutasi tidak ditemukan');
    const [st] = await this.db.select().from(bankStatements).where(eq(bankStatements.id, l.statementId));
    const rows = await this.openBookLines(this.db, tenantId, st.cashAccountId, addDays(l.date, -45), addDays(l.date, 15));
    const amt = D(l.amount);
    return rows
      .map((b) => ({ ...b, amount: D(b.debit).minus(b.credit).toFixed(2), same: D(b.debit).minus(b.credit).equals(amt), gap: Math.abs(diffDays(b.date, l.date)) }))
      .filter((b) => D(b.amount).isPositive() === amt.isPositive())
      .sort((a, b) => Number(b.same) - Number(a.same) || a.gap - b.gap)
      .slice(0, 50);
  }

  async match(user: AuthUser, lineId: string, dto: MatchDto) {
    await this.db.transaction(async (tx) => {
      const { l, st } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status !== 'UNMATCHED') throw new BadRequestException('Mutasi ini sudah diproses');
      const [b] = await tx.select().from(journalLines).where(eq(journalLines.id, dto.journalLineId));
      if (!b || b.accountId !== st.cashAccountId) throw new BadRequestException('Transaksi buku harus di rekening yang sama');
      if (!D(b.debit).minus(b.credit).equals(D(l.amount))) throw new BadRequestException('Nilai transaksi buku berbeda dengan mutasi bank');
      const [taken] = await tx.select({ id: bankStatementLines.id }).from(bankStatementLines).where(eq(bankStatementLines.journalLineId, b.id));
      if (taken) throw new BadRequestException('Transaksi buku itu sudah dicocokkan dengan mutasi lain');
      await tx.update(bankStatementLines).set({ status: 'MATCHED', journalLineId: b.id, matchedBy: 'MANUAL' }).where(eq(bankStatementLines.id, l.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'MATCH', entity: 'BankStatementLine', entityId: l.id, data: { amount: l.amount } });
    });
    return { ok: true };
  }

  async unmatch(user: AuthUser, lineId: string) {
    await this.db.transaction(async (tx) => {
      const { l } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status === 'CREATED') throw new BadRequestException('Mutasi ini sudah dibuatkan jurnal; balik jurnalnya di Jurnal Umum bila salah');
      await tx.update(bankStatementLines).set({ status: 'UNMATCHED', journalLineId: null, matchedBy: null }).where(eq(bankStatementLines.id, l.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UNMATCH', entity: 'BankStatementLine', entityId: l.id, data: { amount: l.amount } });
    });
    return { ok: true };
  }

  async ignore(user: AuthUser, lineId: string, reason: string) {
    const note = reason?.trim() ?? '';
    if (note.length < 5) throw new BadRequestException('Alasan mengabaikan wajib diisi (minimal 5 karakter)');
    await this.db.transaction(async (tx) => {
      const { l } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status !== 'UNMATCHED') throw new BadRequestException('Mutasi ini sudah diproses');
      // pemisahan tugas: uang keluar yang tidak ada di buku hanya boleh diabaikan Pemilik/Admin (bukan staf keuangan)
      if (D(l.amount).isNegative() && !['OWNER', 'ADMIN'].includes(user.role)) throw new ForbiddenException('Uang keluar di bank hanya boleh diabaikan oleh Pemilik atau Admin; catat transaksinya atau minta persetujuan');
      await tx.update(bankStatementLines).set({ status: 'IGNORED', note }).where(eq(bankStatementLines.id, l.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'IGNORE', entity: 'BankStatementLine', entityId: l.id, data: { amount: l.amount, reason: note } });
    });
    return { ok: true };
  }

  /** Mutasi yang belum ada di buku (biaya admin, bunga, transfer masuk tak dikenal) → jurnal langsung */
  /** Jurnal dari satu mutasi bank yang belum tercatat (dipakai manual dan oleh aturan otomatis) */
  private async postFromLine(tx: Tx, user: AuthUser, l: typeof bankStatementLines.$inferSelect, st: typeof bankStatements.$inferSelect, accountId: string, description: string | undefined, matchedBy: string) {
    const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, user.tenantId)));
    if (!acc || !acc.isPostable) throw new BadRequestException('Akun lawan tidak valid');
    if (acc.id === st.cashAccountId) throw new BadRequestException('Akun lawan tidak boleh rekening bank itu sendiri');
    const amt = D(l.amount);
    const abs = amt.abs();
    const j = await this.posting.post(tx, {
      tenantId: user.tenantId,
      date: l.date,
      description: description?.trim() || l.description,
      sourceType: 'BANK',
      sourceId: l.id,
      reference: 'Rekening koran',
      createdById: user.sub,
      lines: amt.gt(0)
        ? [
            { accountId: st.cashAccountId, debit: abs },
            { accountId: acc.id, credit: abs },
          ]
        : [
            { accountId: acc.id, debit: abs },
            { accountId: st.cashAccountId, credit: abs },
          ],
    });
    const bankLine = j.lines.find((x) => x.accountId === st.cashAccountId)!;
    await tx.update(bankStatementLines).set({ status: 'CREATED', journalLineId: bankLine.id, journalId: j.id, matchedBy }).where(eq(bankStatementLines.id, l.id));
    return j;
  }

  async createFromLine(user: AuthUser, lineId: string, dto: CreateFromLineDto) {
    return this.db.transaction(async (tx) => {
      const { l, st } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status !== 'UNMATCHED') throw new BadRequestException('Mutasi ini sudah diproses');
      const j = await this.postFromLine(tx, user, l, st, dto.accountId, dto.description, 'CREATED');
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE_FROM_BANK', entity: 'BankStatementLine', entityId: l.id, data: { amount: l.amount, journal: j.number } });
      return { journalNumber: j.number };
    });
  }

  // ---------- Aturan kategori otomatis ----------
  listRules(tenantId: string) {
    return this.db.select().from(bankRules).where(eq(bankRules.tenantId, tenantId)).orderBy(asc(bankRules.name));
  }

  private async ruleAccount(tenantId: string, accountId: string) {
    const [a] = await this.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)));
    // hanya akun pendapatan / beban: aturan otomatis tidak boleh menyentuh piutang, hutang, persediaan, atau aset
    if (!a || !a.isPostable || !['REVENUE', 'EXPENSE'].includes(a.type) || a.isCashAccount) throw new BadRequestException('Aturan otomatis hanya boleh memakai akun pendapatan atau beban');
  }

  /** Pasang aturan bawaan sesuai jenis usaha (hanya yang akunnya ada; yang sudah ada dilewati) */
  async installDefaultRules(user: AuthUser) {
    const model = await this.settings.businessModel(this.db, user.tenantId);
    const have = new Set((await this.listRules(user.tenantId)).map((r) => r.keyword.toUpperCase()));
    const accs = await this.db.select({ id: accounts.id, code: accounts.code, type: accounts.type, isPostable: accounts.isPostable }).from(accounts).where(eq(accounts.tenantId, user.tenantId));
    let added = 0;
    for (const r of DEFAULT_BANK_RULES[model]) {
      const acc = accs.find((a) => a.code === r.accountCode && a.isPostable && ['REVENUE', 'EXPENSE'].includes(a.type));
      if (!acc || have.has(r.keyword.toUpperCase())) continue;
      await this.db.insert(bankRules).values({ tenantId: user.tenantId, name: r.name, keyword: r.keyword, direction: r.direction, accountId: acc.id, maxAmount: r.maxAmount.toFixed(2), createdById: user.sub });
      added++;
    }
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'INSTALL_DEFAULT_RULES', entity: 'BankRule', entityId: user.tenantId, data: { model, added } });
    return { model, added };
  }

  async saveRule(user: AuthUser, dto: BankRuleDto, id?: string) {
    await this.ruleAccount(user.tenantId, dto.accountId);
    const values = { name: dto.name.trim(), keyword: dto.keyword.trim(), direction: dto.direction, accountId: dto.accountId, maxAmount: money(dto.maxAmount ?? '5000000').toFixed(2), isActive: dto.isActive ?? true };
    if (money(values.maxAmount).lte(0)) throw new BadRequestException('Batas nilai harus lebih dari 0');
    let row;
    if (id) {
      [row] = await this.db.update(bankRules).set(values).where(and(eq(bankRules.id, id), eq(bankRules.tenantId, user.tenantId))).returning();
      if (!row) throw new NotFoundException('Aturan tidak ditemukan');
    } else {
      [row] = await this.db.insert(bankRules).values({ ...values, tenantId: user.tenantId, createdById: user.sub }).returning();
    }
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'BankRule', entityId: row.id, data: { keyword: values.keyword } });
    return row;
  }

  async removeRule(user: AuthUser, id: string) {
    const r = await this.db.delete(bankRules).where(and(eq(bankRules.id, id), eq(bankRules.tenantId, user.tenantId))).returning({ id: bankRules.id });
    if (!r.length) throw new NotFoundException('Aturan tidak ditemukan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'DELETE', entity: 'BankRule', entityId: id });
    return { ok: true };
  }

  /** Mutasi yang belum cocok dibuatkan jurnal otomatis bila ada aturan yang cocok dan nilainya di bawah batas aturan */
  private async applyRules(tx: Tx, user: AuthUser, statementId: string) {
    const rules = await tx.select().from(bankRules).where(and(eq(bankRules.tenantId, user.tenantId), eq(bankRules.isActive, true)));
    if (!rules.length) return 0;
    const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, statementId));
    const accs = new Map((await tx.select().from(accounts).where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, rules.map((r) => r.accountId))))).map((a) => [a.id, a]));
    const lines = await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.statementId, statementId), eq(bankStatementLines.status, 'UNMATCHED'))).orderBy(asc(bankStatementLines.date), asc(bankStatementLines.seq));
    let n = 0;
    for (const l of lines) {
      const amt = D(l.amount);
      const hay = l.description.toUpperCase();
      const rule = rules.find((r) => hay.includes(r.keyword.toUpperCase()) && (r.direction === 'ANY' || (r.direction === 'IN') === amt.gt(0)) && amt.abs().lte(r.maxAmount));
      const acc = rule && accs.get(rule.accountId);
      if (!rule || !acc || !acc.isPostable || !['REVENUE', 'EXPENSE'].includes(acc.type)) continue;
      await this.postFromLine(tx, user, l, st, rule.accountId, undefined, 'RULE');
      n++;
    }
    return n;
  }

  // ---------- Pengesahan rekonsiliasi bulanan ----------
  listSignoffs(tenantId: string, cashAccountId?: string) {
    return this.db.select().from(bankReconciliations).where(and(eq(bankReconciliations.tenantId, tenantId), cashAccountId ? eq(bankReconciliations.cashAccountId, cashAccountId) : undefined)).orderBy(desc(bankReconciliations.period)).limit(60);
  }

  /** Sahkan rekonsiliasi akhir bulan: selisih harus nol dan pengesah bukan orang yang mengimpor rekening koran bulan itu */
  async sign(user: AuthUser, dto: SignReconciliationDto) {
    const [y, m] = dto.period.split('-').map(Number);
    const start = `${dto.period}-01` as DocDate;
    const end = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    if (end >= todayJakarta()) throw new BadRequestException('Bulan itu belum berakhir');
    const rec = await this.reconciliation(user.tenantId, dto.cashAccountId, end);
    if (!rec.reconciled) throw new BadRequestException(`Rekonsiliasi ${dto.period} belum selisih nol (selisih ${rec.difference ?? 'belum ada saldo bank'}). Selesaikan dulu mutasi yang belum cocok.`);
    if (user.role !== 'OWNER') {
      const [mine] = (await this.db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM bank_statements WHERE tenant_id = ${user.tenantId} AND cash_account_id = ${dto.cashAccountId}
          AND imported_by_id = ${user.sub} AND period_from <= ${end} AND period_to >= ${start}`)).rows;
      if (mine.n > 0) throw new ForbiddenException('Rekonsiliasi harus disahkan orang lain dari yang mengimpor rekening koran bulan itu (pemisahan tugas)');
    }
    const ins = await this.db.insert(bankReconciliations).values({ tenantId: user.tenantId, cashAccountId: dto.cashAccountId, period: dto.period, bookBalance: rec.bookBalance, signedById: user.sub, notes: dto.notes }).onConflictDoNothing().returning();
    if (!ins.length) throw new BadRequestException('Periode ini sudah disahkan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'SIGN', entity: 'BankReconciliation', entityId: ins[0].id, data: { period: dto.period, bookBalance: rec.bookBalance } });
    return ins[0];
  }

  // ---------- Temuan kontrol ----------
  async controls(tenantId: string) {
    const today = todayJakarta();
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];
    const items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] }[] = [];
    const add = (key: string, level: 'error' | 'warning' | 'info', title: string, refs: string[], detail: string) => {
      if (refs.length) items.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const rp = (v: string | number) => `Rp${Math.abs(Math.round(Number(v))).toLocaleString('id-ID')}`;
    const outRows = await this.db.execute<{ date: string; amount: string; description: string; name: string }>(sql`
      SELECT l.date::text, l.amount, l.description, a.name FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'UNMATCHED' AND l.amount < 0 AND l.date <= ${addDays(today, -cp.bankOutDays)} ORDER BY l.date`);
    add('BANK_OUT_UNRECORDED', 'error', 'Uang keluar di bank belum ada di buku', outRows.rows.map((r) => `${r.date} ${rp(r.amount)} ${r.description.slice(0, 40)}`), `Bank mencatat uang keluar yang tidak ada transaksinya di SANSU > ${cp.bankOutDays} hari. Cari bukti dan catat, atau selidiki.`);
    const inRows = await this.db.execute<{ date: string; amount: string; description: string }>(sql`
      SELECT l.date::text, l.amount, l.description FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'UNMATCHED' AND l.amount > 0 AND l.date <= ${addDays(today, -cp.bankInDays)} ORDER BY l.date`);
    add('BANK_IN_UNRECORDED', 'warning', 'Uang masuk di bank belum dicatat', inRows.rows.map((r) => `${r.date} ${rp(r.amount)} ${r.description.slice(0, 40)}`), `Uang masuk > ${cp.bankInDays} hari belum dicocokkan ke faktur/penerimaan; bisa jadi penjualan tidak tercatat.`);
    const book = await this.db.execute<{ number: string; credit: string }>(sql`
      SELECT j.number, l.credit FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND a.code IN (SELECT a2.code FROM accounts a2 WHERE a2.tenant_id = ${tenantId} AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a2.id))
        AND l.credit > 0 AND j.date <= ${addDays(today, -cp.bookNotInBankDays)} AND j.source_type <> 'CLOSING'
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = l.account_id AND s.period_to >= j.date)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = l.id) ORDER BY j.date LIMIT 50`);
    add('BOOK_OUT_NOT_IN_BANK', 'warning', `Pembayaran di buku tidak muncul di bank > ${cp.bookNotInBankDays} hari`, book.rows.map((r) => `${r.number} ${rp(r.credit)}`), 'Pembayaran tercatat tetapi tidak pernah keluar dari bank (cek/giro tidak dicairkan, atau pencatatan fiktif).');
    const ign = await this.db.execute<{ date: string; amount: string; note: string | null }>(sql`
      SELECT l.date::text, l.amount, l.note FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'IGNORED' AND l.date >= ${addDays(today, -60)} ORDER BY l.date DESC`);
    add('BANK_IGNORED', 'info', 'Mutasi bank yang diabaikan', ign.rows.map((r) => `${r.date} ${rp(r.amount)}${r.note ? ` — ${r.note}` : ''}`), 'Tinjau alasan mutasi yang diabaikan; ini cara menyembunyikan uang keluar.');
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    if (Number(today.slice(8, 10)) > 10) {
      const unsigned = await this.db.execute<{ name: string }>(sql`
        SELECT a.name FROM accounts a WHERE a.tenant_id = ${tenantId} AND a.is_cash_account
          AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a.id AND s.period_to >= ${`${prev}-01`})
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.cash_account_id = a.id AND r.period = ${prev})`);
      add('RECON_NOT_SIGNED', 'warning', `Rekonsiliasi ${prev} belum disahkan`, unsigned.rows.map((r) => r.name), 'Selesaikan dan sahkan rekonsiliasi bulan lalu (oleh orang selain pengimpor).');
    }
    const rank = { error: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, items };
  }

  async remove(user: AuthUser, id: string, reason: string) {
    const note = reason?.trim() ?? '';
    if (!['OWNER', 'ADMIN'].includes(user.role)) throw new ForbiddenException('Hanya Pemilik atau Admin yang boleh menghapus rekening koran');
    if (note.length < 5) throw new BadRequestException('Alasan penghapusan wajib diisi (minimal 5 karakter)');
    await this.db.transaction(async (tx) => {
      const [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, id), eq(bankStatements.tenantId, user.tenantId)));
      if (!st) throw new NotFoundException('Rekening koran tidak ditemukan');
      // Jurnal yang dibuat dari mutasi tetap ada (transaksinya nyata); hanya pencocokannya yang dilepas
      await tx.delete(bankStatements).where(eq(bankStatements.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'DELETE', entity: 'BankStatement', entityId: id, data: { file: st.fileName, from: st.periodFrom, to: st.periodTo, reason: note } });
    });
    return { ok: true };
  }

  /**
   * Laporan rekonsiliasi per tanggal:
   *  saldo menurut bank (rekening koran) ± setoran dalam perjalanan / pembayaran yang belum dicairkan = saldo menurut buku
   */
  async reconciliation(tenantId: string, cashAccountId: string, asOf: DocDate) {
    const acc = await this.bankAccount(this.db, tenantId, cashAccountId);
    const [bal] = (
      await this.db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${cashAccountId} AND j.date <= ${asOf}`)
    ).rows;
    const book = D(bal.v);
    const [lastLine] = await this.db
      .select({ balance: bankStatementLines.balance, date: bankStatementLines.date })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(and(eq(bankStatements.cashAccountId, cashAccountId), sql`${bankStatementLines.date} <= ${asOf}`, sql`${bankStatementLines.balance} IS NOT NULL`))
      .orderBy(desc(bankStatementLines.date), desc(bankStatementLines.seq))
      .limit(1);
    const [firstStmt] = await this.db
      .select({ from: bankStatements.periodFrom })
      .from(bankStatements)
      .where(eq(bankStatements.cashAccountId, cashAccountId))
      .orderBy(asc(bankStatements.periodFrom))
      .limit(1);
    // Transaksi buku sejak rekening koran pertama yang belum muncul di bank
    const outstanding = firstStmt ? await this.openBookLines(this.db, tenantId, cashAccountId, firstStmt.from, asOf) : [];
    const deposits = outstanding.filter((b) => D(b.debit).gt(0) && b.source_type !== 'OPENING');
    const payments = outstanding.filter((b) => D(b.credit).gt(0));
    const unrecorded = await this.db.execute<{ id: string; date: string; description: string; amount: string }>(sql`
      SELECT l.id, l.date, l.description, l.amount FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = ${cashAccountId} AND l.status = 'UNMATCHED' AND l.date <= ${asOf}
      ORDER BY l.date`);
    const depTotal = deposits.reduce<Dec>((a, b) => a.plus(b.debit), ZERO);
    const payTotal = payments.reduce<Dec>((a, b) => a.plus(b.credit), ZERO);
    const unrecTotal = unrecorded.rows.reduce<Dec>((a, b) => a.plus(b.amount), ZERO);
    const bank = lastLine ? D(lastLine.balance) : null;
    const adjustedBank = bank ? bank.plus(depTotal).minus(payTotal) : null;
    const adjustedBook = book.plus(unrecTotal);
    return {
      account: { id: acc.id, code: acc.code, name: acc.name },
      asOf,
      bankBalance: bank?.toFixed(2) ?? null,
      bankBalanceDate: lastLine?.date ?? null,
      bookBalance: book.toFixed(2),
      depositsInTransit: deposits.map((b) => ({ date: b.date, number: b.number, description: b.description, amount: D(b.debit).toFixed(2) })),
      outstandingPayments: payments.map((b) => ({ date: b.date, number: b.number, description: b.description, amount: D(b.credit).toFixed(2) })),
      unrecorded: unrecorded.rows.map((r) => ({ ...r, amount: D(r.amount).toFixed(2) })),
      totals: { depositsInTransit: depTotal.toFixed(2), outstandingPayments: payTotal.toFixed(2), unrecorded: unrecTotal.toFixed(2) },
      adjustedBank: adjustedBank?.toFixed(2) ?? null,
      adjustedBook: adjustedBook.toFixed(2),
      difference: adjustedBank ? adjustedBank.minus(adjustedBook).toFixed(2) : null,
      reconciled: adjustedBank ? adjustedBank.equals(adjustedBook) : false,
    };
  }

  /** Ringkasan per rekening: tanggal mutasi terakhir yang diimpor & jumlah yang belum cocok (untuk cek kesehatan / dashboard) */
  async status(tenantId: string) {
    const r = await this.db.execute<{ id: string; code: string; name: string; last_date: string | null; unmatched: number }>(sql`
      SELECT a.id, a.code, a.name, MAX(l.date) AS last_date, COUNT(l.id) FILTER (WHERE l.status = 'UNMATCHED')::int AS unmatched
      FROM accounts a
      LEFT JOIN bank_statements s ON s.cash_account_id = a.id
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
      GROUP BY a.id ORDER BY a.code`);
    return r.rows.map((x) => ({ ...x, stale: !x.last_date || diffDays(x.last_date, todayJakarta()) > 45 }));
  }
}

// ---------- Controller ----------
@ApiTags('Rekonsiliasi bank')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('bank')
export class BankController {
  constructor(private readonly svc: BankService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements')
  list(@CurrentUser() u: AuthUser, @Query('cashAccountId') cashAccountId?: string) {
    return this.svc.list(u.tenantId, cashAccountId && /^[0-9a-f-]{36}$/.test(cashAccountId) ? cashAccountId : undefined);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('statements')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportStatementDto) {
    return this.svc.import(u, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('statements/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('statements/:id/auto-match')
  autoMatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.autoMatch(u, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Delete('statements/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('reason') reason?: string) {
    return this.svc.remove(u, id, reason ?? '');
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('lines/:id/candidates')
  candidates(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidates(u.tenantId, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/match')
  match(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchDto) {
    return this.svc.match(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/unmatch')
  unmatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unmatch(u, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/ignore')
  ignore(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.ignore(u, id, dto.reason);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('lines/:id/create')
  createFromLine(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFromLineDto) {
    return this.svc.createFromLine(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('reconciliation')
  reconciliation(@CurrentUser() u: AuthUser, @Query('cashAccountId', ParseUUIDPipe) cashAccountId: string, @Query('asOf') asOf?: string) {
    return this.svc.reconciliation(u.tenantId, cashAccountId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : todayJakarta());
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('rules')
  rules(@CurrentUser() u: AuthUser) {
    return this.svc.listRules(u.tenantId);
  }
  @Roles('ADMIN')
  @Post('rules/defaults')
  installDefaults(@CurrentUser() u: AuthUser) {
    return this.svc.installDefaultRules(u);
  }
  @Roles('ADMIN')
  @Post('rules')
  createRule(@CurrentUser() u: AuthUser, @Body() dto: BankRuleDto) {
    return this.svc.saveRule(u, dto);
  }
  @Roles('ADMIN')
  @Put('rules/:id')
  updateRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BankRuleDto) {
    return this.svc.saveRule(u, dto, id);
  }
  @Roles('ADMIN')
  @Delete('rules/:id')
  deleteRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeRule(u, id);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('signoffs')
  signoffs(@CurrentUser() u: AuthUser, @Query('cashAccountId') cashAccountId?: string) {
    return this.svc.listSignoffs(u.tenantId, cashAccountId && /^[0-9a-f-]{36}$/.test(cashAccountId) ? cashAccountId : undefined);
  }
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('signoffs')
  sign(@CurrentUser() u: AuthUser, @Body() dto: SignReconciliationDto) {
    return this.svc.sign(u, dto);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
