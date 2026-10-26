import { Injectable, NotFoundException } from '@nestjs/common';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { loadAccounts, type AccountMeta } from '../accounting/ledger-data';
import { ScheduleRegistry } from './account-schedule.registry';
import { emptyMovement, money } from './account-schedule.support';
import type { AccountMovement, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleResult } from './account-schedule.types';
import { AccountSchedulesRepository } from './account-schedules.repository';
import { ReportedBalanceService, type ReportedBalances } from './reported-balances.service';
import { documentTables, SKIP_DOCUMENT_TABLES } from './schedules/document-tables';
import { UNCLOSED_EARNINGS_ID } from './schedules/unclosed-earnings.schedule';

export interface ScheduleOverviewItem {
  accountId: string;
  code: string;
  name: string;
  type: string;
  reportGroup: string;
  kind: string;
  title: string;
  reported: string;
  computed: string;
  difference: string;
  matches: boolean;
  needsDefinition: boolean;
  findings: number;
}

const TOLERANCE = D('0.005');

const UNCLOSED_META: AccountMeta = {
  id: UNCLOSED_EARNINGS_ID,
  code: '',
  name: 'Laba (rugi) belum ditutup ke saldo laba',
  type: 'EQUITY',
  parentId: null,
  isPostable: true,
  systemKey: null,
  isCashAccount: false,
  reportGroup: 'RETAINED_EARNINGS',
  fiscalTreatment: 'NORMAL',
};

/** Data bersama satu permintaan: akun, mutasi buku besar per bulan, katalog aset, dan angka laporan keuangan */
interface Snapshot {
  year: number;
  from: string;
  to: string;
  accounts: AccountMeta[];
  catalog: ScheduleCatalog;
  reported: ReportedBalances;
  movementOf(accountId: string): AccountMovement;
}

/**
 * Rincian & perhitungan setiap akun yang tampil di laporan keuangan (neraca maupun laba rugi), dicocokkan dengan
 * saldo akhir akun itu di laporan. Jenis jadwal per akun ditentukan ScheduleRegistry, sehingga akun baru otomatis punya jadwal.
 */
