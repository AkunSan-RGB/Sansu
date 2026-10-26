import { Injectable, NotFoundException } from '@nestjs/common';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { loadAccounts, type AccountMeta } from '../accounting/ledger-data';
import { ScheduleRegistry } from './account-schedule.registry';
import { emptyMovement, money } from './account-schedule.support';
import type { AccountMovement, ScheduleBody, ScheduleCatalog, ScheduleContext, ScheduleResult } from './account-schedule.types';
import { AccountSchedulesRepository } from './account-schedules.repository';
import { FinancingContractsRepository } from './financing-contracts.repository';
import { ReportedBalanceService, type ReportedBalances } from './reported-balances.service';
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
    private readonly contractsRepo: FinancingContractsRepository,
    private readonly registry: ScheduleRegistry,
    private readonly reportedBalances: ReportedBalanceService,
  ) {}

  private async snapshot(tenantId: string, year: number): Promise<Snapshot> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [accounts, rows, categories, banks, contracts] = await Promise.all([
      loadAccounts(this.db, tenantId),
      this.repo.movementsByAccountMonth(this.db, tenantId, from, to).then((r) => r.rows),
      this.repo.listAssetCategories(this.db, tenantId),
      this.repo.bankStatementAccountIds(this.db, tenantId).then((r) => r.rows.map((x) => x.id)),
      this.contractsRepo.list(this.db, tenantId),
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
      contractAccountIds: {
        LOAN: new Set(contracts.filter((c) => c.kind === 'LOAN').map((c) => c.accountId)),
        LEASE: new Set(contracts.filter((c) => c.kind === 'LEASE').map((c) => c.accountId)),
        PREPAID: new Set(contracts.filter((c) => c.kind === 'PREPAID').map((c) => c.accountId)),
      },
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

  private async run(tenantId: string, s: Snapshot, account: AccountMeta) {
    const schedule = this.registry.resolve(account, s.catalog);
    const body = await schedule.build(this.context(tenantId, s, account));
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
  private active(s: Snapshot, a: AccountMeta) {
    const r = s.reported.byAccount.get(a.id);
    if (r && !r.isZero()) return true;
    // akun dengan kontrak terdaftar selalu ditampilkan: kontrak tanpa pembukuan adalah temuan
    const k = s.catalog.contractAccountIds;
    if (k.LOAN.has(a.id) || k.LEASE.has(a.id) || k.PREPAID.has(a.id)) return true;
    const m = s.movementOf(a.id);
    return !m.openingDebit.isZero() || !m.openingCredit.isZero() || m.months.some((x) => !x.debit.isZero() || !x.credit.isZero());
  }

  /** Seluruh rincian akun untuk satu tahun dari satu pengambilan data (dasar daftar ringkasan dan pembekuan laporan) */
  async allResults(tenantId: string, year: number): Promise<ScheduleResult[]> {
    const s = await this.snapshot(tenantId, year);
    const candidates = [...s.accounts.filter((a) => a.isPostable && this.active(s, a)), ...(s.reported.unclosedEarnings.isZero() ? [] : [UNCLOSED_META])];
    const out: ScheduleResult[] = [];
    for (const account of candidates) {
      const { schedule, body, reported } = await this.run(tenantId, s, account);
      out.push(this.result(s, account, schedule.kind, body, reported));
    }
    return out;
  }

  async overview(tenantId: string, year: number) {
    const results = await this.allResults(tenantId, year);
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
    const { schedule, body, reported } = await this.run(tenantId, s, account);
    return this.result(s, account, schedule.kind, body, reported);
  }
}
