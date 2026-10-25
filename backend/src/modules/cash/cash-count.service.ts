import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { CASH_DENOMINATIONS, type CashCountSettings } from '@sansu/shared';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { DocDate, toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, cashCounts, journalEntries, users } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { CashCountSettingsDto, CreateCashCountDto, UpdateCashCountDto } from './cash-count.dto';
import { insertOne, patchById } from '../../db/owned';

const DEFAULTS: CashCountSettings = { approvalThreshold: 50_000 };

const DENOM = new Map<string, number>(CASH_DENOMINATIONS.map((d) => [d.key, d.value]));

/** Akun kas fisik (bukan rekening bank) — yang bisa diopname */
const KAS_FILTER = sql`a.is_cash_account = true AND a.is_postable = true AND a.is_active = true
  AND COALESCE(a.system_key, '') <> 'BANK'
  AND a.name !~* '(bank|rekening|giro|tabungan|deposito|qris|wallet|virtual)'
  AND NOT EXISTS (SELECT 1 FROM bank_statements b WHERE b.cash_account_id = a.id)`;

@Injectable()
export class CashCountService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
  ) {}

  getSettings(tenantId: string, db: DbOrTx = this.db) {
    return this.settings.section(db, tenantId, 'cashCount', DEFAULTS);
  }
  saveSettings(tenantId: string, dto: CashCountSettingsDto) {
    return this.settings.saveSection(this.db, tenantId, 'cashCount', DEFAULTS, {
      approvalThreshold: dto.approvalThreshold,
    });
  }

  /** Akun kas yang bisa diopname + saldo hari ini + opname terakhir */
  async kasAccounts(tenantId: string) {
    const r = await this.db.execute<{
      id: string;
      code: string;
      name: string;
      balance: string;
      lastCount: string | null;
    }>(sql`
      SELECT a.id, a.code, a.name,
             COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l WHERE l.account_id = a.id), 0)::numeric(18,2)::text AS balance,
             (SELECT MAX(c.date)::text FROM cash_counts c WHERE c.account_id = a.id AND c.status = 'POSTED') AS "lastCount"
      FROM accounts a WHERE a.tenant_id = ${tenantId} AND ${KAS_FILTER}
      ORDER BY a.code`);
    return r.rows;
  }

  private async bookBalance(db: DbOrTx, tenantId: string, accountId: string, date: DocDate): Promise<Dec> {
    const r = await db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date <= ${date}`);
    return money(r.rows[0]?.v ?? 0);
  }

  /** Hitung total fisik, pos rekonsiliasi, dan selisih */
  private totals(denoms: Record<string, number>, items: { type: 'ADD' | 'LESS'; amount: string }[], book: Dec) {
    let counted: Dec = ZERO;
    for (const [k, n] of Object.entries(denoms)) counted = counted.plus(D(DENOM.get(k) ?? 0).times(n));
    const itemsTotal = items.reduce<Dec>(
      (s, i) => (i.type === 'ADD' ? s.plus(money(i.amount)) : s.minus(money(i.amount))),
      ZERO,
    );
    return { counted: money(counted), itemsTotal, difference: money(counted).plus(itemsTotal).minus(book) };
  }

  private cleanDenoms(input: Record<string, number>) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!DENOM.has(k)) throw new BadRequestException(`Pecahan tidak dikenal: ${k}`);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000)
        throw new BadRequestException('Jumlah lembar/keping harus bilangan bulat 0 atau lebih');
      if (n > 0) out[k] = n;
    }
    return out;
  }

  async list(tenantId: string, accountId?: string) {
    const rows = await this.db
      .select({ c: cashCounts, code: accounts.code, name: accounts.name })
      .from(cashCounts)
      .innerJoin(accounts, eq(accounts.id, cashCounts.accountId))
      .where(and(eq(cashCounts.tenantId, tenantId), accountId ? eq(cashCounts.accountId, accountId) : undefined))
      .orderBy(desc(cashCounts.date), desc(cashCounts.number))
      .limit(300);
    return rows.map((r) => ({ ...r.c, account: { code: r.code, name: r.name } }));
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [r] = await db
      .select({ c: cashCounts, code: accounts.code, name: accounts.name })
      .from(cashCounts)
      .innerJoin(accounts, eq(accounts.id, cashCounts.accountId))
      .where(and(eq(cashCounts.id, id), eq(cashCounts.tenantId, tenantId)));
    if (!r) throw new NotFoundException('Opname kas tidak ditemukan');
    const ids = [r.c.createdById, r.c.approvedById].filter((x): x is string => !!x);
    const names = ids.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
      : [];
    const nm = (x: string | null) => names.find((n) => n.id === x)?.name ?? null;
    const [j] = r.c.journalId
      ? await db
          .select({ number: journalEntries.number })
          .from(journalEntries)
          .where(eq(journalEntries.id, r.c.journalId))
      : [];
    // selama masih dihitung, saldo buku ditampilkan terkini (bisa berubah bila ada transaksi kas susulan)
    let c = r.c;
    if (c.status === 'DRAFT') {
      const book = await this.bookBalance(db, tenantId, c.accountId, c.date);
      const t = this.totals(c.denominations, c.items, book);
      c = {
        ...c,
        bookBalance: book.toFixed(2),
        countedTotal: t.counted.toFixed(2),
        itemsTotal: t.itemsTotal.toFixed(2),
        difference: t.difference.toFixed(2),
      };
    }
    return {
      ...c,
      account: { code: r.code, name: r.name },
      createdBy: nm(c.createdById),
      approvedBy: nm(c.approvedById),
      journalNumber: j?.number ?? null,
    };
  }

  async create(u: AuthUser, dto: CreateCashCountDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const acc = await tx.execute<{ id: string }>(
        sql`SELECT a.id FROM accounts a WHERE a.id = ${dto.accountId} AND a.tenant_id = ${u.tenantId} AND ${KAS_FILTER}`,
      );
      if (!acc.rows.length)
        throw new BadRequestException('Pilih akun kas (opname tidak untuk rekening bank — gunakan rekonsiliasi bank)');
      const open = await tx
        .select({ number: cashCounts.number })
        .from(cashCounts)
        .where(and(eq(cashCounts.accountId, dto.accountId), inArray(cashCounts.status, ['DRAFT', 'WAITING_APPROVAL'])));
      if (open.length)
        throw new BadRequestException(`Masih ada opname ${open[0].number} untuk kas ini yang belum selesai`);
      const [last] = await tx
        .select({ date: cashCounts.date, number: cashCounts.number })
        .from(cashCounts)
        .where(and(eq(cashCounts.accountId, dto.accountId), eq(cashCounts.status, 'POSTED')))
        .orderBy(desc(cashCounts.date))
        .limit(1);
      if (last && date <= last.date)
        throw new BadRequestException(`Tanggal harus sesudah opname terakhir (${last.number}, ${last.date})`);
      const book = await this.bookBalance(tx, u.tenantId, dto.accountId, date);
      const number = await this.seq.next(tx, u.tenantId, 'CASH_COUNT', date);
      const c = await insertOne(tx, cashCounts, {
          tenantId: u.tenantId,
          number,
          date,
          accountId: dto.accountId,
          bookBalance: book.toFixed(2),
          difference: book.negated().toFixed(2),
          custodianName: dto.custodianName ?? null,
          createdById: u.sub,
        });
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CREATE',
        entity: 'CashCount',
        entityId: c.id,
        data: { number, date },
      });
      return this.get(u.tenantId, c.id, tx);
    });
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const r = await tx.execute<{ id: string }>(
      sql`SELECT id FROM cash_counts WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
    if (!r.rows.length) throw new NotFoundException('Opname kas tidak ditemukan');
    const [c] = await tx.select().from(cashCounts).where(eq(cashCounts.id, id));
    return c;
  }

  async update(u: AuthUser, id: string, dto: UpdateCashCountDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      if (c.status !== 'DRAFT') throw new BadRequestException('Opname ini tidak bisa diubah lagi');
      const denoms = dto.denominations ? this.cleanDenoms(dto.denominations) : c.denominations;
      const items = dto.items
        ? dto.items.map((i) => ({
            type: i.type,
            description: i.description.trim(),
            amount: money(i.amount).toFixed(2),
          }))
        : c.items;
      if (items.some((i) => D(i.amount).lte(0)))
        throw new BadRequestException('Nilai pos rekonsiliasi harus lebih dari nol');
      const book = await this.bookBalance(tx, u.tenantId, c.accountId, c.date);
      const t = this.totals(denoms, items, book);
      await patchById(tx, cashCounts, id, {
          denominations: denoms,
          items,
          custodianName: dto.custodianName ?? c.custodianName,
          notes: dto.notes ?? c.notes,
          reason: dto.reason ?? c.reason,
          bookBalance: book.toFixed(2),
          countedTotal: t.counted.toFixed(2),
          itemsTotal: t.itemsTotal.toFixed(2),
          difference: t.difference.toFixed(2),
        });
      return this.get(u.tenantId, id, tx);
    });
  }

  /** Bukukan selisih (jika ada) dan tandai selesai */
  private async post(tx: Tx, u: AuthUser, c: typeof cashCounts.$inferSelect, diff: Dec, approver?: string) {
    let journalId: string | null = null;
    if (!diff.isZero()) {
      const [acc] = await tx.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, c.accountId));
      const j = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: c.date,
        description:
          `Selisih opname kas ${acc?.name ?? ''} ${c.number} (${diff.isNegative() ? 'kurang' : 'lebih'})${c.reason ? ' — ' + c.reason : ''}`.slice(
            0,
            250,
          ),
        sourceType: 'CASH_COUNT',
        sourceId: c.id,
        reference: c.number,
        createdById: u.sub,
        lines: diff.isNegative()
          ? [
              { key: SYS.CASH_DIFF, debit: diff.abs() },
              { accountId: c.accountId, credit: diff.abs() },
            ]
          : [
              { accountId: c.accountId, debit: diff },
              { key: SYS.CASH_DIFF, credit: diff },
            ],
      });
      journalId = j.id;
    }
    await patchById(tx, cashCounts, c.id, { status: 'POSTED', journalId, postedAt: new Date(), approvedById: approver ?? null, rejectReason: null });
  }

  /** Selesaikan: selisih kecil langsung dibukukan, selisih besar menunggu Pemilik */
  async finish(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      if (c.status !== 'DRAFT') throw new BadRequestException('Opname ini sudah diselesaikan');
      if (!Object.keys(c.denominations).length) throw new BadRequestException('Isi dulu hasil hitung uang per pecahan');
      const book = await this.bookBalance(tx, u.tenantId, c.accountId, c.date);
      const t = this.totals(c.denominations, c.items, book);
      if (!t.difference.isZero() && !c.reason?.trim())
        throw new BadRequestException('Ada selisih — isi penjelasan selisih dulu');
      await patchById(tx, cashCounts, id, {
          bookBalance: book.toFixed(2),
          countedTotal: t.counted.toFixed(2),
          itemsTotal: t.itemsTotal.toFixed(2),
          difference: t.difference.toFixed(2),
        });
      const { approvalThreshold } = await this.getSettings(u.tenantId, tx);
      const needsApproval = t.difference.abs().gt(approvalThreshold) && u.role !== 'OWNER';
      if (needsApproval) {
        await patchById(tx, cashCounts, id, { status: 'WAITING_APPROVAL', rejectReason: null });
        // Hanya Pemilik yang menyetujui selisih besar: beri tahu langsung, jangan menunggu dibuka sendiri
        void this.approvals.notifyRoles(u.tenantId, { roles: ['OWNER'], excludeUserId: u.sub, title: `Opname kas ${c.number} selisih Rp${Math.abs(t.difference.toNumber()).toLocaleString('id-ID')} menunggu persetujuan Anda`, lines: [c.reason ?? ''], path: '/cash/counts' });
      } else {
        await this.post(tx, u, c, t.difference, u.role === 'OWNER' ? u.sub : undefined);
      }
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: needsApproval ? 'SUBMIT' : 'POST',
        entity: 'CashCount',
        entityId: id,
        data: { number: c.number, difference: t.difference.toFixed(2) },
      });
      return this.get(u.tenantId, id, tx);
    });
  }

  async approve(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      if (c.status !== 'WAITING_APPROVAL')
        throw new BadRequestException('Opname ini tidak sedang menunggu persetujuan');
      const book = await this.bookBalance(tx, u.tenantId, c.accountId, c.date);
      if (!book.eq(c.bookBalance)) {
        throw new BadRequestException(
          'Saldo buku kas berubah sejak opname diajukan (ada transaksi susulan). Tolak agar opname dihitung ulang.',
        );
      }
      await this.post(tx, u, c, D(c.difference), u.sub);
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'APPROVE',
        entity: 'CashCount',
        entityId: id,
        data: { number: c.number, difference: c.difference },
      });
      return this.get(u.tenantId, id, tx);
    });
  }

  async reject(u: AuthUser, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      if (c.status !== 'WAITING_APPROVAL')
        throw new BadRequestException('Opname ini tidak sedang menunggu persetujuan');
      await patchById(tx, cashCounts, id, { status: 'DRAFT', rejectReason: reason });
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'REJECT',
        entity: 'CashCount',
        entityId: id,
        data: { number: c.number, reason },
      });
      return this.get(u.tenantId, id, tx);
    });
  }

  /** Batalkan: draft/menunggu cukup dibatalkan; yang sudah selesai (khusus Pemilik) jurnal selisihnya dibalik & kunci dibuka */
  async cancel(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      if (c.status === 'CANCELLED') throw new BadRequestException('Opname ini sudah dibatalkan');
      if (c.status === 'POSTED') {
        if (u.role !== 'OWNER')
          throw new ForbiddenException('Hanya Pemilik yang bisa membatalkan opname yang sudah selesai');
        const [later] = await tx
          .select({ number: cashCounts.number })
          .from(cashCounts)
          .where(
            and(
              eq(cashCounts.accountId, c.accountId),
              eq(cashCounts.status, 'POSTED'),
              sql`${cashCounts.date} > ${c.date}`,
            ),
          )
          .limit(1);
        if (later) throw new BadRequestException(`Batalkan dulu opname yang lebih baru (${later.number})`);
        if (c.journalId) await this.posting.reverse(tx, u.tenantId, c.journalId, c.date, u.sub, true);
      }
      await patchById(tx, cashCounts, id, { status: 'CANCELLED' });
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CANCEL',
        entity: 'CashCount',
        entityId: id,
        data: { number: c.number },
      });
      return { ok: true };
    });
  }
}
