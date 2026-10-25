import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CONTROL_PROFILES, REPORT_GROUPS } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, branches, warehouses } from '../../db/schema';
import { get as gets, loadAccounts, natural, unclosedEarnings, type Sum } from '../accounting/ledger-data';
import { SYS } from '../accounting/default-coa';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';
import { ReferenceRepository } from '../../db/reference.repository';

const NONE = 'NONE';

interface Cell {
  revenue: Dec;
  cost: Dec;
  opex: Dec;
  other: Dec;
}

const emptyCell = (): Cell => ({ revenue: ZERO, cost: ZERO, opex: ZERO, other: ZERO });

const fin = (c: Cell) => {
  const gross = c.revenue.minus(c.cost);
  const net = gross.minus(c.opex).plus(c.other);
  return { revenue: c.revenue.toFixed(2), costOfSales: c.cost.toFixed(2), grossProfit: gross.toFixed(2), operatingExpense: c.opex.toFixed(2), other: c.other.toFixed(2), netProfit: net.toFixed(2), margin: c.revenue.gt(0) ? net.div(c.revenue).times(100).toFixed(1) : null };
};

@Injectable()
export class BranchesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly refs: ReferenceRepository,
  ) {}

  async list(tenantId: string) {
    const rows = await this.db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.code));
    const whs = await this.db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, branchId: warehouses.branchId, isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.tenantId, tenantId)).orderBy(asc(warehouses.code));
    const cash = await this.db.select({ id: accounts.id, code: accounts.code, name: accounts.name, branchId: accounts.branchId }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.isCashAccount, true), eq(accounts.isPostable, true))).orderBy(asc(accounts.code));
    return { branches: rows.map((b) => ({ ...b, warehouses: whs.filter((w) => w.branchId === b.id) })), unassignedWarehouses: whs.filter((w) => !w.branchId && w.isActive), cashAccounts: cash };
  }

  async create(user: AuthUser, dto: CreateBranchDto) {
    const code = dto.code.trim().toUpperCase();
    const [dup] = await this.db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, user.tenantId), eq(branches.code, code)));
    if (dup) throw new BadRequestException(`Kode cabang ${code} sudah dipakai`);
    const [row] = await this.db.insert(branches).values({ tenantId: user.tenantId, code, name: dto.name.trim(), address: dto.address }).returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Branch', entityId: row.id, data: { code } });
    return row;
  }

  async update(user: AuthUser, id: string, dto: UpdateBranchDto) {
    const [b] = await this.db.select().from(branches).where(and(eq(branches.id, id), eq(branches.tenantId, user.tenantId)));
    if (!b) throw new NotFoundException('Cabang tidak ditemukan');
    if (dto.isActive === false && b.isActive) {
      const [n] = (await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM warehouses WHERE branch_id = ${id} AND is_active`)).rows;
      if (n.n > 0) throw new BadRequestException('Cabang masih punya gudang/toko aktif. Pindahkan atau nonaktifkan dulu.');
    }
    const [row] = await this.db.update(branches).set({ name: dto.name?.trim(), address: dto.address, isActive: dto.isActive }).where(eq(branches.id, id)).returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'Branch', entityId: id, data: { ...dto } });
    return row;
  }

  /** Gudang/toko milik cabang: transaksi berikutnya di gudang ini berlabel cabang itu. Riwayat tidak diubah (jurnal tidak bisa diubah). */
  async assignWarehouse(user: AuthUser, warehouseId: string, branchId: string | null) {
    const w = await this.refs.warehouse(this.db, user.tenantId, warehouseId);
    if (!w) throw new NotFoundException('Gudang tidak ditemukan');
    if (branchId) {
      const [b] = await this.db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, user.tenantId)));
      if (!b || !b.isActive) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
    }
    await this.db.update(warehouses).set({ branchId }).where(eq(warehouses.id, warehouseId));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'ASSIGN_BRANCH', entity: 'Warehouse', entityId: warehouseId, data: { from: w.branchId, to: branchId } });
    return { ok: true };
  }

  /** Nyalakan/matikan fitur cabang. Tidak bisa dimatikan selama masih ada cabang. */
  async setEnabled(user: AuthUser, enabled: boolean) {
    if (!enabled) {
      const [b] = await this.db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, user.tenantId)).limit(1);
      if (b) throw new BadRequestException('Fitur cabang tidak bisa dimatikan selama masih ada cabang. Nonaktifkan semua cabang lebih dulu atau biarkan menyala.');
    }
    await this.settings.saveSection(this.db, user.tenantId, 'branches', { enabled: false }, { enabled });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'BranchFeature', entityId: user.tenantId, data: { enabled } });
    return { enabled };
  }

  /** Rekening kas/bank milik cabang: transaksi lewat rekening ini otomatis berlabel cabang itu */
  async assignAccount(user: AuthUser, accountId: string, branchId: string | null) {
    const [a] = await this.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, user.tenantId), eq(accounts.isCashAccount, true)));
    if (!a) throw new NotFoundException('Rekening kas/bank tidak ditemukan');
    if (branchId) {
      const [b] = await this.db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, user.tenantId)));
      if (!b || !b.isActive) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
    }
    await this.db.update(accounts).set({ branchId }).where(eq(accounts.id, accountId));
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'ASSIGN_BRANCH', entity: 'Account', entityId: accountId, data: { code: a.code, from: a.branchId, to: branchId } });
    return { ok: true };
  }

  /** Laba rugi per cabang berdampingan; kolom "Gabungan" = laporan laba rugi seluruh perusahaan (konsolidasi) */
  async report(tenantId: string, fromIn?: string, toIn?: string) {
    const today = todayJakarta();
    const to = toIn ? toDocDate(toIn) : today;
    const from = fromIn ? toDocDate(fromIn) : `${to.slice(0, 7)}-01`;
    const accs = new Map((await loadAccounts(this.db, tenantId)).filter((a) => a.type === 'REVENUE' || a.type === 'EXPENSE').map((a) => [a.id, a]));
    const brs = await this.db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.code));
    const res = await this.db.execute<{ account_id: string; branch_id: string | null; d: string; c: string }>(sql`
      SELECT l.account_id, l.branch_id::text AS branch_id, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date >= ${from} AND j.date <= ${to} AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
      GROUP BY l.account_id, l.branch_id`);
    const cols = [...brs.map((b) => b.id), NONE];
    const cells = new Map<string, Cell>(cols.map((k) => [k, emptyCell()]));
    const lines = new Map<string, Map<string, Dec>>(); // akun → kolom → nilai natural
    for (const r of res.rows) {
      const a = accs.get(r.account_id);
      if (!a) continue;
      const key = r.branch_id && cells.has(r.branch_id) ? r.branch_id : NONE;
      const nat = a.type === 'REVENUE' ? D(r.c).minus(r.d) : D(r.d).minus(r.c);
      const cell = cells.get(key)!;
      const section = REPORT_GROUPS[a.reportGroup]?.section;
      if (a.type === 'REVENUE' && section === 'REVENUE') cell.revenue = cell.revenue.plus(nat);
      else if (a.type === 'EXPENSE' && section === 'COST_OF_SALES') cell.cost = cell.cost.plus(nat);
      else if (a.type === 'EXPENSE' && section === 'OPERATING_EXPENSE') cell.opex = cell.opex.plus(nat);
      else cell.other = cell.other.plus(a.type === 'REVENUE' ? nat : nat.negated()); // pendapatan lain + / beban lain −
      const m = lines.get(a.id) ?? new Map<string, Dec>();
      m.set(key, (m.get(key) ?? ZERO).plus(nat));
      lines.set(a.id, m);
    }
    const total = emptyCell();
    for (const c of cells.values()) {
      total.revenue = total.revenue.plus(c.revenue);
      total.cost = total.cost.plus(c.cost);
      total.opex = total.opex.plus(c.opex);
      total.other = total.other.plus(c.other);
    }
    const columns = [...brs.map((b) => ({ key: b.id, code: b.code, name: b.name })), { key: NONE, code: '-', name: 'Pusat / belum ditentukan' }];
    return {
      from,
      to,
      columns,
      summary: Object.fromEntries([...cells].map(([k, c]) => [k, fin(c)])),
      consolidated: fin(total),
      rows: [...lines]
        .map(([id, m]) => {
          const a = accs.get(id)!;
          const sum = [...m.values()].reduce<Dec>((s, v) => s.plus(v), ZERO);
          return { accountId: id, code: a.code, name: a.name, type: a.type, values: Object.fromEntries([...m].map(([k, v]) => [k, v.toFixed(2)])), total: sum.toFixed(2) };
        })
        .filter((r) => !D(r.total).isZero() || Object.values(r.values).some((v) => !D(v).isZero()))
        .sort((x, y) => x.code.localeCompare(y.code)),
    };
  }

  /**
   * Posisi keuangan (neraca) per cabang + gabungan. Tiap jurnal seimbang di dalam cabangnya (perpindahan barang antar-cabang
   * lewat Rekening Antar Cabang), jadi neraca tiap cabang seimbang. Kolom Gabungan = neraca perusahaan; Rekening Antar Cabang
   * saling menghapus (eliminasi) menjadi nol.
   */
  async balanceSheet(tenantId: string, asOfIn?: string) {
    const asOf = asOfIn ? toDocDate(asOfIn) : todayJakarta();
    const accs = (await loadAccounts(this.db, tenantId)).filter((a) => a.isPostable);
    const brs = await this.db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.code));
    const res = await this.db.execute<{ account_id: string; branch_id: string | null; d: string; c: string }>(sql`
      SELECT l.account_id, l.branch_id::text AS branch_id, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.date <= ${asOf}
      GROUP BY l.account_id, l.branch_id`);
    const keys = [...brs.map((b) => b.id), NONE];
    const bal = new Map<string, Map<string, Sum>>(keys.map((k) => [k, new Map()]));
    const all = new Map<string, Sum>();
    const addTo = (m: Map<string, Sum>, id: string, d: Dec, c: Dec) => {
      const cur = m.get(id) ?? { debit: ZERO, credit: ZERO };
      m.set(id, { debit: cur.debit.plus(d), credit: cur.credit.plus(c) });
    };
    for (const r of res.rows) {
      const key = r.branch_id && bal.has(r.branch_id) ? r.branch_id : NONE;
      addTo(bal.get(key)!, r.account_id, D(r.d), D(r.c));
      addTo(all, r.account_id, D(r.d), D(r.c));
    }
    const totals = (m: Map<string, Sum>) => {
      const sum = (type: 'ASSET' | 'LIABILITY' | 'EQUITY') => accs.filter((a) => a.type === type).reduce<Dec>((s, a) => s.plus(natural(a.type, gets(m, a.id))), ZERO);
      const assets = sum('ASSET');
      const liabilities = sum('LIABILITY');
      const earnings = unclosedEarnings(accs, m);
      const equity = sum('EQUITY').plus(earnings);
      return { assets: assets.toFixed(2), liabilities: liabilities.toFixed(2), equity: equity.toFixed(2), earnings: earnings.toFixed(2), balanced: assets.minus(liabilities.plus(equity)).abs().lt(0.005), difference: assets.minus(liabilities.plus(equity)).toFixed(2) };
    };
    const interbranch = accs.find((a) => a.systemKey === SYS.INTERBRANCH);
    const rakBy = (m: Map<string, Sum>) => (interbranch ? natural(interbranch.type, gets(m, interbranch.id)) : ZERO);
    const rows = accs
      .filter((a) => a.type !== 'REVENUE' && a.type !== 'EXPENSE')
      .map((a) => {
        const values: Record<string, string> = {};
        for (const k of keys) values[k] = natural(a.type, gets(bal.get(k)!, a.id)).toFixed(2);
        const total = natural(a.type, gets(all, a.id));
        return { accountId: a.id, code: a.code, name: a.name, type: a.type, values, total: total.toFixed(2), isInterbranch: a.id === interbranch?.id };
      })
      .filter((r) => !D(r.total).isZero() || Object.values(r.values).some((v) => !D(v).isZero()));
    const columns = [...brs.map((b) => ({ key: b.id, code: b.code, name: b.name })), { key: NONE, code: '-', name: 'Pusat / belum ditentukan' }];
    // perpindahan persediaan antar-cabang (nilai yang dieliminasi lewat Rekening Antar Cabang)
    const transfers = await this.db.execute<{ number: string; date: string; from_b: string | null; to_b: string | null; total: string }>(sql`
      SELECT t.number, t.date::text AS date, wf.branch_id::text AS from_b, wt.branch_id::text AS to_b, t.total_value AS total
      FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id
      WHERE t.tenant_id = ${tenantId} AND t.date <= ${asOf} AND wf.branch_id IS DISTINCT FROM wt.branch_id AND t.status <> 'CANCELLED'
      ORDER BY t.date DESC LIMIT 50`);
    const name = (id: string | null) => (id ? brs.find((b) => b.id === id)?.name ?? '-' : 'Pusat');
    return {
      asOf,
      columns,
      summary: Object.fromEntries(keys.map((k) => [k, totals(bal.get(k)!)])),
      consolidated: totals(all),
      interbranch: { byBranch: Object.fromEntries(keys.map((k) => [k, rakBy(bal.get(k)!).toFixed(2)])), net: rakBy(all).toFixed(2), eliminated: rakBy(all).abs().lt(0.005) },
      transfers: transfers.rows.map((r) => ({ number: r.number, date: r.date, from: name(r.from_b), to: name(r.to_b), total: D(r.total).toFixed(2) })),
      rows,
    };
  }

  /** Temuan kontrol per cabang (anti-fraud & kualitas data) */
  async controls(tenantId: string) {
    const items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] }[] = [];
    const add = (key: string, level: 'error' | 'warning' | 'info', title: string, refs: string[], detail: string) => {
      if (refs.length) items.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const brs = await this.db.select().from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));
    if (!brs.length) return { items };
    const today = todayJakarta();
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];
    const unassigned = await this.db.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true), sql`${warehouses.branchId} IS NULL`));
    add('WAREHOUSE_NO_BRANCH', 'warning', 'Gudang/toko belum masuk cabang mana pun', unassigned.map((w) => `${w.code} ${w.name}`), 'Transaksi di gudang ini tidak berlabel cabang sehingga masuk "Pusat / belum ditentukan". Atur di Pengaturan › Cabang.');
    const rep90 = await this.report(tenantId, addDays(today, -90), today);
    const co = rep90.consolidated;
    const coMargin = Number(co.revenue) > 0 ? (Number(co.netProfit) / Number(co.revenue)) * 100 : null;
    const unNet = rep90.summary[NONE];
    if (Number(co.revenue) > 0 && Number(unNet.revenue) / Number(co.revenue) > 0.2) {
      add('UNLABELED_REVENUE', 'info', 'Pendapatan banyak yang belum berlabel cabang', [`${((Number(unNet.revenue) / Number(co.revenue)) * 100).toFixed(0)}% pendapatan 90 hari terakhir`], 'Periksa gudang tanpa cabang dan transaksi kas/jurnal manual yang belum diberi cabang.');
    }
    const low: string[] = [];
    const neg: string[] = [];
    for (const b of brs) {
      const s = rep90.summary[b.id];
      if (!s || Number(s.revenue) <= 0) continue;
      if (Number(s.netProfit) < 0) neg.push(`${b.code} ${b.name}`);
      else if (coMargin !== null && s.margin !== null && Number(s.margin) < coMargin - cp.branchMarginGapPts) low.push(`${b.code} ${b.name} (margin ${s.margin}% vs rata-rata ${coMargin.toFixed(1)}%)`);
    }
    add('BRANCH_LOSS', 'warning', 'Cabang merugi (90 hari)', neg, 'Biaya cabang melebihi pendapatannya. Tinjau biaya dan kemungkinan pendapatan yang belum tercatat.');
    add('BRANCH_LOW_MARGIN', 'info', 'Margin cabang jauh di bawah rata-rata', low, `Margin laba bersih lebih dari ${cp.branchMarginGapPts} poin di bawah rata-rata perusahaan.`);
    const act = await this.db.execute<{ id: string }>(sql`
      SELECT DISTINCT l.branch_id::text AS id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.type = 'REVENUE' AND l.branch_id IS NOT NULL AND j.date >= ${addDays(today, -cp.branchNoSalesDays)} AND j.source_type <> 'CLOSING'`);
    const active = new Set(act.rows.map((r) => r.id));
    const firstTx = await this.db.execute<{ id: string }>(sql`SELECT DISTINCT branch_id::text AS id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND branch_id IS NOT NULL AND j.date < ${addDays(today, -cp.branchNoSalesDays)}`);
    const hadHistory = new Set(firstTx.rows.map((r) => r.id));
    add('BRANCH_NO_SALES', 'warning', `Cabang tanpa pendapatan ${cp.branchNoSalesDays} hari terakhir`, brs.filter((b) => hadHistory.has(b.id) && !active.has(b.id)).map((b) => `${b.code} ${b.name}`), 'Cabang yang biasanya berjualan tiba-tiba tanpa pendapatan: periksa apakah penjualan tidak dicatat.');
    const bs = await this.balanceSheet(tenantId, today);
    if (!bs.interbranch.eliminated) add('INTERBRANCH_NOT_ZERO', 'error', 'Rekening Antar Cabang tidak nol saat digabung', [`selisih Rp${Math.abs(Number(bs.interbranch.net)).toLocaleString('id-ID')}`], 'Seharusnya nol karena transaksi antar-cabang saling menghapus. Periksa jurnal yang memakai akun ini.');
    const off = Object.entries(bs.summary).filter(([, v]) => !v.balanced).map(([k, v]) => `${k === NONE ? 'Pusat' : (brs.find((b) => b.id === k)?.code ?? k)} (selisih Rp${Math.abs(Number(v.difference)).toLocaleString('id-ID')})`);
    add('BRANCH_BS_UNBALANCED', 'error', 'Neraca cabang tidak seimbang', off, 'Aset tidak sama dengan kewajiban + ekuitas pada cabang ini; periksa jurnal lintas-cabang.');
    const rank = { error: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.level] - rank[b.level]);
    return { items };
  }
}
