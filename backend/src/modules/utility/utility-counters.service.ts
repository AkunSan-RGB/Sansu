import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { COUNTER_CHANNEL_LABELS, type CounterChannel } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { CloseDayDto, CounterDto } from './utility-counters.dto';
import { UtilityCountersRepository } from './utility-counters.repository';

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const label = (c: string) => COUNTER_CHANNEL_LABELS[c as CounterChannel] ?? (c === 'CASH' ? 'Tunai' : c);

/**
 * Loket penerimaan di beberapa lokasi. Penerimaan loket non-tunai (transfer, QRIS, virtual account, EDC, dompet digital) langsung masuk
 * rekening bank; rekap harian per loket dicek Keuangan terhadap mutasi bank, oleh orang yang bukan penerimanya.
 */
@Injectable()
export class UtilityCountersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: UtilityCountersRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.repo.list(this.db, tenantId);
  }

  async save(u: AuthUser, dto: CounterDto, id?: string) {
    if (dto.bankAccountId) {
      const [a] = await this.repo.bankAccount(this.db, u.tenantId, dto.bankAccountId);
      if (!a || !a.isCashAccount) throw new BadRequestException('Rekening penerima harus akun kas/bank');
    }
    const set = { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), location: dto.location?.trim() || null, bankAccountId: dto.bankAccountId ?? null, ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }) };
    try {
      const [row] = id ? await this.repo.update(this.db, u.tenantId, id, set) : await this.repo.insert(this.db, { tenantId: u.tenantId, ...set });
      if (!row) throw new NotFoundException('Loket tidak ditemukan');
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'UtilityCounter', entityId: row.id, data: set });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new BadRequestException('Kode loket sudah dipakai');
      throw e;
    }
  }

  /** Rekap penerimaan per hari dan per loket (beserta kanal dan status konfirmasi) dalam rentang tanggal */
  async recap(tenantId: string, fromIn?: string, toIn?: string) {
    const to = isDate(toIn) ? toIn! : todayJakarta();
    const from = isDate(fromIn) ? fromIn! : addDays(to, -6);
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh setelah tanggal akhir');
    const [rows, closings] = await Promise.all([this.repo.recap(this.db, tenantId, from, to).then((r) => r.rows), this.repo.closings(this.db, tenantId, from, to)]);
    const closingOf = new Map(closings.map((c) => [`${c.counterId}|${c.date}`, c]));
    type Cell = { counterId: string | null; code: string; name: string; count: number; total: ReturnType<typeof D>; channels: Record<string, { label: string; count: number; total: string }>; closing: { status: string; note: string | null; decidedAt: string } | null };
    const days = new Map<string, Map<string, Cell>>();
    for (const r of rows) {
      const day = days.get(r.date) ?? new Map<string, Cell>();
      const key = r.counter_id ?? 'NONE';
      const cell = day.get(key) ?? { counterId: r.counter_id, code: r.code ?? '-', name: r.name ?? 'Tanpa loket (data lama)', count: 0, total: D(0), channels: {}, closing: null };
      cell.count += r.n;
      cell.total = cell.total.plus(r.total);
      cell.channels[r.channel] = { label: label(r.channel), count: r.n, total: D(r.total).toFixed(2) };
      const c = r.counter_id ? closingOf.get(`${r.counter_id}|${r.date}`) : undefined;
      if (c) cell.closing = { status: c.status, note: c.note, decidedAt: c.decidedAt.toISOString() };
      day.set(key, cell);
      days.set(r.date, day);
    }
    const out = [...days.entries()].map(([date, m]) => {
      const counters = [...m.values()].map((c) => ({ ...c, total: c.total.toFixed(2) }));
      return { date, counters, total: counters.reduce((s, c) => s.plus(c.total), D(0)).toFixed(2), count: counters.reduce((s, c) => s + c.count, 0) };
    });
    return { from, to, days: out, total: out.reduce((s, d) => s.plus(d.total), D(0)).toFixed(2), count: out.reduce((s, d) => s + d.count, 0) };
  }

  async dayDetail(tenantId: string, date: string, counterId?: string) {
    if (!isDate(date)) throw new BadRequestException('Tanggal tidak valid');
    return (await this.repo.dayDetail(this.db, tenantId, date, counterId)).rows.map((r) => ({ ...r, channelLabel: label(r.channel) }));
  }

  /** Konfirmasi rekap satu loket pada satu hari: dicek terhadap mutasi bank oleh orang yang bukan penerima pembayaran hari itu */
  async closeDay(u: AuthUser, dto: CloseDayDto) {
    const date = toDocDate(dto.date);
    if (date > todayJakarta()) throw new BadRequestException('Rekap hari yang belum tiba tidak bisa dikonfirmasi');
    if (dto.dispute && (dto.note ?? '').trim().length < 5) throw new BadRequestException('Rekap berselisih: tulis catatan (minimal 5 huruf)');
    return this.db.transaction(async (tx) => {
      const [counter] = await this.repo.byId(tx, u.tenantId, dto.counterId);
      if (!counter) throw new NotFoundException('Loket tidak ditemukan');
      const collectors = (await this.repo.dayCollectors(tx, u.tenantId, dto.counterId, date)).rows;
      if (!collectors.length) throw new BadRequestException('Tidak ada penerimaan di loket ini pada tanggal itu');
      if (collectors.some((c) => c.collector_id === u.sub) && u.role !== 'OWNER') throw new ForbiddenException('Rekap harus dikonfirmasi orang lain dari penerima pembayaran (pemisahan fungsi)');
      const total = collectors.reduce((s, c) => s.plus(c.total), D(0));
      const count = collectors.reduce((s, c) => s + c.n, 0);
      try {
        const [row] = await this.repo.insertClosing(tx, { tenantId: u.tenantId, counterId: dto.counterId, date, receiptCount: count, total: money(total).toFixed(2), status: dto.dispute ? 'DISPUTED' : 'CONFIRMED', decidedById: u.sub, note: dto.note?.trim() || null });
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.dispute ? 'REJECT' : 'APPROVE', entity: 'UtilityCounterClosing', entityId: row.id, data: { counter: counter.code, date, total: row.total, count } });
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new BadRequestException('Rekap loket ini pada tanggal itu sudah dikonfirmasi');
        throw e;
      }
    });
  }
}
