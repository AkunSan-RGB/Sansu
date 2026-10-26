import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { D, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { StatementsService } from '../accounting/statements.service';
import type { ScheduleResult } from './account-schedule.types';
import { AccountSchedulesService } from './account-schedules.service';
import { ReportSnapshotsRepository } from './report-snapshots.repository';

export interface SnapshotPayload {
  year: number;
  /** Periode (31 Desember tahun itu) sudah berakhir saat dibekukan */
  periodClosed: boolean;
  generatedAt: string;
  totals: { assets: string; liabilities: string; equity: string; netIncome: string };
  accounts: { accountId: string; code: string; name: string; type: string; reportGroup: string; kind: string; reported: string; computed: string; matches: boolean; detailHash: string }[];
  /** Rincian lengkap tiap akun saat dibekukan (tabel, metode, temuan), agar rincian yang ditandatangani dapat dibuka kembali */
  schedules: ScheduleResult[];
}

/** Hash deterministik atas isi snapshot (kunci diurutkan) untuk membuktikan isi tidak berubah */
export function hashPayload(p: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canon(p))).digest('hex');
}

const money = (d: { toFixed(n: number): string }) => d.toFixed(2);

/**
 * Pembekuan laporan keuangan per tahun saat ditandatangani: angka tiap akun dan total laporan disimpan sebagai rekaman yang tidak dapat
 * diubah (dijaga trigger database), lengkap dengan hash isi. Perbandingan dengan pembukuan terkini menampilkan selisih per akun dan
 * jurnal susulan yang dibukukan sesudah pembekuan.
 */
@Injectable()
export class ReportSnapshotsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: ReportSnapshotsRepository,
    private readonly schedules: AccountSchedulesService,
    private readonly statements: StatementsService,
    private readonly audit: AuditService,
  ) {}

  private async capture(tenantId: string, year: number): Promise<SnapshotPayload> {
    const to = `${year}-12-31`;
    const [results, position, income] = await Promise.all([this.schedules.allResults(tenantId, year), this.statements.financialPosition(tenantId, to), this.statements.income(tenantId, { from: `${year}-01-01`, to })]);
    const net = income.lines.find((l) => l.key === 'NET_PROFIT');
    return {
      year,
      periodClosed: to < todayJakarta(),
      generatedAt: new Date().toISOString(),
      totals: {
        assets: position.totals.assets.amount,
        liabilities: position.totals.liabilities.amount,
        equity: position.totals.equity.amount,
        netIncome: net?.amount ?? '0.00',
      },
      accounts: results.map((r) => ({ accountId: r.account.id, code: r.account.code, name: r.account.name, type: r.account.type, reportGroup: r.account.reportGroup, kind: r.kind, reported: r.reported, computed: r.computed, matches: r.matches, detailHash: hashPayload(r.tables) })),
      schedules: results,
    };
  }

  async freeze(user: AuthUser, year: number, note?: string) {
    if (year > Number(todayJakarta().slice(0, 4))) throw new BadRequestException('Tahun laporan belum berjalan');
    const payload = await this.capture(user.tenantId, year);
    const hash = hashPayload(payload);
    const name = await this.repo.userName(this.db, user.sub);
    try {
      return await this.db.transaction(async (tx) => {
        const version = (await this.repo.maxVersion(tx, user.tenantId, year)) + 1;
        const row = await this.repo.insert(tx, { tenantId: user.tenantId, year, version, signedById: user.sub, signedByName: name, note: note?.trim() || null, contentHash: hash, payload: payload as unknown as Record<string, unknown> });
        await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'FREEZE', entity: 'ReportSnapshot', entityId: row.id, data: { year, version, hash } });
        return { id: row.id, year, version, signedAt: row.signedAt, signedByName: name, contentHash: hash };
      });
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).cause?.code === '23505') throw new ConflictException('Pembekuan lain sedang berjalan; coba lagi');
      throw e;
    }
  }

  list(tenantId: string, year?: number) {
    return this.repo.list(this.db, tenantId, year);
  }

  /** Bandingkan snapshot yang dibekukan dengan pembukuan saat ini */
  async compare(tenantId: string, year: number, version?: number) {
    const snap = await this.repo.find(this.db, tenantId, year, version);
    if (!snap) throw new NotFoundException('Belum ada laporan yang dibekukan untuk tahun ini');
    const frozen = snap.payload as unknown as SnapshotPayload;
    const now = await this.capture(tenantId, year);
    const intact = hashPayload(frozen) === snap.contentHash;
    const byId = new Map(now.accounts.map((a) => [a.accountId, a]));
    const seen = new Set<string>();
    const rows = frozen.accounts.map((a) => {
      seen.add(a.accountId);
      const cur = byId.get(a.accountId);
      const delta = D(cur?.reported ?? 0).minus(a.reported);
      return { accountId: a.accountId, code: a.code, name: a.name, frozen: a.reported, current: cur?.reported ?? '0.00', delta: money(delta), detailChanged: !!cur && !!a.detailHash && cur.detailHash !== a.detailHash };
    });
    for (const a of now.accounts) if (!seen.has(a.accountId)) rows.push({ accountId: a.accountId, code: a.code, name: a.name, frozen: '0.00', current: a.reported, delta: money(D(a.reported)), detailChanged: true });
    const totals = (['assets', 'liabilities', 'equity', 'netIncome'] as const).map((k) => ({ key: k, frozen: frozen.totals[k], current: now.totals[k], delta: money(D(now.totals[k]).minus(frozen.totals[k])) }));
    const late = (await this.repo.lateJournals(this.db, tenantId, year, snap.signedAt)).rows;
    return {
      snapshot: { id: snap.id, year: snap.year, version: snap.version, signedByName: snap.signedByName, signedAt: snap.signedAt, note: snap.note, contentHash: snap.contentHash, periodClosed: frozen.periodClosed },
      /** false bila isi yang tersimpan tidak lagi sesuai hash (tidak seharusnya terjadi) */
      intact,
      unchanged: totals.every((t) => D(t.delta).isZero()) && rows.every((r) => D(r.delta).isZero() && !r.detailChanged),
      totals,
      accounts: rows.filter((r) => !D(r.delta).isZero() || r.detailChanged),
      accountsCompared: rows.length,
      /** Akun yang rinciannya tersimpan dan dapat dibuka dari pembekuan ini */
      frozenAccounts: frozen.accounts.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, kind: a.kind })),
      lateJournals: late.map((j) => ({ number: j.number, date: j.date, description: j.description, source: j.source_type, createdAt: j.created_at, total: j.total })),
      lateTotal: money(late.reduce((s, j) => s.plus(j.total), ZERO)),
    };
  }

  /** Rincian satu akun sebagaimana dibekukan (tabel, metode, dan temuan saat itu) */
  async frozenDetail(tenantId: string, year: number, accountId: string, version?: number): Promise<ScheduleResult & { snapshot: { version: number; signedAt: Date; signedByName: string } }> {
    const snap = await this.repo.find(this.db, tenantId, year, version);
    if (!snap) throw new NotFoundException('Belum ada laporan yang dibekukan untuk tahun ini');
    const stored = (snap.payload as unknown as SnapshotPayload).schedules;
    if (!stored) throw new NotFoundException('Pembekuan versi ini dibuat sebelum rincian akun ikut disimpan; bekukan versi baru untuk menyimpan rincian lengkap');
    const found = stored.find((r) => r.account.id === accountId);
    if (!found) throw new NotFoundException('Akun ini tidak ada pada laporan yang dibekukan');
    return { ...found, snapshot: { version: snap.version, signedAt: snap.signedAt, signedByName: snap.signedByName } };
  }
}
