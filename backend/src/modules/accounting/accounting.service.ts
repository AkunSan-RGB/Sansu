import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { REPORT_GROUPS } from '@sansu/shared';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { PeriodService } from '../../common/period/period.service';
import { addDays, assertNotFarFuture, DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, DecValue, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import type { DbOrTx } from '../../db/db';
import { AccountType, accounts, assetCategories, journalEntries, journalLines, recurringJournals, scheduledReversals, tenants } from '../../db/schema';
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
import { BudgetService } from './budget.service';
import { PostingService } from './posting.service';
import { loadSourceDocument } from './source-document';
import { resolveSourceRoutes } from './source-route';
import { decryptField } from '../../common/utils/secret';
import { AccountingRepository } from './accounting.repository';
import { ReferenceRepository } from '../../db/reference.repository';

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
export const LEDGER_ROW_LIMIT = 5000;
/** Tanggal 1 pada bulan berikutnya */
function nextMonthStart(date: string): string {
  const [y, m] = toDocDate(String(date).slice(0, 10)).split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
export const normal = (type: AccountType, debit: DecValue, credit: DecValue) =>
  DEBIT_NORMAL.includes(type) ? D(debit).minus(credit) : D(credit).minus(debit);

export type CashCategory = 'operating' | 'investing' | 'financing';

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
    private readonly approvals: ApprovalsService,
    private readonly budget: BudgetService,
    private readonly repo: AccountingRepository,
    private readonly refs: ReferenceRepository,
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
      const parent = await this.refs.account(this.db, tenantId, dto.parentId);
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
    const acc = await this.repo.accountOfTenant(this.db, tenantId, id);
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
    const acc = await this.repo.accountOfTenant(this.db, tenantId, id);
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

  /** Pengguna terbatas cabang: hanya jurnal yang punya baris di cabangnya, dan hanya baris cabangnya yang tampak */
  private branchJournalCond(ids?: string[] | null) {
    if (!ids?.length) return undefined;
    return sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_id = ${journalEntries.id} AND jl.branch_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}))`;
  }

  async listJournals(tenantId: string, q: JournalQueryDto, branchIds?: string[] | null) {
    const term = q.q?.trim();
    const rows = await this.db.query.journalEntries.findMany({
      where: and(
        eq(journalEntries.tenantId, tenantId),
        this.branchJournalCond(branchIds),
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
    const routes = await resolveSourceRoutes(this.db, tenantId, rows);
    const sched = rows.length
      ? await this.db
          .select({ journalId: scheduledReversals.journalId, reverseOn: scheduledReversals.reverseOn })
          .from(scheduledReversals)
          .where(and(eq(scheduledReversals.tenantId, tenantId), eq(scheduledReversals.status, 'PENDING'), inArray(scheduledReversals.journalId, rows.map((r) => r.id))))
      : [];
    const schedBy = new Map(sched.map((x) => [x.journalId, x.reverseOn]));
    return rows.map((r, i) => ({ ...r, lines: branchIds?.length ? r.lines.filter((l) => l.branchId && branchIds.includes(l.branchId)) : r.lines, docRoute: routes[i], scheduledReversal: schedBy.get(r.id) ?? null }));
  }

  async getJournal(tenantId: string, id: string, branchIds?: string[] | null) {
    const j = await this.db.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.tenantId, tenantId), this.branchJournalCond(branchIds)),
      with: { lines: { with: { account: { columns: { code: true, name: true } } } } },
    });
    if (!j) throw new NotFoundException('Jurnal tidak ditemukan');
    if (branchIds?.length) j.lines = j.lines.filter((l) => l.branchId && branchIds.includes(l.branchId));
    return { ...j, docRoute: (await resolveSourceRoutes(this.db, tenantId, [j]))[0] };
  }

  /** Rincian dokumen asal sebuah jurnal (faktur pembelian, mutasi stok, kas, kasir, setoran pajak, dst.) beserta jurnalnya */
  async journalDocument(tenantId: string, id: string, branchIds?: string[] | null) {
    const journal = await this.getJournal(tenantId, id, branchIds);
    const document = await loadSourceDocument(this.db, tenantId, journal.sourceType, journal.sourceId, journal.id);
    return { journal, document };
  }

  /** Jurnal manual. Bernilai besar dari peran yang tidak berwenang: dikirim sebagai permintaan persetujuan dan baru diposting setelah disetujui. */
  async createManualJournal(user: AuthUser, dto: CreateJournalDto, opts: { approved?: boolean } = {}) {
    assertNotFarFuture(toDocDate(dto.date), 'jurnal');
    await this.assertNoControlAccounts(user, dto.lines.map((l) => l.accountId), dto.controlOverrideReason);
    if (dto.autoReverse && !dto.adjustment) throw new BadRequestException('Balik otomatis hanya untuk jurnal penyesuaian');
    // Anggaran: jurnal manual yang membebankan biaya melebihi anggaran (jurnal penyesuaian akhir periode dikecualikan)
    if (!dto.adjustment) {
      const net = new Map<string, Dec>();
      for (const l of dto.lines) net.set(l.accountId, (net.get(l.accountId) ?? ZERO).plus(money(D(l.debit))).minus(money(D(l.credit))));
      await this.budget.guard(
        user,
        [...net].filter(([, v]) => v.gt(0)).map(([accountId, amount]) => ({ accountId, amount, date: toDocDate(dto.date) })),
        { kind: 'MANUAL_JOURNAL', title: `Jurnal manual: ${dto.description}`, payload: JSON.parse(JSON.stringify(dto)), approved: opts.approved, overrideReason: dto.budgetOverrideReason },
      );
    }
    if (!opts.approved) {
      const total = dto.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
      const limit = await this.approvals.needs(this.db, user, 'MANUAL_JOURNAL', total);
      if (limit !== null) {
        const req = await this.approvals.create(this.db, user, { kind: 'MANUAL_JOURNAL', refId: null, title: `Jurnal manual: ${dto.description}`, amount: total, payload: JSON.parse(JSON.stringify(dto)) });
        throw this.approvals.required(req.id, 'Nilai jurnal mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan jurnal diposting setelah disetujui.');
      }
      if (!dto.confirmDuplicate) await this.assertNotDuplicate(user.tenantId, dto);
    }
    return this.db.transaction(async (tx) => {
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: toDocDate(dto.date),
        description: dto.description,
        sourceType: dto.adjustment ? 'ADJUSTMENT' : 'MANUAL',
        reference: dto.reference,
        createdById: user.sub,
        branchId: dto.branchId,
        lines: dto.lines,
      });
      // Akrual yang harus dibalik di awal periode berikutnya: dijadwalkan sekali di sini, tidak perlu dibalik manual lagi
      let scheduledReversal: string | null = null;
      if (dto.autoReverse) {
        scheduledReversal = nextMonthStart(j.date);
        await tx.insert(scheduledReversals).values({ tenantId: user.tenantId, journalId: j.id, reverseOn: scheduledReversal, createdById: user.sub });
      }
      return { ...j, scheduledReversal };
    });
  }

  /**
   * Cegah pencatatan ganda: jurnal lain (manual maupun otomatis, yang belum dibalik) dengan akun yang sama persis dan nilai yang sama
   * dalam ±7 hari. Pengguna dapat tetap menyimpan dengan konfirmasi (confirmDuplicate).
   */
  private async assertNotDuplicate(tenantId: string, dto: CreateJournalDto) {
    const date = toDocDate(dto.date);
    const total = dto.lines.reduce<Dec>((a, l) => a.plus(money(D(l.debit))), ZERO);
    const ids = [...new Set(dto.lines.filter((l) => money(D(l.debit)).gt(0) || money(D(l.credit)).gt(0)).map((l) => l.accountId))].sort();
    if (!ids.length || total.lte(0)) return;
    const res = await this.db.execute<{ number: string; date: string; description: string }>(sql`
      SELECT j.number, j.date::text AS date, j.description
      FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.reversal_of_id IS NULL
        AND j.date BETWEEN ${addDays(date, -7)} AND ${addDays(date, 7)}
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
        AND (SELECT COALESCE(SUM(l.debit), 0) FROM journal_lines l WHERE l.journal_id = j.id) = ${total.toFixed(2)}
        AND (SELECT array_agg(DISTINCT l.account_id) FROM journal_lines l WHERE l.journal_id = j.id) @> ${`{${ids.join(',')}}`}::uuid[]
        AND (SELECT array_agg(DISTINCT l.account_id) FROM journal_lines l WHERE l.journal_id = j.id) <@ ${`{${ids.join(',')}}`}::uuid[]
      ORDER BY j.date DESC LIMIT 3`);
    if (res.rows.length) {
      throw new ConflictException({
        statusCode: 409,
        code: 'POSSIBLE_DUPLICATE',
        message: `Jurnal serupa sudah ada: ${res.rows.map((r) => `${r.number} (${r.date.slice(0, 10)})`).join(', ')}. Pastikan bukan pencatatan ganda.`,
        duplicates: res.rows,
      });
    }
  }

  /**
   * Jurnal balik dari menu Jurnal Umum.
   * Tanggal bawaan = tanggal jurnal asal bila periodenya masih terbuka (koreksi salah catat harus membersihkan periode yang salah,
   * bukan memindahkan koreksinya ke bulan ini); bila periode terkunci atau kas sudah diopname, memakai hari ini.
   * Jurnal yang sudah dicocokkan dengan mutasi bank tidak boleh dibalik sebelum pencocokannya dibatalkan.
   */
  async reverseJournal(user: AuthUser, id: string, date?: string) {
    return this.db.transaction(async (tx) => {
      const original = await tx.query.journalEntries.findFirst({
        where: and(eq(journalEntries.id, id), eq(journalEntries.tenantId, user.tenantId)),
        with: { lines: { columns: { id: true, accountId: true } } },
      });
      if (!original) throw new NotFoundException('Jurnal tidak ditemukan');
      const lineIds = original.lines.map((l) => l.id);
      if (lineIds.length) {
        const idList = sql.join(lineIds.map((x) => sql`${x}`), sql`, `);
        const matched = await tx.execute<{ n: number }>(sql`
          SELECT (SELECT COUNT(*) FROM bank_statement_lines WHERE status = 'MATCHED' AND journal_line_id IN (${idList}))::int
               + (SELECT COUNT(*) FROM bank_line_extra_matches WHERE journal_line_id IN (${idList}))::int AS n`);
        if (matched.rows[0].n > 0) throw new BadRequestException('Jurnal ini sudah dicocokkan dengan mutasi bank. Batalkan pencocokannya di Rekonsiliasi Bank dulu, lalu balik jurnalnya');
      }
      let useDate: DocDate;
      if (date) useDate = toDocDate(date);
      else {
        const orig = toDocDate(original.date);
        const locked = await this.period.lockedUntil(tx, user.tenantId);
        useDate = orig;
        if (locked && orig <= locked) useDate = toDocDate(undefined);
        else {
          try {
            await this.posting.assertCashNotCounted(tx, user.tenantId, orig, original.lines.map((l) => l.accountId));
          } catch {
            useDate = toDocDate(undefined);
          }
        }
      }
      const rev = await this.posting.reverse(tx, user.tenantId, id, useDate, user.sub);
      // mutasi bank yang dibuatkan jurnalnya dari jurnal ini kembali "belum diproses" agar bisa dibuatkan jurnal yang benar
      await tx.execute(sql`UPDATE bank_statement_lines SET status = 'UNMATCHED', journal_id = NULL, journal_line_id = NULL, matched_by = NULL WHERE status = 'CREATED' AND journal_id = ${id}`);
      return rev;
    });
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
        if (a.systemKey === SYS.INVENTORY || a.systemKey === SYS.INVENTORY_SEMI) {
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
      const journal = await this.posting.post(tx, {
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
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'OpeningBalance', entityId: journal.id, data: { date, debit: totalD.toFixed(2), credit: totalC.toFixed(2), balancing: diff.negated().toFixed(2) } });
      return Object.assign(journal, { _balancing: diff.negated().toFixed(2), _total: ZERO.plus(totalD.gt(totalC) ? totalD : totalC).toFixed(2) });
    };
    const res = outerTx ? await run(outerTx) : await this.db.transaction(run);
    // Saldo awal mengubah seluruh neraca: Pemilik diberi tahu bila dicatat orang lain (impor massal memakai transaksi luar dan tidak memberi tahu)
    if (!outerTx && user.role !== 'OWNER') {
      void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Saldo awal dicatat per ${date}`, lines: [`Total Rp${Math.round(Number(res._total)).toLocaleString('id-ID')} · penyeimbang Ekuitas Saldo Awal Rp${Math.round(Number(res._balancing)).toLocaleString('id-ID')}`, 'Saldo awal mengubah seluruh neraca; pastikan angkanya sesuai neraca penutup sistem lama.'], path: '/opening-balance' });
    }
    return res;
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
          WHEN a.system_key IN ('INVENTORY', 'INVENTORY_SEMI') THEN 'inventory'
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

  /**
   * Akun kontrol punya rincian per dokumen (piutang, hutang, stok, aset tetap) atau dana tetap (kas kecil). Jurnal manual ke akun ini membuat
   * buku besar tidak sama dengan daftar di bawahnya, jadi dikoreksi lewat dokumennya. Hanya Pemilik yang boleh mengecualikan,
   * dengan alasan (min. 10 karakter) yang tercatat di jejak audit.
   */
  private async assertNoControlAccounts(user: AuthUser, accountIds: string[], override?: string, context = 'Jurnal manual') {
    const ids = [...new Set(accountIds)];
    if (!ids.length) return;
    const accs = await this.db.select().from(accounts).where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, ids)));
    const cats = await this.db.select({ a: assetCategories.assetAccountId, b: assetCategories.accumulatedAccountId }).from(assetCategories).where(eq(assetCategories.tenantId, user.tenantId));
    const assetAccounts = new Set(cats.flatMap((c) => [c.a, c.b].filter((x): x is string => !!x)));
    const petty = await this.db.execute<{ account_id: string }>(sql`SELECT account_id FROM petty_cash_funds WHERE tenant_id = ${user.tenantId} AND status = 'ACTIVE'`);
    const pettyAccounts = new Set(petty.rows.map((r) => r.account_id));
    const reasonOf = (a: (typeof accs)[number]) =>
      a.systemKey === SYS.AR ? 'piutang usaha (dikoreksi lewat faktur, pembayaran, atau retur)'
      : a.systemKey === SYS.AP ? 'hutang usaha (dikoreksi lewat faktur pembelian, pembayaran, atau retur)'
      : a.systemKey === SYS.INVENTORY || a.systemKey === SYS.INVENTORY_SEMI ? 'persediaan (dikoreksi lewat penyesuaian stok atau opname)'
      : a.systemKey === SYS.INTERBRANCH ? 'rekening antar cabang (diisi otomatis saat barang berpindah antar-cabang)'
      : pettyAccounts.has(a.id) ? 'kas kecil dana tetap (dicatat lewat bukti kas kecil dan pengisian kembali)'
      : assetAccounts.has(a.id) ? 'aset tetap (dicatat lewat faktur/kas dan menu Aset Tetap)'
      : null;
    const hits = accs.map((a) => ({ a, why: reasonOf(a) })).filter((x) => x.why);
    if (!hits.length) return;
    if (user.role === 'OWNER' && override && override.trim().length >= 10) {
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CONTROL_OVERRIDE', entity: 'Journal', entityId: user.tenantId, data: { context, accounts: hits.map((h) => h.a.code), reason: override.trim() } });
      return;
    }
    throw new BadRequestException(
      `${context} tidak boleh memakai akun kontrol: ${hits.map((h) => `${h.a.code} ${h.a.name} — ${h.why}`).join('; ')}.` +
        (user.role === 'OWNER' ? ' Pemilik dapat mengecualikan dengan mengisi alasan pengecualian (min. 10 karakter).' : ''),
    );
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
    await this.assertNoControlAccounts(user, dto.lines.map((l) => l.accountId), undefined, 'Jurnal berulang');
    const [r] = await this.db
      .insert(recurringJournals)
      .values({ ...dto, tenantId: user.tenantId, nextDate: toDocDate(dto.nextDate), endDate: dto.endDate ? toDocDate(dto.endDate) : null, isAdjustment: dto.isAdjustment ?? true })
      .returning();
    return r;
  }

  async updateRecurring(user: AuthUser, id: string, dto: UpdateRecurringDto) {
    if (dto.lines) {
      await this.validateLines(user.tenantId, dto.lines);
      await this.assertNoControlAccounts(user, dto.lines.map((l) => l.accountId), undefined, 'Jurnal berulang');
    }
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

  /**
   * Posting semua jurnal berulang yang jatuh tempo s/d hari ini (termasuk yang tertinggal) + jurnal balik terjadwal.
   * Setiap kemunculan diposting DAN tanggal berikutnya dimajukan dalam SATU transaksi dengan kunci baris templat, sehingga
   * penjadwal dan tombol manual yang berjalan bersamaan, atau proses yang terhenti di tengah, tidak pernah memposting dua kali.
   * (Database juga menolak jurnal ganda untuk templat dan tanggal yang sama.)
   */
  async runDue(tenantId: string, userId?: string) {
    const today = todayJakarta();
    const reversed = await this.runScheduledReversals(tenantId);
    const due = await this.db
      .select({ id: recurringJournals.id })
      .from(recurringJournals)
      .where(and(eq(recurringJournals.tenantId, tenantId), eq(recurringJournals.isActive, true), lte(recurringJournals.nextDate, today)));
    const posted: { name: string; number: string; date: string }[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const { id } of due) {
      let name = id;
      try {
        for (let guard = 0; guard < 1000; guard++) {
          const more = await this.db.transaction(async (tx) => {
            const r = await this.repo.recurringForUpdate(tx, tenantId, id);
            // proses lain mungkin sudah memajukannya
            if (!r || !r.isActive || r.nextDate > today) return false;
            name = r.name;
            const date = r.nextDate;
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
            const next = nextOccurrence(date, r.frequency);
            const remaining = r.remaining != null ? r.remaining - 1 : null;
            const active = !((remaining != null && remaining <= 0) || (r.endDate && next > r.endDate));
            await tx.update(recurringJournals).set({ nextDate: next, remaining, isActive: active, lastRunAt: new Date() }).where(eq(recurringJournals.id, r.id));
            posted.push({ name: r.name, number: j.number, date });
            return active && next <= today;
          });
          if (!more) break;
        }
      } catch (e) {
        errors.push({ name, error: (e as Error).message });
      }
    }
    return { posted, errors, reversed };
  }

  /**
   * Jurnal balik terjadwal (akrual "balik otomatis"): dibalik pada tanggal jadwalnya. Bila sudah dibalik manual, ditandai selesai
   * tanpa membuat pembalik kedua. Bila periode jadwal sudah terkunci, memakai hari ini.
   */
  async runScheduledReversals(tenantId: string) {
    const today = todayJakarta();
    const due = await this.db
      .select({ id: scheduledReversals.id })
      .from(scheduledReversals)
      .where(and(eq(scheduledReversals.tenantId, tenantId), eq(scheduledReversals.status, 'PENDING'), lte(scheduledReversals.reverseOn, today)));
    const done: { journalNumber: string; reversalNumber: string | null; date: string; skipped?: boolean }[] = [];
    for (const { id } of due) {
      try {
        await this.db.transaction(async (tx) => {
          const row = await this.repo.scheduledReversalForUpdate(tx, id);
          if (!row || row.status !== 'PENDING') return;
          const orig = await tx.query.journalEntries.findFirst({ where: eq(journalEntries.id, row.journalId) });
          const already = await tx.query.journalEntries.findFirst({ where: eq(journalEntries.reversalOfId, row.journalId) });
          if (!orig || already) {
            await tx.update(scheduledReversals).set({ status: 'SKIPPED', processedAt: new Date(), reversalJournalId: already?.id ?? null }).where(eq(scheduledReversals.id, id));
            done.push({ journalNumber: orig?.number ?? '-', reversalNumber: already?.number ?? null, date: row.reverseOn, skipped: true });
            return;
          }
          const locked = await this.period.lockedUntil(tx, tenantId);
          const date = locked && row.reverseOn <= locked ? today : row.reverseOn;
          const rev = await this.posting.reverse(tx, tenantId, row.journalId, date, row.createdById ?? undefined, true);
          await tx.update(scheduledReversals).set({ status: 'DONE', processedAt: new Date(), reversalJournalId: rev.id, lastError: null }).where(eq(scheduledReversals.id, id));
          done.push({ journalNumber: orig.number, reversalNumber: rev.number, date });
        });
      } catch (e) {
        await this.db.update(scheduledReversals).set({ lastError: (e as Error).message }).where(eq(scheduledReversals.id, id));
      }
    }
    return done;
  }

  /** Batalkan jadwal balik otomatis sebuah jurnal (jurnalnya sendiri tidak berubah) */
  async cancelScheduledReversal(user: AuthUser, journalId: string) {
    const r = await this.db
      .update(scheduledReversals)
      .set({ status: 'CANCELLED', processedAt: new Date() })
      .where(and(eq(scheduledReversals.journalId, journalId), eq(scheduledReversals.tenantId, user.tenantId), eq(scheduledReversals.status, 'PENDING')))
      .returning({ id: scheduledReversals.id });
    if (!r.length) throw new NotFoundException('Tidak ada jadwal balik otomatis yang menunggu untuk jurnal ini');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL_SCHEDULED_REVERSAL', entity: 'Journal', entityId: journalId });
    return { ok: true };
  }

  async runAllDue() {
    const rec = await this.db.selectDistinct({ id: recurringJournals.tenantId }).from(recurringJournals).where(eq(recurringJournals.isActive, true));
    const rev = await this.db.selectDistinct({ id: scheduledReversals.tenantId }).from(scheduledReversals).where(eq(scheduledReversals.status, 'PENDING'));
    for (const id of new Set([...rec.map((x) => x.id), ...rev.map((x) => x.id)])) {
      const r = await this.runDue(id);
      if (r.posted.length) this.logger.log(`${r.posted.length} jurnal berulang diposting untuk tenant ${id}`);
      if (r.reversed.length) this.logger.log(`${r.reversed.length} jurnal balik terjadwal diproses untuk tenant ${id}`);
      for (const e of r.errors) this.logger.warn(`Jurnal berulang "${e.name}" gagal untuk tenant ${id}: ${e.error}`);
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
    if (date > todayJakarta()) throw new BadRequestException('Periode yang belum berakhir tidak bisa dikunci: tanggal kunci paling lambat hari ini');
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
    // Jurnal penutup bertanggal 31 Des dan (bila dikunci) mengunci sampai tanggal itu: tahun yang belum berakhir akan membekukan pembukuan sisa tahun
    if (to >= todayJakarta()) throw new BadRequestException(`Tahun ${dto.year} belum berakhir; buku hanya bisa ditutup setelah 31 Desember ${dto.year}`);
    const result = await this.db.transaction(async (tx) => {
      // Satu penutupan pada satu waktu per perusahaan; saldo dibaca di dalam transaksi yang sama dengan jurnal penutupnya
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`close:${user.tenantId}`}))`);
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

      const rows = (await this.balances(user.tenantId, from, to, true, tx)).filter(
        (r) => (r.type === 'REVENUE' || r.type === 'EXPENSE') && !r.balance.isZero(),
      );
      if (!rows.length) throw new BadRequestException(`Tidak ada saldo pendapatan/beban di tahun ${dto.year}`);

      // Nolkan per akun per cabang (label cabang dipertahankan) agar laba ditahan tiap cabang benar dan neraca per cabang tetap seimbang
      const grouped = await tx.execute<{ account_id: string; type: string; b: string | null; d: string; c: string }>(sql`
        SELECT l.account_id, a.type, l.branch_id::text AS b, SUM(l.debit) AS d, SUM(l.credit) AS c
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${user.tenantId} AND j.date >= ${from} AND j.date <= ${to} AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
        GROUP BY l.account_id, a.type, l.branch_id`);
      const netByBranch = new Map<string | null, Dec>();
      const lines: { accountId: string; debit: Dec | number; credit: Dec | number; branchId: string | null }[] = [];
      for (const g of grouped.rows) {
        const balance = g.type === 'REVENUE' ? D(g.c).minus(g.d) : D(g.d).minus(g.c);
        if (balance.isZero()) continue;
        const amount = balance.abs();
        const toDebit = g.type === 'REVENUE' ? balance.isPositive() : balance.isNegative();
        lines.push({ accountId: g.account_id, debit: toDebit ? amount : 0, credit: toDebit ? 0 : amount, branchId: g.b });
        netByBranch.set(g.b, (netByBranch.get(g.b) ?? ZERO).plus(g.type === 'REVENUE' ? balance : balance.negated()));
      }
      const net = [...netByBranch.values()].reduce<Dec>((a, v) => a.plus(v), ZERO);
      const retainedLines = [...netByBranch].map(([b, v]) => ({ key: SYS.RETAINED, credit: v.gt(0) ? v : 0, debit: v.lt(0) ? v.abs() : 0, branchId: b }));

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: to,
        description: `Jurnal penutup tahun ${dto.year} (laba bersih ${net.toFixed(2)})`,
        sourceType: 'CLOSING',
        sourceId: String(dto.year),
        createdById: user.sub,
        lines: [...lines, ...retainedLines],
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

  async balances(tenantId: string, from?: string, to?: string, excludeClosing = false, db: DbOrTx = this.db, branchId?: string): Promise<BalanceRow[]> {
    const brCond = branchId ? (branchId === 'NONE' ? sql`AND l.branch_id IS NULL` : sql`AND l.branch_id = ${branchId}`) : sql``;
    const fromCond = from ? sql`AND j.date >= ${toDocDate(from)}` : sql``;
    const toCond = to ? sql`AND j.date <= ${toDocDate(to)}` : sql``;
    const closingCond = excludeClosing ? sql`AND j.source_type <> 'CLOSING'` : sql``;
    const res = await db.execute<{ id: string; code: string; name: string; type: AccountType; debit: string; credit: string }>(sql`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(t.debit, 0) AS debit, COALESCE(t.credit, 0) AS credit
      FROM accounts a
      LEFT JOIN (
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l
        JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} ${fromCond} ${toCond} ${closingCond} ${brCond}
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
