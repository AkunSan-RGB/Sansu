import { BUDGET_SUGGESTED_CODES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { ApprovalsService, type ApprovalKind } from '../../common/approvals/approvals.service';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { MailService } from '../../common/mail/mail.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, budgetAlerts, budgetLines, budgets, users } from '../../db/schema';
import { SaveBudgetDto, SeedBudgetDto, BudgetRowDto } from './budget.dto';
import { patchById } from '../../db/owned';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export type RowStatus = 'OK' | 'WARN' | 'OVER' | 'UNBUDGETED' | 'SHORT';

@Injectable()
export class BudgetService {
  private readonly logger = new Logger('Anggaran');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
  ) {}

  /** Akun pendapatan & beban yang boleh dianggarkan */
  private plAccounts(tenantId: string) {
    return this.db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.isPostable, true), inArray(accounts.type, ['REVENUE', 'EXPENSE'])))
      .orderBy(accounts.code);
  }

  private async find(tenantId: string, year: number) {
    const [b] = await this.db.select().from(budgets).where(and(eq(budgets.tenantId, tenantId), eq(budgets.year, year)));
    return b;
  }

  /** Akun yang disarankan masuk anggaran untuk jenis usaha perusahaan (hanya yang ada & aktif di bagan akun) */
  async suggested(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    const accs = await this.plAccounts(tenantId);
    const codes = BUDGET_SUGGESTED_CODES[model];
    return { model, accountIds: accs.filter((a) => codes.includes(a.code)).map((a) => a.id) };
  }

  /** Anggaran + isian per akun (12 bulan) untuk layar penyusunan */
  async get(tenantId: string, year: number) {
    const budget = await this.find(tenantId, year);
    const accs = await this.plAccounts(tenantId);
    const lines = budget ? await this.db.select().from(budgetLines).where(eq(budgetLines.budgetId, budget.id)) : [];
    const grid = new Map<string, string[]>();
    for (const l of lines) {
      const arr = grid.get(l.accountId) ?? Array(12).fill('0');
      arr[l.month - 1] = D(l.amount).toFixed(2);
      grid.set(l.accountId, arr);
    }
    return { budget: budget ?? null, accounts: accs, rows: [...grid].map(([accountId, months]) => ({ accountId, months })) };
  }

  async save(user: AuthUser, year: number, dto: SaveBudgetDto) {
    const accs = new Map((await this.plAccounts(user.tenantId)).map((a) => [a.id, a]));
    const seen = new Set<string>();
    for (const r of dto.rows) {
      if (!accs.has(r.accountId)) throw new BadRequestException('Anggaran hanya untuk akun pendapatan dan beban yang aktif');
      if (seen.has(r.accountId)) throw new BadRequestException('Satu akun hanya boleh satu baris');
      seen.add(r.accountId);
      if (r.months.some((m) => D(m).isNegative())) throw new BadRequestException('Nilai anggaran tidak boleh negatif');
    }
    await this.db.transaction(async (tx) => {
      let [b] = await tx.select().from(budgets).where(and(eq(budgets.tenantId, user.tenantId), eq(budgets.year, year))).for('update');
      if (b?.status === 'APPROVED') throw new BadRequestException('Anggaran sudah disetujui dan terkunci. Minta Pemilik/Admin membukanya dulu (dengan alasan).');
      if (!b) {
        [b] = await tx.insert(budgets).values({ tenantId: user.tenantId, year, name: dto.name?.trim() || `Anggaran ${year}`, createdById: user.sub, tolerancePct: dto.tolerancePct ?? 10 }).returning();
      } else {
        await patchById(tx, budgets, b.id, { name: dto.name?.trim() || b.name, tolerancePct: dto.tolerancePct ?? b.tolerancePct });
      }
      await tx.delete(budgetLines).where(eq(budgetLines.budgetId, b.id));
      const values = dto.rows.flatMap((r) => r.months.map((m, i) => ({ tenantId: user.tenantId, budgetId: b.id, accountId: r.accountId, month: i + 1, amount: money(m).toFixed(2) }))).filter((v) => D(v.amount).gt(0));
      for (let i = 0; i < values.length; i += 500) await tx.insert(budgetLines).values(values.slice(i, i + 500));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'Budget', entityId: b.id, data: { year, accounts: dto.rows.length } });
    });
    return this.get(user.tenantId, year);
  }

  /** Isi anggaran otomatis dari realisasi tahun lain × (1 + kenaikan%) — hanya saat belum disetujui */
  async seed(user: AuthUser, year: number, dto: SeedBudgetDto) {
    const actual = await this.actualByMonth(user.tenantId, dto.fromYear);
    const accs = await this.plAccounts(user.tenantId);
    const factor = D(1).plus(D(dto.growthPct).div(100));
    const rows: BudgetRowDto[] = [];
    for (const a of accs) {
      const months = MONTHS.map((m) => {
        const v = actual.get(`${a.id}:${m}`) ?? { debit: ZERO, credit: ZERO };
        const nat = a.type === 'REVENUE' ? v.credit.minus(v.debit) : v.debit.minus(v.credit);
        return money(nat.gt(0) ? nat.times(factor) : ZERO).toFixed(2);
      });
      if (months.some((m) => D(m).gt(0))) rows.push({ accountId: a.id, months });
    }
    if (!rows.length) throw new BadRequestException(`Tidak ada realisasi pendapatan/beban pada ${dto.fromYear} untuk dijadikan dasar`);
    return this.save(user, year, { rows });
  }

  async approve(user: AuthUser, year: number) {
    await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(budgets).where(and(eq(budgets.tenantId, user.tenantId), eq(budgets.year, year))).for('update');
      if (!b) throw new NotFoundException('Anggaran belum dibuat');
      if (b.status === 'APPROVED') throw new BadRequestException('Anggaran sudah disetujui');
      // pemisahan tugas: penyusun tidak menyetujui sendiri (kecuali Pemilik)
      if (b.createdById === user.sub && user.role !== 'OWNER') throw new ForbiddenException('Anggaran harus disetujui orang lain (Pemilik atau Admin lain)');
      const [n] = (await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM budget_lines WHERE budget_id = ${b.id}`)).rows;
      if (!n.n) throw new BadRequestException('Anggaran masih kosong');
      await patchById(tx, budgets, b.id, { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'APPROVE', entity: 'Budget', entityId: b.id, data: { year } });
    });
    return this.get(user.tenantId, year);
  }

  async reopen(user: AuthUser, year: number, reason: string) {
    await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(budgets).where(and(eq(budgets.tenantId, user.tenantId), eq(budgets.year, year))).for('update');
      if (!b) throw new NotFoundException('Anggaran belum dibuat');
      if (b.status !== 'APPROVED') throw new BadRequestException('Anggaran belum disetujui');
      await patchById(tx, budgets, b.id, { status: 'DRAFT', approvedById: null, approvedAt: null });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'REOPEN', entity: 'Budget', entityId: b.id, data: { year, reason: reason.trim() } });
    });
    return this.get(user.tenantId, year);
  }

  /** Realisasi per akun per bulan (jurnal penutup tahun tidak dihitung) */
  private async actualByMonth(tenantId: string, year: number) {
    const res = await this.db.execute<{ account_id: string; m: number; d: string; c: string }>(sql`
      SELECT l.account_id, EXTRACT(MONTH FROM j.date)::int AS m, SUM(l.debit) AS d, SUM(l.credit) AS c
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date >= ${`${year}-01-01`} AND j.date <= ${`${year}-12-31`}
        AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
      GROUP BY l.account_id, EXTRACT(MONTH FROM j.date)`);
    return new Map(res.rows.map((r) => [`${r.account_id}:${r.m}`, { debit: D(r.d), credit: D(r.c) }]));
  }

  /** Anggaran vs realisasi sampai bulan `month` (bawaan: bulan berjalan bila tahun ini, atau 12) */
  async report(tenantId: string, year: number, monthIn?: number) {
    const today = todayJakarta();
    const through = monthIn ?? (Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : 12);
    if (through < 1 || through > 12) throw new BadRequestException('Bulan tidak valid');
    const budget = await this.find(tenantId, year);
    const accs = await this.plAccounts(tenantId);
    const lines = budget ? await this.db.select().from(budgetLines).where(eq(budgetLines.budgetId, budget.id)) : [];
    const bud = new Map<string, Dec>();
    for (const l of lines) bud.set(`${l.accountId}:${l.month}`, D(l.amount));
    const act = await this.actualByMonth(tenantId, year);
    const tol = (budget?.tolerancePct ?? 10) / 100;

    const rows = accs.map((a) => {
      const b = (m: number) => bud.get(`${a.id}:${m}`) ?? ZERO;
      const x = (m: number) => {
        const v = act.get(`${a.id}:${m}`) ?? { debit: ZERO, credit: ZERO };
        return a.type === 'REVENUE' ? v.credit.minus(v.debit) : v.debit.minus(v.credit);
      };
      const sum = (f: (m: number) => Dec, upTo: number) => MONTHS.filter((m) => m <= upTo).reduce<Dec>((s, m) => s.plus(f(m)), ZERO);
      const budgetYtd = sum(b, through);
      const actualYtd = sum(x, through);
      const budgetYear = sum(b, 12);
      // selisih menguntungkan = positif: pendapatan melebihi anggaran, atau beban di bawah anggaran
      const variance = a.type === 'REVENUE' ? actualYtd.minus(budgetYtd) : budgetYtd.minus(actualYtd);
      let status: RowStatus = 'OK';
      if (budget) {
        if (a.type === 'EXPENSE') {
          if (budgetYear.isZero() && actualYtd.gt(0)) status = 'UNBUDGETED';
          else if (budgetYtd.gt(0) && actualYtd.gt(budgetYtd.times(1 + tol))) status = 'OVER';
          else if (budgetYear.gt(0) && through < 12 && actualYtd.gte(budgetYear.times(0.9))) status = 'WARN';
        } else if (budgetYtd.gt(0) && actualYtd.lt(budgetYtd.times(1 - tol))) status = 'SHORT';
      }
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        budgetMonth: b(through).toFixed(2),
        actualMonth: x(through).toFixed(2),
        budgetYtd: budgetYtd.toFixed(2),
        actualYtd: actualYtd.toFixed(2),
        budgetYear: budgetYear.toFixed(2),
        variance: variance.toFixed(2),
        variancePct: budgetYtd.gt(0) ? variance.div(budgetYtd).times(100).toFixed(1) : null,
        // proyeksi setahun bila laju realisasi bertahan
        forecastYear: through > 0 ? actualYtd.div(through).times(12).toFixed(2) : '0.00',
        status,
      };
    }).filter((r) => D(r.budgetYear).gt(0) || D(r.actualYtd).gt(0));

    const total = (type: 'REVENUE' | 'EXPENSE', k: 'budgetYtd' | 'actualYtd' | 'budgetYear') => rows.filter((r) => r.type === type).reduce<Dec>((s, r) => s.plus(r[k]), ZERO);
    const totals = {
      revenue: { budgetYtd: total('REVENUE', 'budgetYtd').toFixed(2), actualYtd: total('REVENUE', 'actualYtd').toFixed(2), budgetYear: total('REVENUE', 'budgetYear').toFixed(2) },
      expense: { budgetYtd: total('EXPENSE', 'budgetYtd').toFixed(2), actualYtd: total('EXPENSE', 'actualYtd').toFixed(2), budgetYear: total('EXPENSE', 'budgetYear').toFixed(2) },
      profit: {
        budgetYtd: total('REVENUE', 'budgetYtd').minus(total('EXPENSE', 'budgetYtd')).toFixed(2),
        actualYtd: total('REVENUE', 'actualYtd').minus(total('EXPENSE', 'actualYtd')).toFixed(2),
        budgetYear: total('REVENUE', 'budgetYear').minus(total('EXPENSE', 'budgetYear')).toFixed(2),
      },
    };
    return { year, month: through, budget: budget ?? null, rows, totals, alerts: rows.filter((r) => r.status !== 'OK') };
  }

  /**
   * Gerbang belanja terhadap anggaran. Hanya untuk beban yang akan dicatat (kas keluar, tagihan biaya, jurnal manual).
   * Bila realisasi + transaksi ini melewati anggaran s.d. bulan itu + toleransi: APPROVAL = staf menunggu persetujuan;
   * BLOCK = ditolak, hanya Pemilik yang dapat menembus dengan alasan (tercatat). Akun tanpa anggaran tidak diblokir (hanya diperingatkan di laporan).
   */
  async guard(
    user: AuthUser,
    items: { accountId: string; amount: Dec; date: string }[],
    ctx: { kind: ApprovalKind; title: string; payload: Record<string, unknown>; approved?: boolean; overrideReason?: string },
  ) {
    if (ctx.approved || !items.length) return;
    const mode = (await this.approvals.policy(this.db, user.tenantId)).budgetControl ?? 'OFF';
    if (mode === 'OFF') return;
    const ids = [...new Set(items.map((i) => i.accountId))];
    const exp = await this.db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, ids), eq(accounts.type, 'EXPENSE')));
    if (!exp.length) return;
    const expIds = new Map(exp.map((a) => [a.id, a]));
    const byYear = new Map<number, typeof items>();
    for (const i of items.filter((x) => expIds.has(x.accountId))) byYear.set(Number(i.date.slice(0, 4)), [...(byYear.get(Number(i.date.slice(0, 4))) ?? []), i]);
    const over: { code: string; name: string; budget: string; actual: string; amount: string }[] = [];
    for (const [year, list] of byYear) {
      const b = await this.find(user.tenantId, year);
      if (!b || b.status !== 'APPROVED') continue;
      const lines = await this.db.select().from(budgetLines).where(eq(budgetLines.budgetId, b.id));
      const act = await this.actualByMonth(user.tenantId, year);
      const tol = 1 + b.tolerancePct / 100;
      for (const id of new Set(list.map((x) => x.accountId))) {
        const mine = list.filter((x) => x.accountId === id);
        const through = Math.max(...mine.map((x) => Number(x.date.slice(5, 7))));
        const amount = mine.reduce<Dec>((s, x) => s.plus(x.amount), ZERO);
        const budgetYear = lines.filter((l) => l.accountId === id).reduce<Dec>((s, l) => s.plus(l.amount), ZERO);
        if (budgetYear.isZero()) continue; // tanpa anggaran: tidak diblokir
        const budgetYtd = lines.filter((l) => l.accountId === id && l.month <= through).reduce<Dec>((s, l) => s.plus(l.amount), ZERO);
        const actualYtd = MONTHS.filter((m) => m <= through).reduce<Dec>((s, m) => {
          const v = act.get(`${id}:${m}`);
          return v ? s.plus(v.debit.minus(v.credit)) : s;
        }, ZERO);
        if (actualYtd.plus(amount).gt(budgetYtd.times(tol))) {
          const a = expIds.get(id)!;
          over.push({ code: a.code, name: a.name, budget: budgetYtd.toFixed(2), actual: actualYtd.toFixed(2), amount: amount.toFixed(2) });
        }
      }
    }
    if (!over.length) return;
    const rp = (v: string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
    const detail = over.map((o) => `${o.code} ${o.name}: anggaran s.d. bulan ini ${rp(o.budget)}, realisasi ${rp(o.actual)}, transaksi ini ${rp(o.amount)}`).join('; ');
    const approver = this.approvals.isApprover(user.role);
    if (mode === 'BLOCK') {
      if (user.role === 'OWNER' && (ctx.overrideReason?.trim().length ?? 0) >= 10) {
        await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'BUDGET_OVERRIDE', entity: 'Budget', entityId: user.tenantId, data: { over, reason: ctx.overrideReason!.trim(), title: ctx.title } });
        return;
      }
      throw new BadRequestException({ statusCode: 400, code: 'BUDGET_EXCEEDED', message: `Melebihi anggaran: ${detail}.${user.role === 'OWNER' ? ' Isi alasan (min. 10 karakter) untuk menembus sebagai Pemilik.' : ' Hubungi Pemilik atau revisi anggaran.'}`, over });
    }
    // APPROVAL
    if (approver) {
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'BUDGET_OVERRIDE', entity: 'Budget', entityId: user.tenantId, data: { over, title: ctx.title } });
      return;
    }
    const total = items.reduce<Dec>((s, x) => s.plus(x.amount), ZERO);
    const req = await this.approvals.create(this.db, user, { kind: ctx.kind, refId: null, title: `${ctx.title} (melebihi anggaran)`, amount: total.toNumber(), payload: ctx.payload });
    throw this.approvals.required(req.id, `Transaksi ini melewati anggaran (${detail}); permintaan dikirim ke pemilik atau admin dan diproses setelah disetujui.`);
  }

  async alertAll() {
    const year = Number(todayJakarta().slice(0, 4));
    const list = await this.db.select().from(budgets).where(and(eq(budgets.year, year), eq(budgets.status, 'APPROVED')));
    for (const b of list) {
      try {
        await this.alertTenant(b.tenantId, b.id, year);
      } catch (e) {
        this.logger.warn(`Peringatan anggaran gagal untuk ${b.tenantId}: ${(e as Error).message}`);
      }
    }
  }

  /** Kirim peringatan hanya untuk akun yang BARU melewati batas bulan ini (tidak berulang) */
  async alertTenant(tenantId: string, budgetId: string, year: number) {
    const rep = await this.report(tenantId, year);
    const fresh: typeof rep.alerts = [];
    for (const r of rep.alerts) {
      if (r.status === 'SHORT') continue; // kekurangan pendapatan hanya tampil di laporan
      const ins = await this.db.insert(budgetAlerts).values({ tenantId, budgetId, accountId: r.accountId, month: rep.month, level: r.status }).onConflictDoNothing().returning({ id: budgetAlerts.id });
      if (ins.length) fresh.push(r);
    }
    if (!fresh.length) return 0;
    const rp = (v: string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
    const label = { OVER: 'melebihi anggaran', WARN: 'hampir habis (≥90% anggaran setahun)', UNBUDGETED: 'tanpa anggaran' } as const;
    const lines = fresh.map((r) => `• ${r.code} ${r.name}: ${label[r.status as 'OVER' | 'WARN' | 'UNBUDGETED']} — realisasi ${rp(r.actualYtd)} dari anggaran ${rp(r.budgetYtd)}`);
    const to = await this.db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])));
    await this.telegram.notifyUsers(to.map((t) => t.id), `⚠️ Peringatan anggaran ${year}\n${lines.join('\n')}`);
    for (const t of to) {
      void this.mail.send({ to: t.email, subject: `Peringatan anggaran ${year}: ${fresh.length} akun perlu ditinjau`, heading: 'Peringatan anggaran', paragraphs: lines, footnote: 'Buka SANSU › Akuntansi › Anggaran vs realisasi untuk rinciannya.' });
    }
    return fresh.length;
  }
}

@Injectable()
export class BudgetScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Anggaran');
  constructor(private readonly svc: BudgetService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.svc.alertAll().catch((e) => this.logger.error(e));
    setTimeout(run, 120_000).unref();
    this.timer = setInterval(run, 12 * 60 * 60_000); // dua kali sehari; idempoten
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
