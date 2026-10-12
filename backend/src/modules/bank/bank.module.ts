/**
 * Rekonsiliasi bank: impor mutasi rekening (CSV/Excel dari internet banking), cocokkan otomatis
 * dengan transaksi di buku, buat jurnal untuk mutasi yang belum tercatat (biaya admin, bunga, dll.)
 * dan susun laporan rekonsiliasi saldo bank vs saldo buku.
 */
import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, diffDays, DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, bankStatementLines, bankStatements, journalLines } from '../../db/schema';
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
    const id = await this.db.transaction(async (tx) => {
      await this.bankAccount(tx, user.tenantId, dto.cashAccountId);
      const rows = dto.lines.map((l, i) => ({ ...l, date: toDocDate(l.date), amount: money(l.amount), seq: i + 1 })).filter((l) => !l.amount.isZero());
      if (!rows.length) throw new BadRequestException('Tidak ada mutasi bernilai di file');
      const dates = rows.map((r) => r.date).sort();
      // Tolak impor ganda: mutasi yang sama persis sudah pernah diimpor
      const dup = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
        WHERE s.tenant_id = ${user.tenantId} AND s.cash_account_id = ${dto.cashAccountId}
          AND l.date BETWEEN ${dates[0]} AND ${dates[dates.length - 1]}`);
      if (dup.rows[0].n >= rows.length) {
        throw new BadRequestException(`Mutasi ${dates[0]} s/d ${dates[dates.length - 1]} untuk rekening ini sudah pernah diimpor`);
      }
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
        })
        .returning();
      await tx.insert(bankStatementLines).values(
        rows.map((r) => ({
          tenantId: user.tenantId,
          statementId: st.id,
          seq: r.seq,
          date: r.date,
          description: r.description.trim(),
          amount: r.amount.toFixed(2),
          balance: r.balance ? money(r.balance).toFixed(2) : null,
        })),
      );
      await this.autoMatchTx(tx, user.tenantId, st.id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'IMPORT', entity: 'BankStatement', entityId: st.id, data: { lines: rows.length } });
      return st.id;
    });
    return this.get(user.tenantId, id);
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
    });
    return { ok: true };
  }

  async unmatch(user: AuthUser, lineId: string) {
    await this.db.transaction(async (tx) => {
      const { l } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status === 'CREATED') throw new BadRequestException('Mutasi ini sudah dibuatkan jurnal; balik jurnalnya di Jurnal Umum bila salah');
      await tx.update(bankStatementLines).set({ status: 'UNMATCHED', journalLineId: null, matchedBy: null }).where(eq(bankStatementLines.id, l.id));
    });
    return { ok: true };
  }

  async ignore(user: AuthUser, lineId: string) {
    await this.db.transaction(async (tx) => {
      const { l } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status !== 'UNMATCHED') throw new BadRequestException('Mutasi ini sudah diproses');
      await tx.update(bankStatementLines).set({ status: 'IGNORED' }).where(eq(bankStatementLines.id, l.id));
    });
    return { ok: true };
  }

  /** Mutasi yang belum ada di buku (biaya admin, bunga, transfer masuk tak dikenal) → jurnal langsung */
  async createFromLine(user: AuthUser, lineId: string, dto: CreateFromLineDto) {
    return this.db.transaction(async (tx) => {
      const { l, st } = await this.lockLine(tx, user.tenantId, lineId);
      if (l.status !== 'UNMATCHED') throw new BadRequestException('Mutasi ini sudah diproses');
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, dto.accountId), eq(accounts.tenantId, user.tenantId)));
      if (!acc || !acc.isPostable) throw new BadRequestException('Akun lawan tidak valid');
      if (acc.id === st.cashAccountId) throw new BadRequestException('Akun lawan tidak boleh rekening bank itu sendiri');
      const amt = D(l.amount);
      const abs = amt.abs();
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: l.date,
        description: dto.description?.trim() || l.description,
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
      await tx.update(bankStatementLines).set({ status: 'CREATED', journalLineId: bankLine.id, journalId: j.id, matchedBy: 'CREATED' }).where(eq(bankStatementLines.id, l.id));
      return { journalNumber: j.number };
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, id), eq(bankStatements.tenantId, user.tenantId)));
      if (!st) throw new NotFoundException('Rekening koran tidak ditemukan');
      // Jurnal yang dibuat dari mutasi tetap ada (transaksinya nyata); hanya pencocokannya yang dilepas
      await tx.delete(bankStatements).where(eq(bankStatements.id, id));
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
@Roles('ADMIN', 'FINANCE')
@Controller('bank')
export class BankController {
  constructor(private readonly svc: BankService) {}

  @Get('statements')
  list(@CurrentUser() u: AuthUser, @Query('cashAccountId') cashAccountId?: string) {
    return this.svc.list(u.tenantId, cashAccountId && /^[0-9a-f-]{36}$/.test(cashAccountId) ? cashAccountId : undefined);
  }
  @Post('statements')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportStatementDto) {
    return this.svc.import(u, dto);
  }
  @Get('statements/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Post('statements/:id/auto-match')
  autoMatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.autoMatch(u, id);
  }
  @Delete('statements/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
  @Get('lines/:id/candidates')
  candidates(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidates(u.tenantId, id);
  }
  @Post('lines/:id/match')
  match(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchDto) {
    return this.svc.match(u, id, dto);
  }
  @Post('lines/:id/unmatch')
  unmatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unmatch(u, id);
  }
  @Post('lines/:id/ignore')
  ignore(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ignore(u, id);
  }
  @Post('lines/:id/create')
  createFromLine(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFromLineDto) {
    return this.svc.createFromLine(u, id, dto);
  }
  @Get('reconciliation')
  reconciliation(@CurrentUser() u: AuthUser, @Query('cashAccountId', ParseUUIDPipe) cashAccountId: string, @Query('asOf') asOf?: string) {
    return this.svc.reconciliation(u.tenantId, cashAccountId, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : todayJakarta());
  }
  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u.tenantId);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
