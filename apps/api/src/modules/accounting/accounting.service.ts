import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { REPORT_GROUPS } from '@sansu/shared';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { PeriodService } from '../../common/period/period.service';
import { addDays, DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, DecValue, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AccountType, accounts, journalEntries, journalLines, recurringJournals, tenants } from '../../db/schema';
import { guessReportGroup, SYS } from './default-coa';
import {
  CloseYearDto,
  CreateAccountDto,
  CreateJournalDto,
  CreateRecurringDto,
  JournalQueryDto,
  OpeningBalanceDto,
  UpdateAccountDto,
  UpdateRecurringDto,
} from './dto/accounting.dto';
import { PostingService } from './posting.service';

interface BalanceRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: Dec;
  credit: Dec;
  balance: Dec;
}

const DEBIT_NORMAL: AccountType[] = ['ASSET', 'EXPENSE'];
const normal = (type: AccountType, debit: DecValue, credit: DecValue) =>
  DEBIT_NORMAL.includes(type) ? D(debit).minus(credit) : D(credit).minus(debit);

type CashCategory = 'operating' | 'investing' | 'financing';

/** Tanggal berikutnya untuk jurnal berulang; akhir bulan tetap di akhir bulan */
export function nextOccurrence(date: DocDate, frequency: string): DocDate {
  const months = frequency === 'YEARLY' ? 12 : frequency === 'QUARTERLY' ? 3 : 1;
  const [y, m, d] = date.split('-').map(Number);
  const isEom = new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(isEom ? last : Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

@Injectable()
export class AccountingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('JurnalBerulang');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly period: PeriodService,
    private readonly audit: AuditService,
  ) {}

  /** Jurnal berulang dijalankan otomatis setiap jam untuk semua perusahaan */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runAllDue().catch((e) => this.logger.error(e)), 60 * 60 * 1000);
    this.timer.unref();
    setTimeout(() => void this.runAllDue().catch((e) => this.logger.error(e)), 15_000).unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Bagan akun ----------

  listAccounts(tenantId: string) {
    return this.db.select().from(accounts).where(eq(accounts.tenantId, tenantId)).orderBy(asc(accounts.code));
  }

  async createAccount(tenantId: string, dto: CreateAccountDto) {
    if (dto.parentId) {
      const [parent] = await this.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, dto.parentId), eq(accounts.tenantId, tenantId)));
      if (!parent) throw new BadRequestException('Akun induk tidak ditemukan');
      if (parent.type !== dto.type) throw new BadRequestException('Tipe akun harus sama dengan akun induk');
    }
    if (dto.isCashAccount && dto.type !== 'ASSET') throw new BadRequestException('Akun kas/bank harus bertipe Aset');
    if (dto.reportGroup && REPORT_GROUPS[dto.reportGroup].type !== dto.type) {
      throw new BadRequestException('Kelompok laporan tidak sesuai dengan tipe akun');
    }
    const reportGroup = dto.isCashAccount ? 'CASH_EQUIVALENT' : (dto.reportGroup ?? guessReportGroup(dto.code, dto.type));
    const [row] = await this.db.insert(accounts).values({ ...dto, reportGroup, tenantId }).returning();
    return row;
  }

  async updateAccount(tenantId: string, id: string, dto: UpdateAccountDto) {
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    if (!acc) throw new NotFoundException('Akun tidak ditemukan');
    if (dto.reportGroup && REPORT_GROUPS[dto.reportGroup].type !== acc.type) {
      throw new BadRequestException('Kelompok laporan tidak sesuai dengan tipe akun');
    }
    if (acc.isCashAccount && dto.reportGroup && dto.reportGroup !== 'CASH_EQUIVALENT') {
      throw new BadRequestException('Akun kas/bank harus di kelompok Kas dan setara kas');
    }
    if (dto.isActive === false && acc.systemKey) throw new BadRequestException('Akun sistem tidak bisa dinonaktifkan');
    const [row] = await this.db.update(accounts).set(dto).where(eq(accounts.id, id)).returning();
    return row;
  }

  /** Hapus akun yang belum pernah dipakai */
  async deleteAccount(tenantId: string, id: string) {
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    if (!acc) throw new NotFoundException('Akun tidak ditemukan');
    if (acc.systemKey) throw new BadRequestException('Akun sistem tidak bisa dihapus');
    const [used] = await this.db.select({ id: journalLines.id }).from(journalLines).where(eq(journalLines.accountId, id)).limit(1);
    if (used) throw new BadRequestException('Akun sudah dipakai di jurnal; nonaktifkan saja');
    const [child] = await this.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, id)).limit(1);
    if (child) throw new BadRequestException('Akun masih memiliki sub-akun');
    await this.db.delete(accounts).where(eq(accounts.id, id));
    return { ok: true };
  }

  // ---------- Jurnal ----------

  listJournals(tenantId: string, q: JournalQueryDto) {
    const term = q.q?.trim();
    return this.db.query.journalEntries.findMany({
      where: and(
        eq(journalEntries.tenantId, tenantId),
        q.from ? gte(journalEntries.date, toDocDate(q.from)) : undefined,
        q.to ? lte(journalEntries.date, toDocDate(q.to)) : undefined,
        q.source ? inArray(journalEntries.sourceType, q.source.split(',').map((x) => x.trim())) : undefined,
        term
          ? or(ilike(journalEntries.number, `%${term}%`), ilike(journalEntries.description, `%${term}%`), ilike(journalEntries.reference, `%${term}%`))
          : undefined,
      ),
      with: { lines: { with: { account: { columns: { code: true, name: true } } } } },
      orderBy: [desc(journalEntries.date), desc(journalEntries.number)],
      limit: 300,
    });
  }

  async getJournal(tenantId: string, id: string) {
    const j = await this.db.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.tenantId, tenantId)),
      with: { lines: { with: { account: { columns: { code: true, name: true } } } } },
    });
    if (!j) throw new NotFoundException('Jurnal tidak ditemukan');
    return j;
  }

  createManualJournal(user: AuthUser, dto: CreateJournalDto) {
    return this.db.transaction((tx) =>
      this.posting.post(tx, {
        tenantId: user.tenantId,
        date: toDocDate(dto.date),
        description: dto.description,
        sourceType: dto.adjustment ? 'ADJUSTMENT' : 'MANUAL',
        reference: dto.reference,
        createdById: user.sub,
        lines: dto.lines,
      }),
    );
  }

  reverseJournal(user: AuthUser, id: string, date?: string) {
    return this.db.transaction((tx) => this.posting.reverse(tx, user.tenantId, id, toDocDate(date), user.sub));
  }

  /**
   * Saldo awal akun saat mulai memakai SANSU. Selisih debit-kredit otomatis
   * diseimbangkan ke Ekuitas Saldo Awal. Persediaan diisi lewat Penyesuaian Stok (agar kartu stok ikut).
   */
  async openingBalance(user: AuthUser, dto: OpeningBalanceDto, outerTx?: Tx) {
    const date = toDocDate(dto.date);
    const run = async (tx: Tx) => {
      const ids = dto.lines.map((l) => l.accountId);
      const accs = await tx.select().from(accounts).where(eq(accounts.tenantId, user.tenantId));
      const byId = new Map(accs.map((a) => [a.id, a]));
      for (const id of ids) {
        const a = byId.get(id);
        if (!a) throw new BadRequestException('Akun tidak ditemukan');
        if (a.systemKey === SYS.INVENTORY) {
          throw new BadRequestException('Saldo awal persediaan diisi lewat Inventori → Penyesuaian stok (alasan: Saldo awal)');
        }
        // akun kontrol harus punya rincian per faktur, kalau tidak buku besar dan daftar umur tidak sama
        if (a.systemKey === SYS.AR) throw new BadRequestException('Saldo awal piutang usaha diisi per faktur lewat Pengaturan → Impor data → Piutang awal');
        if (a.systemKey === SYS.AP) throw new BadRequestException('Saldo awal utang usaha diisi per faktur lewat Pengaturan → Impor data → Utang awal');
        if (a.systemKey === SYS.OPENING_EQUITY) throw new BadRequestException('Ekuitas Saldo Awal diisi otomatis sebagai penyeimbang');
      }
      const totalD = dto.lines.reduce<Dec>((s, l) => s.plus(money(D(l.debit))), ZERO);
      const totalC = dto.lines.reduce<Dec>((s, l) => s.plus(money(D(l.credit))), ZERO);
      const diff = totalD.minus(totalC);
      return this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: 'Saldo awal akun',
        sourceType: 'OPENING',
        createdById: user.sub,
        lines: [
          ...dto.lines,
          { key: SYS.OPENING_EQUITY, credit: diff.gt(0) ? diff : 0, debit: diff.lt(0) ? diff.abs() : 0 },
        ],
      });
    };
    return outerTx ? run(outerTx) : this.db.transaction(run);
  }

  /**
   * Ringkasan kesiapan saldo awal: berapa yang sudah diisi per kelompok, penyeimbang ekuitas, dan peringatan.
   * Sumber: jurnal saldo awal (OPENING) dan penyesuaian stok bersandi OPENING.
   */
  async openingStatus(tenantId: string) {
    const isOpening = sql`(j.source_type = 'OPENING' OR (j.source_type = 'STOCK_ADJUSTMENT' AND j.description LIKE '%(OPENING)%'))`;
    const rows = await this.db.execute<{ component: string; amount: string; accounts: number }>(sql`
      SELECT CASE
          WHEN a.system_key = 'OPENING_EQUITY' THEN 'balancing'
          WHEN a.is_cash_account THEN 'cash'
          WHEN a.system_key = 'AR' THEN 'receivables'
          WHEN a.system_key = 'AP' THEN 'payables'
          WHEN a.system_key = 'INVENTORY' THEN 'inventory'
          WHEN a.type = 'ASSET' THEN 'otherAssets'
          WHEN a.type = 'LIABILITY' THEN 'liabilities'
          WHEN a.type = 'EQUITY' THEN 'equity'
          ELSE 'profitLoss' END AS component,
        SUM(l.debit - l.credit)::text AS amount,
        COUNT(DISTINCT a.id)::int AS accounts
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND ${isOpening} AND j.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      GROUP BY 1`);
    const meta = await this.db.execute<{ opening_date: string | null; first_tx: string | null; before_count: number; assets: number; assets_cost: string | null }>(sql`
      SELECT
        (SELECT MAX(j.date)::text FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND ${isOpening}) AS opening_date,
        (SELECT MIN(j.date)::text FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND NOT ${isOpening}
           AND j.source_type NOT IN ('CLOSING')) AS first_tx,
        (SELECT COUNT(*)::int FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND NOT ${isOpening}
           AND j.source_type NOT IN ('CLOSING')
           AND j.date <= (SELECT MAX(o.date) FROM journal_entries o WHERE o.tenant_id = ${tenantId}
                           AND (o.source_type = 'OPENING' OR (o.source_type = 'STOCK_ADJUSTMENT' AND o.description LIKE '%(OPENING)%')))) AS before_count,
        (SELECT COUNT(*)::int FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.opening_accumulated::numeric > 0) AS assets,
        (SELECT SUM(f.cost)::text FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.opening_accumulated::numeric > 0) AS assets_cost`);
    const by = new Map(rows.rows.map((r) => [r.component, r]));
    const amt = (k: string) => D(by.get(k)?.amount ?? 0);
    const m = meta.rows[0];
    const balancing = amt('balancing');
    const warnings: string[] = [];
    if (m.opening_date && Number(m.before_count) > 0)
      warnings.push(`Ada ${m.before_count} jurnal bertanggal pada/sebelum tanggal saldo awal (${m.opening_date}). Saldo awal sebaiknya dicatat per tanggal sebelum transaksi pertama.`);
    if (m.opening_date && !by.has('cash')) warnings.push('Belum ada saldo kas/bank. Isi saldo kas dan bank per tanggal saldo awal.');
    if (!balancing.isZero() && balancing.abs().gt(amt('cash').abs().plus(amt('receivables').abs()).plus(amt('inventory').abs()).plus(amt('otherAssets').abs()).times(2)))
      warnings.push('Penyeimbang Ekuitas Saldo Awal tidak wajar besarnya dibanding total aset — periksa kembali angka yang dimasukkan.');
    if (Number(m.assets) === 0) warnings.push('Belum ada aset tetap lama dengan akumulasi penyusutan. Lewati bila perusahaan tidak punya aset tetap.');
    const comp = (k: string) => ({ amount: amt(k).toFixed(2), accounts: by.get(k)?.accounts ?? 0 });
    return {
      openingDate: m.opening_date,
      firstTransactionDate: m.first_tx,
      components: {
        cash: comp('cash'),
        otherAssets: comp('otherAssets'),
        receivables: comp('receivables'),
        inventory: comp('inventory'),
        payables: { amount: amt('payables').negated().toFixed(2), accounts: by.get('payables')?.accounts ?? 0 },
        liabilities: { amount: amt('liabilities').negated().toFixed(2), accounts: by.get('liabilities')?.accounts ?? 0 },
        equity: { amount: amt('equity').negated().toFixed(2), accounts: by.get('equity')?.accounts ?? 0 },
        profitLoss: comp('profitLoss'),
        fixedAssets: { amount: D(m.assets_cost ?? 0).toFixed(2), accounts: Number(m.assets) },
      },
      balancing: balancing.negated().toFixed(2),
      warnings,
    };
  }

  // ---------- Jurnal berulang ----------

  listRecurring(tenantId: string) {
    return this.db.select().from(recurringJournals).where(eq(recurringJournals.tenantId, tenantId)).orderBy(asc(recurringJournals.nextDate));
  }

  private async validateLines(tenantId: string, lines: { accountId: string; debit?: string; credit?: string }[]) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accs = await this.db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
    for (const id of ids) {
      const a = accs.find((x) => x.id === id);
      if (!a) throw new BadRequestException('Akun tidak ditemukan');
      if (!a.isPostable) throw new BadRequestException(`Akun ${a.code} adalah akun induk`);
    }
    const d = lines.reduce<Dec>((x, l) => x.plus(D(l.debit)), ZERO);
    const c = lines.reduce<Dec>((x, l) => x.plus(D(l.credit)), ZERO);
    if (!d.eq(c) || d.isZero()) throw new BadRequestException(`Template jurnal tidak seimbang (debit ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)})`);
  }

  async createRecurring(user: AuthUser, dto: CreateRecurringDto) {
    await this.validateLines(user.tenantId, dto.lines);
    const [r] = await this.db
      .insert(recurringJournals)
      .values({ ...dto, tenantId: user.tenantId, nextDate: toDocDate(dto.nextDate), endDate: dto.endDate ? toDocDate(dto.endDate) : null, isAdjustment: dto.isAdjustment ?? true })
      .returning();
    return r;
  }

  async updateRecurring(user: AuthUser, id: string, dto: UpdateRecurringDto) {
    if (dto.lines) await this.validateLines(user.tenantId, dto.lines);
    const [r] = await this.db
      .update(recurringJournals)
      .set({ ...dto, nextDate: dto.nextDate ? toDocDate(dto.nextDate) : undefined })
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, user.tenantId)))
      .returning();
    if (!r) throw new NotFoundException('Jurnal berulang tidak ditemukan');
    return r;
  }

  async deleteRecurring(user: AuthUser, id: string) {
    const gone = await this.db
      .delete(recurringJournals)
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, user.tenantId)))
      .returning({ id: recurringJournals.id });
    if (!gone.length) throw new NotFoundException('Jurnal berulang tidak ditemukan');
    return { ok: true };
  }

  /** Posting semua jurnal berulang yang jatuh tempo s/d hari ini (termasuk yang tertinggal) */
  async runDue(tenantId: string, userId?: string) {
    const today = todayJakarta();
    const due = await this.db
      .select()
      .from(recurringJournals)
      .where(and(eq(recurringJournals.tenantId, tenantId), eq(recurringJournals.isActive, true), lte(recurringJournals.nextDate, today)));
    const posted: { name: string; number: string; date: string }[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const r of due) {
      let next = r.nextDate;
      let remaining = r.remaining;
      let active = true;
      try {
        while (active && next <= today) {
          const date = next;
          await this.db.transaction(async (tx) => {
            const j = await this.posting.post(tx, {
              tenantId,
              date,
              description: r.description,
              sourceType: r.isAdjustment ? 'ADJUSTMENT' : 'RECURRING',
              sourceId: r.id,
              reference: `BRL-${r.id.slice(-6)}`,
              createdById: userId,
              lines: r.lines,
            });
            posted.push({ name: r.name, number: j.number, date });
          });
          next = nextOccurrence(next, r.frequency);
          if (remaining != null) remaining -= 1;
          if ((remaining != null && remaining <= 0) || (r.endDate && next > r.endDate)) active = false;
        }
      } catch (e) {
        errors.push({ name: r.name, error: (e as Error).message });
      }
      await this.db
        .update(recurringJournals)
        .set({ nextDate: next, remaining, isActive: active, lastRunAt: new Date() })
        .where(eq(recurringJournals.id, r.id));
    }
    return { posted, errors };
  }

  async runAllDue() {
    const ids = await this.db.selectDistinct({ id: recurringJournals.tenantId }).from(recurringJournals).where(eq(recurringJournals.isActive, true));
    for (const t of ids) {
      const r = await this.runDue(t.id);
      if (r.posted.length) this.logger.log(`${r.posted.length} jurnal berulang diposting untuk tenant ${t.id}`);
    }
  }

  static nextOccurrence = nextOccurrence;
  static addDays = addDays;

  // ---------- Periode & tutup buku ----------

  async periodStatus(tenantId: string) {
    const lockedUntil = await this.period.lockedUntil(this.db, tenantId);
    const closings = await this.db
      .select({ year: journalEntries.sourceId, number: journalEntries.number, date: journalEntries.date })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, 'CLOSING')))
      .orderBy(desc(journalEntries.date));
    return { lockedUntil, closings };
  }

  /** Kunci periode sampai tanggal tertentu. Membuka kembali (tanggal mundur) hanya untuk Pemilik. */
  async lockPeriod(user: AuthUser, until: string) {
    const date = toDocDate(until);
    const current = await this.period.lockedUntil(this.db, user.tenantId);
    if (current && date < current && user.role !== 'OWNER') {
      throw new ForbiddenException('Membuka kembali periode yang sudah ditutup hanya boleh dilakukan Pemilik');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(tenants).set({ lockedUntil: date }).where(eq(tenants.id, user.tenantId));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: current && date < current ? 'UNLOCK_PERIOD' : 'LOCK_PERIOD',
        entity: 'Tenant',
        entityId: user.tenantId,
        data: { from: current, to: date },
      });
    });
    return this.periodStatus(user.tenantId);
  }

  /**
   * Jurnal penutup akhir tahun: nolkan akun pendapatan & beban tahun itu ke Laba Ditahan.
   * Laporan laba rugi mengabaikan jurnal ini sehingga angka tahun tersebut tetap terbaca.
   */
  async closeYear(user: AuthUser, dto: CloseYearDto) {
    const from = `${dto.year}-01-01`;
    const to = `${dto.year}-12-31`;
    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ number: journalEntries.number })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, user.tenantId),
            eq(journalEntries.sourceType, 'CLOSING'),
            eq(journalEntries.sourceId, String(dto.year)),
          ),
        );
      if (existing) throw new BadRequestException(`Tahun ${dto.year} sudah ditutup (${existing.number})`);

      const rows = (await this.balances(user.tenantId, from, to, true)).filter(
        (r) => (r.type === 'REVENUE' || r.type === 'EXPENSE') && !r.balance.isZero(),
      );
      if (!rows.length) throw new BadRequestException(`Tidak ada saldo pendapatan/beban di tahun ${dto.year}`);

      const lines = rows.map((r) => {
        // Nolkan: pendapatan (saldo kredit) di-debit, beban (saldo debit) di-kredit
        const amount = r.balance.abs();
        const toDebit = r.type === 'REVENUE' ? r.balance.isPositive() : r.balance.isNegative();
        return { accountId: r.id, debit: toDebit ? amount : 0, credit: toDebit ? 0 : amount };
      });
      const net = rows
        .filter((r) => r.type === 'REVENUE')
        .reduce<Dec>((a, r) => a.plus(r.balance), ZERO)
        .minus(rows.filter((r) => r.type === 'EXPENSE').reduce<Dec>((a, r) => a.plus(r.balance), ZERO));

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: to,
        description: `Jurnal penutup tahun ${dto.year} (laba bersih ${net.toFixed(2)})`,
        sourceType: 'CLOSING',
        sourceId: String(dto.year),
        createdById: user.sub,
        lines: [...lines, { key: SYS.RETAINED, credit: net.gt(0) ? net : 0, debit: net.lt(0) ? net.abs() : 0 }],
      });
      if (dto.lock !== false) {
        const current = await this.period.lockedUntil(tx, user.tenantId);
        if (!current || current < to) await tx.update(tenants).set({ lockedUntil: to }).where(eq(tenants.id, user.tenantId));
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CLOSE_YEAR', entity: 'Tenant', entityId: user.tenantId, data: { year: dto.year, journal: journal.number } });
      return { journalNumber: journal.number, netIncome: net.toFixed(2) };
    });
    return { ...result, ...(await this.periodStatus(user.tenantId)) };
  }

  // ---------- Laporan ----------

  async trialBalance(tenantId: string, from?: string, to?: string) {
    const rows = await this.balances(tenantId, from, to);
    const totalDebit = rows.reduce<Dec>((a, r) => a.plus(r.debit), ZERO);
    const totalCredit = rows.reduce<Dec>((a, r) => a.plus(r.credit), ZERO);
    return { rows, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) };
  }

  async profitLoss(tenantId: string, from?: string, to?: string) {
    const rows = await this.balances(tenantId, from, to, true);
    const revenue = rows.filter((r) => r.type === 'REVENUE');
    const expense = rows.filter((r) => r.type === 'EXPENSE');
    const totalRevenue = revenue.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);
    const totalExpense = expense.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);
    return { revenue, expense, totalRevenue, totalExpense, netIncome: totalRevenue.minus(totalExpense) };
  }

  /** Neraca per tanggal. Laba berjalan = pendapatan − beban yang belum ditutup ke Laba Ditahan. */
  async balanceSheet(tenantId: string, asOf?: string) {
    const rows = await this.balances(tenantId, undefined, asOf);
    const pick = (t: AccountType) => rows.filter((r) => r.type === t && !r.balance.isZero());
    const total = (rs: { balance: Dec }[]) => rs.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);

    const currentEarnings = total(rows.filter((r) => r.type === 'REVENUE')).minus(
      total(rows.filter((r) => r.type === 'EXPENSE')),
    );
    const assets = pick('ASSET');
    const liabilities = pick('LIABILITY');
    const equity = pick('EQUITY');
    const totalAssets = total(assets);
    const totalLiabilitiesEquity = total(liabilities).plus(total(equity)).plus(currentEarnings);
    return {
      assets,
      liabilities,
      equity,
      currentEarnings,
      totalAssets,
      totalLiabilitiesEquity,
      balanced: totalAssets.eq(totalLiabilitiesEquity),
    };
  }

  /** Buku besar satu akun: saldo awal, mutasi, saldo berjalan. */
  async ledger(tenantId: string, accountId: string, from?: string, to?: string) {
    const [acc] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)));
    if (!acc) throw new NotFoundException('Akun tidak ditemukan');

    const fromDate = from ? toDocDate(from) : undefined;
    const toDate = to ? toDocDate(to) : undefined;
    const [open] = fromDate
      ? (
          await this.db.execute<{ debit: string; credit: string }>(sql`
            SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
            FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
            WHERE l.account_id = ${accountId} AND j.date < ${fromDate}`)
        ).rows
      : [{ debit: '0', credit: '0' }];
    const opening = normal(acc.type, open.debit, open.credit);

    const res = await this.db.execute<{
      journal_id: string;
      number: string;
      date: string;
      description: string;
      source_type: string;
      debit: string;
      credit: string;
      memo: string | null;
    }>(sql`
      SELECT j.id AS journal_id, j.number, j.date, j.description, j.source_type, l.debit, l.credit, l.memo
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE l.account_id = ${accountId}
        ${fromDate ? sql`AND j.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND j.date <= ${toDate}` : sql``}
      ORDER BY j.date, j.number, l.id
      LIMIT 5000`);

    let running = opening;
    let totalDebit: Dec = ZERO;
    let totalCredit: Dec = ZERO;
    const rows = res.rows.map((r) => {
      running = running.plus(normal(acc.type, r.debit, r.credit));
      totalDebit = totalDebit.plus(r.debit);
      totalCredit = totalCredit.plus(r.credit);
      return {
        journalId: r.journal_id,
        number: r.number,
        date: r.date,
        description: r.memo ? `${r.description} — ${r.memo}` : r.description,
        sourceType: r.source_type,
        debit: D(r.debit).toFixed(2),
        credit: D(r.credit).toFixed(2),
        balance: running.toFixed(2),
      };
    });
    return {
      account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type },
      opening: opening.toFixed(2),
      rows,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      closing: running.toFixed(2),
    };
  }

  /**
   * Laporan arus kas metode langsung: setiap jurnal yang menyentuh akun kas/bank
   * diklasifikasikan dari akun lawannya (operasi / investasi / pendanaan).
   */
  async cashFlow(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? toDocDate(from) : '1900-01-01';
    const toDate = to ? toDocDate(to) : '2999-12-31';

    const openRes = await this.db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account = true AND j.date < ${fromDate}`);
    const opening = D(openRes.rows[0].v);

    const res = await this.db.execute<{
      journal_id: string;
      debit: string;
      credit: string;
      account_id: string;
      code: string;
      name: string;
      type: AccountType;
      is_cash: boolean;
      system_key: string | null;
    }>(sql`
      SELECT j.id AS journal_id, l.debit, l.credit, a.id AS account_id, a.code, a.name, a.type,
             a.is_cash_account AS is_cash, a.system_key
      FROM journal_entries j
      JOIN journal_lines l ON l.journal_id = j.id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND j.source_type <> 'CLOSING'
        AND EXISTS (SELECT 1 FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                    WHERE l2.journal_id = j.id AND a2.is_cash_account = true)`);

    const byJournal = new Map<string, typeof res.rows>();
    for (const r of res.rows) byJournal.set(r.journal_id, [...(byJournal.get(r.journal_id) ?? []), r]);

    const LABEL: Record<string, string> = {
      AR: 'Penerimaan dari pelanggan',
      AP: 'Pembayaran ke supplier',
    };
    const groups: Record<CashCategory, Map<string, Dec>> = { operating: new Map(), investing: new Map(), financing: new Map() };

    for (const lines of byJournal.values()) {
      const cash = lines.filter((l) => l.is_cash);
      const delta = cash.reduce<Dec>((a, l) => a.plus(l.debit).minus(l.credit), ZERO);
      if (delta.isZero()) continue; // transfer antar kas/bank
      const others = lines.filter((l) => !l.is_cash);
      const category: CashCategory = others.some(
        (l) => l.type === 'EQUITY' || (l.type === 'LIABILITY' && l.code.startsWith('2-2')),
      )
        ? 'financing'
        : others.some((l) => l.type === 'ASSET' && l.code.startsWith('1-2'))
          ? 'investing'
          : 'operating';
      const main = others.sort((a, b) => D(b.debit).plus(b.credit).comparedTo(D(a.debit).plus(a.credit)))[0];
      const label = main ? (main.system_key && LABEL[main.system_key]) || `${main.code} ${main.name}` : 'Lain-lain';
      groups[category].set(label, (groups[category].get(label) ?? ZERO).plus(delta));
    }

    const section = (c: CashCategory) => {
      const items = [...groups[c].entries()]
        .map(([label, amount]) => ({ label, amount: amount.toFixed(2) }))
        .sort((a, b) => D(a.amount).comparedTo(b.amount) * -1);
      const total = [...groups[c].values()].reduce<Dec>((a, v) => a.plus(v), ZERO);
      return { items, total: total.toFixed(2) };
    };
    const operating = section('operating');
    const investing = section('investing');
    const financing = section('financing');
    const net = D(operating.total).plus(investing.total).plus(financing.total);
    return {
      opening: opening.toFixed(2),
      operating,
      investing,
      financing,
      netChange: net.toFixed(2),
      closing: opening.plus(net).toFixed(2),
    };
  }

  /** Rekap PPN: keluaran vs masukan per periode + daftar dokumen (bahan lapor SPT Masa PPN / e-Faktur). */
  async vatReport(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? toDocDate(from) : '1900-01-01';
    const toDate = to ? toDocDate(to) : '2999-12-31';
    const gl = await this.db.execute<{ key: string; debit: string; credit: string }>(sql`
      SELECT a.system_key AS key, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND a.system_key IN ('VAT_OUT', 'VAT_IN')
      GROUP BY a.system_key`);
    const get = (k: string) => gl.rows.find((r) => r.key === k);
    const vatOut = get('VAT_OUT') ? D(get('VAT_OUT')!.credit).minus(get('VAT_OUT')!.debit) : ZERO;
    const vatIn = get('VAT_IN') ? D(get('VAT_IN')!.debit).minus(get('VAT_IN')!.credit) : ZERO;

    const docs = await this.db.execute<{
      kind: string;
      number: string;
      ref: string | null;
      date: string;
      party: string;
      npwp: string | null;
      dpp: string;
      ppn: string;
    }>(sql`
      SELECT 'Faktur jual' AS kind, i.number, NULL AS ref, i.date, c.name AS party, c.npwp, i.subtotal AS dpp, i.tax_amount AS ppn
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${fromDate} AND ${toDate} AND NOT i.is_opening
      UNION ALL
      SELECT 'Retur jual', r.number, i.number, r.date, c.name, c.npwp, -r.subtotal, -r.tax_amount
        FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      UNION ALL
      SELECT 'Faktur beli', p.number, p.supplier_invoice_no, p.date, s.name, s.npwp, p.subtotal, p.tax_amount
        FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = ${tenantId} AND p.date BETWEEN ${fromDate} AND ${toDate} AND p.kind <> 'OPENING'
      UNION ALL
      SELECT 'Retur beli', r.number, p.number, r.date, s.name, s.npwp, -r.subtotal, -r.tax_amount
        FROM purchase_returns r JOIN purchase_invoices p ON p.id = r.purchase_invoice_id JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      ORDER BY date, number`);

    const net = vatOut.minus(vatIn);
    return {
      vatOut: vatOut.toFixed(2),
      vatIn: vatIn.toFixed(2),
      net: net.toFixed(2),
      status: net.isPositive() ? 'KURANG_BAYAR' : net.isNegative() ? 'LEBIH_BAYAR' : 'NIHIL',
      documents: docs.rows.map((d) => ({ ...d, dpp: D(d.dpp).toFixed(2), ppn: D(d.ppn).toFixed(2) })),
    };
  }

  private async balances(tenantId: string, from?: string, to?: string, excludeClosing = false): Promise<BalanceRow[]> {
    const fromCond = from ? sql`AND j.date >= ${toDocDate(from)}` : sql``;
    const toCond = to ? sql`AND j.date <= ${toDocDate(to)}` : sql``;
    const closingCond = excludeClosing ? sql`AND j.source_type <> 'CLOSING'` : sql``;
    const res = await this.db.execute<{ id: string; code: string; name: string; type: AccountType; debit: string; credit: string }>(sql`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(t.debit, 0) AS debit, COALESCE(t.credit, 0) AS credit
      FROM accounts a
      LEFT JOIN (
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l
        JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} ${fromCond} ${toCond} ${closingCond}
        GROUP BY l.account_id
      ) t ON t.account_id = a.id
      WHERE a.tenant_id = ${tenantId} AND a.is_postable = true
      ORDER BY a.code`);

    return res.rows.map((r) => {
      const debit = D(r.debit);
      const credit = D(r.credit);
      return { ...r, debit, credit, balance: normal(r.type, debit, credit) };
    });
  }
}