@Injectable()
export class AccountSchedulesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: AccountSchedulesRepository,
    private readonly registry: ScheduleRegistry,
    private readonly reportedBalances: ReportedBalanceService,
  ) {}

  private async snapshot(tenantId: string, year: number): Promise<Snapshot> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [accounts, rows, categories, banks] = await Promise.all([
      loadAccounts(this.db, tenantId),
      this.repo.movementsByAccountMonth(this.db, tenantId, from, to).then((r) => r.rows),
      this.repo.listAssetCategories(this.db, tenantId),
      this.repo.bankStatementAccountIds(this.db, tenantId).then((r) => r.rows.map((x) => x.id)),
    ]);
    const moves = new Map<string, AccountMovement>();
    for (const r of rows) {
      const m = moves.get(r.account_id) ?? emptyMovement();
      if (r.m === 0) {
        m.openingDebit = D(r.d);
        m.openingCredit = D(r.c);
      } else {
        m.months[r.m - 1] = { debit: D(r.d), credit: D(r.c) };
      }
      moves.set(r.account_id, m);
    }
    const typeById = new Map(accounts.map((a) => [a.id, a.type]));
    const catalog: ScheduleCatalog = {
      assetCostIds: new Set(categories.map((c) => c.assetAccountId)),
      assetAccumulatedIds: new Set(categories.flatMap((c) => (c.accumulatedAccountId ? [c.accumulatedAccountId] : []))),
      assetExpenseIds: new Set(categories.flatMap((c) => (c.expenseAccountId ? [c.expenseAccountId] : []))),
      bankAccountIds: new Set([...banks, ...accounts.filter((a) => a.systemKey === 'BANK').map((a) => a.id)]),
    };
    const reported = await this.reportedBalances.forYear(tenantId, year, (id) => typeById.get(id));
    return { year, from, to, accounts, catalog, reported, movementOf: (id) => moves.get(id) ?? emptyMovement() };
  }

  private context(tenantId: string, s: Snapshot, account: AccountMeta): ScheduleContext {
    return { tenantId, year: s.year, from: s.from, to: s.to, account, accounts: s.accounts, movement: s.movementOf(account.id), movementOf: s.movementOf };
  }

  private reportedOf(s: Snapshot, account: AccountMeta): Dec {
    return account.id === UNCLOSED_EARNINGS_ID ? s.reported.unclosedEarnings : (s.reported.byAccount.get(account.id) ?? ZERO);
  }

  private async run(tenantId: string, s: Snapshot, account: AccountMeta, withDocuments = false) {
    const schedule = this.registry.resolve(account, s.catalog);
    const cx = this.context(tenantId, s, account);
    const body = await schedule.build(cx);
    // daftar dan rincian dari dokumen sumber (kecuali jadwal yang sudah berupa kartu pembantu sendiri)
    if (withDocuments && !SKIP_DOCUMENT_TABLES.has(schedule.kind)) body.tables.push(...(await documentTables(this.db, this.repo, cx)));
    return { schedule, body, reported: this.reportedOf(s, account) };
  }

  private result(s: Snapshot, account: AccountMeta, kind: string, body: ScheduleBody, reported: Dec): ScheduleResult {
    const difference = reported.minus(body.closing);
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, reportGroup: account.reportGroup },
      kind,
      title: body.title,
      year: s.year,
      period: { from: s.from, to: s.to },
      method: body.method,
      tables: body.tables,
      reported: money(reported),
      computed: money(body.closing),
      difference: money(difference),
      matches: difference.abs().lt(TOLERANCE),
      findings: body.findings ?? [],
      needsDefinition: !!body.needsDefinition,
    };
  }

  /** Akun yang punya angka: saldo di laporan, saldo menurut buku, atau mutasi tahun ini */
  private active(s: Snapshot, a: AccountMeta, includeEmpty: boolean) {
    const r = s.reported.byAccount.get(a.id);
    if (r && !r.isZero()) return true;
    const m = s.movementOf(a.id);
    // akun yang aktif di bagan akun (relevan untuk jenis usaha ini) boleh ditampilkan walau masih kosong; akun yang dinonaktifkan karena tidak relevan tidak
    if (includeEmpty && a.isActive !== false) return true;
    return !m.openingDebit.isZero() || !m.openingCredit.isZero() || m.months.some((x) => !x.debit.isZero() || !x.credit.isZero());
  }

  /** Seluruh rincian akun untuk satu tahun dari satu pengambilan data (dasar daftar ringkasan dan pembekuan laporan) */
  async allResults(tenantId: string, year: number, includeEmpty = false): Promise<ScheduleResult[]> {
    const s = await this.snapshot(tenantId, year);
    const candidates = [...s.accounts.filter((a) => a.isPostable && this.active(s, a, includeEmpty)), ...(s.reported.unclosedEarnings.isZero() ? [] : [UNCLOSED_META])];
    const out: ScheduleResult[] = [];
    for (const account of candidates) {
      const { schedule, body, reported } = await this.run(tenantId, s, account);
      out.push(this.result(s, account, schedule.kind, body, reported));
    }
    return out;
  }

  /**
   * Daftar tab satu-akun-satu-tab: setiap akun yang dipakai jenis usaha ini (akun aktif di bagan akun) ditambah akun yang
   * kebetulan punya saldo/mutasi, neraca lalu laba rugi menurut kode. Akun baru otomatis muncul; isi tab dibangun saat dibuka.
   */
  async tabs(tenantId: string, year: number) {
    const s = await this.snapshot(tenantId, year);
    const pick = (a: AccountMeta) => a.isPostable && this.active(s, a, true);
    const items = [...s.accounts.filter(pick), ...(s.reported.unclosedEarnings.isZero() ? [] : [UNCLOSED_META])].map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      part: a.type === 'REVENUE' || a.type === 'EXPENSE' ? ('PL' as const) : ('BS' as const),
      reportGroup: a.reportGroup,
      hasActivity: this.active(s, a, false),
    }));
    const order = (i: { part: string; code: string }) => `${i.part === 'BS' ? 0 : 1}${i.code || '9'}`;
    return { year, items: items.sort((x, y) => order(x).localeCompare(order(y), 'en', { numeric: true })) };
  }

  async overview(tenantId: string, year: number, includeEmpty = false) {
    const results = await this.allResults(tenantId, year, includeEmpty);
    const items: ScheduleOverviewItem[] = results.map((r) => ({
      accountId: r.account.id,
      code: r.account.code,
      name: r.account.name,
      type: r.account.type,
      reportGroup: r.account.reportGroup,
      kind: r.kind,
      title: r.title,
      reported: r.reported,
      computed: r.computed,
      difference: r.difference,
      matches: r.matches,
      needsDefinition: r.needsDefinition,
      findings: r.findings.length,
    }));
    return {
      year,
      period: { from: `${year}-01-01`, to: `${year}-12-31` },
      summary: {
        accounts: items.length,
        matched: items.filter((i) => i.matches).length,
        unmatched: items.filter((i) => !i.matches).length,
        needsDefinition: items.filter((i) => i.needsDefinition).length,
      },
      items,
    };
  }

  async detail(tenantId: string, year: number, accountId: string): Promise<ScheduleResult> {
    const s = await this.snapshot(tenantId, year);
    const account = accountId === UNCLOSED_EARNINGS_ID ? UNCLOSED_META : s.accounts.find((a) => a.id === accountId && a.isPostable);
    if (!account) throw new NotFoundException('Akun tidak ditemukan');
    const { schedule, body, reported } = await this.run(tenantId, s, account, true);
    return this.result(s, account, schedule.kind, body, reported);
  }
}
