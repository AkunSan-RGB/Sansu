import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { WorkCenterDto, DowntimeDto, ShiftsDto, BomOpsDto, ScheduleDto, FinishOpDto, CorrectOpDto } from './work-centers.dto';
import { RangeQuery } from './work-centers.shared';
import { WorkCentersRepository } from './work-centers.repository';

const WIB_MS = 7 * 3600_000;

const toMin = (t: string) => (t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));

const OVERRUN = 1.5;

const num = (v: unknown) => Number(v ?? 0);

const dup = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');

@Injectable()
export class WorkCenterService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly repo: WorkCentersRepository,
  ) {}

  list(tenantId: string) {
    return this.repo.queryWorkCenterForList(this.db, tenantId);
  }

  async save(u: AuthUser, dto: WorkCenterDto, id?: string) {
    try {
      if (id) {
        const r = await this.repo.querySave(this.db, dto, id, u);
        if (!r.rows.length) throw new NotFoundException('Pusat kerja tidak ditemukan');
        await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WorkCenter', entityId: id, data: dto });
        return { id };
      }
      const r = await this.repo.queryWorkCenter(this.db, u, dto);
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WorkCenter', entityId: r.rows[0].id, data: dto });
      return { id: r.rows[0].id };
    } catch (e) {
      if (dup(e)) throw new BadRequestException('Kode pusat kerja sudah dipakai');
      throw e;
    }
  }

  downtimes(tenantId: string, workCenterId: string) {
    return this.repo.queryWorkCenterDowntimeForDowntimes(this.db, tenantId, workCenterId);
  }

  async addDowntime(u: AuthUser, workCenterId: string, dto: DowntimeDto) {
    const s = new Date(dto.startsAt);
    const e = new Date(dto.endsAt);
    if (e <= s) throw new BadRequestException('Waktu selesai harus setelah waktu mulai');
    await this.db.transaction(async (tx) => {
      await this.lockWc(tx, u.tenantId, workCenterId, false);
      await this.repo.queryWorkCenterDowntime(tx, u.tenantId, workCenterId, s, e, dto.reason, u.sub);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WorkCenterDowntime', entityId: workCenterId, data: dto });
    });
    // jadwal operasi yang kini bertabrakan dengan mesin mati dilaporkan di kontrol; tidak dibatalkan otomatis
    return { ok: true };
  }

  shifts(tenantId: string, workCenterId: string) {
    return this.repo.queryWorkCenterShiftForShifts(this.db, tenantId, workCenterId);
  }

  /** Kalender mingguan (menggantikan yang lama). Kosong = tanpa kalender. Shift pada hari yang sama tidak boleh saling tumpang tindih. */
  async setShifts(u: AuthUser, workCenterId: string, dto: ShiftsDto) {
    const rows = dto.shifts.map((x) => ({ weekday: x.weekday, s: toMin(x.start), e: toMin(x.end) }));
    for (const r of rows) if (r.s >= r.e) throw new BadRequestException('Jam selesai shift harus setelah jam mulai');
    for (let d = 1; d <= 7; d++) {
      const day = rows.filter((r) => r.weekday === d).sort((a, b) => a.s - b.s);
      for (let i = 1; i < day.length; i++) if (day[i].s < day[i - 1].e) throw new BadRequestException(`Shift hari ke-${d} saling tumpang tindih`);
    }
    await this.db.transaction(async (tx) => {
      await this.lockWc(tx, u.tenantId, workCenterId, false);
      await this.repo.queryWorkCenterShift(tx, workCenterId, u.tenantId);
      for (const r of rows) await this.repo.queryWorkCenterShiftForSetShifts(tx, u.tenantId, workCenterId, r.weekday, r.s, r.e);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WorkCenterShifts', entityId: workCenterId, data: { shifts: dto.shifts } });
    });
    return this.shifts(u.tenantId, workCenterId);
  }

  /** Apakah rentang berada di dalam satu shift (waktu Jakarta)? Tanpa kalender selalu benar. */
  private async withinShift(tx: DbOrTx, tenantId: string, workCenterId: string, s: Date, e: Date) {
    const cal = (await this.repo.queryWorkCenterShiftForWithinShift(tx, tenantId, workCenterId)).rows;
    if (!cal.length) return { hasCalendar: false, ok: true };
    const ls = new Date(s.getTime() + WIB_MS);
    const le = new Date(e.getTime() + WIB_MS);
    const sameDay = ls.toISOString().slice(0, 10) === new Date(e.getTime() - 1 + WIB_MS).toISOString().slice(0, 10);
    if (!sameDay) return { hasCalendar: true, ok: false };
    const weekday = ls.getUTCDay() === 0 ? 7 : ls.getUTCDay();
    const sm = ls.getUTCHours() * 60 + ls.getUTCMinutes();
    const em = (le.getUTCHours() * 60 + le.getUTCMinutes()) || 1440;
    return { hasCalendar: true, ok: cal.some((c) => Number(c.weekday) === weekday && sm >= c.start_minute && em <= c.end_minute) };
  }

  private async lockWc(tx: Tx, tenantId: string, id: string, mustBeActive = true) {
    const r = await this.repo.queryWorkCenterForLockWc(tx, id, tenantId);
    if (!r.rows.length) throw new BadRequestException('Pusat kerja tidak ditemukan');
    if (mustBeActive && !r.rows[0].is_active) throw new BadRequestException('Pusat kerja nonaktif');
    return r.rows[0];
  }

  bomOperations(tenantId: string, bomId: string) {
    return this.repo.queryBomOperationForBomOperations(this.db, tenantId, bomId);
  }

  async setBomOperations(u: AuthUser, bomId: string, dto: BomOpsDto) {
    await this.db.transaction(async (tx) => {
      const b = await this.repo.queryBom(tx, bomId, u.tenantId);
      if (!b.rows.length) throw new NotFoundException('Resep tidak ditemukan');
      const ids = [...new Set(dto.operations.map((o) => o.workCenterId))];
      if (ids.length) {
        const w = await this.repo.queryWorkCenterForSetBomOperations(tx, u.tenantId, ids);
        if (w.rows.length !== ids.length) throw new BadRequestException('Ada pusat kerja yang tidak ditemukan atau nonaktif');
      }
      await this.repo.queryBomOperation(tx, bomId);
      for (const [i, o] of dto.operations.entries()) {
        await this.repo.queryBomOperationForSetBomOperations(tx, u.tenantId, bomId, i, o.name, o.workCenterId, o.minutesPerBatch);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'BomOperations', entityId: bomId, data: { operations: dto.operations.length } });
    });
    return this.bomOperations(u.tenantId, bomId);
  }

  /** Menyalin operasi resep ke perintah produksi baru (dipanggil dalam transaksi pembuatan perintah) */
  async copyToOrder(tx: DbOrTx, tenantId: string, bomId: string, orderId: string, batches: number) {
    await this.repo.queryProductionOrderOperation(tx, orderId, batches, bomId, tenantId);
  }

  /** Biaya operasi perintah ini; null bila perintah tidak punya operasi. Semua operasi harus selesai. */
  async orderConversionCost(tx: DbOrTx, tenantId: string, orderId: string): Promise<{ labor: ReturnType<typeof D>; overhead: ReturnType<typeof D> } | null> {
    const r = await this.repo.queryProductionOrderOperationForOrderConversionCost(tx, tenantId, orderId);
    if (!r.rows.length) return null;
    const open = r.rows.filter((o) => o.status !== 'DONE');
    if (open.length) throw new BadRequestException(`Selesaikan dulu operasi: ${open.map((o) => o.name).join(', ')}`);
    return { labor: r.rows.reduce((a, o) => a.plus(o.labor_cost), D(0)), overhead: r.rows.reduce((a, o) => a.plus(o.overhead_cost), D(0)) };
  }

  async cancelOrderOps(tx: DbOrTx, tenantId: string, orderId: string) {
    await this.repo.queryCancelOrderOps(tx, tenantId, orderId);
  }

  orderOperations(tenantId: string, orderId: string) {
    return this.repo.queryProductionOrderOperationForOrderOperations(this.db, tenantId, orderId);
  }

  private async lockOp(tx: Tx, tenantId: string, id: string) {
    const r = await this.repo.queryProductionOrderOperationForLockOp(tx, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Operasi tidak ditemukan');
    return r.rows[0];
  }

  /** Operasi lain yang menempati pusat kerja pada rentang ini, serta jadwal mesin mati */
  private async clashes(tx: DbOrTx, tenantId: string, workCenterId: string, s: Date, e: Date, exceptOpId: string) {
    const ops = await this.repo.queryProductionOrderOperationForClashes(tx, tenantId, workCenterId, exceptOpId, e, s);
    const down = await this.repo.queryWorkCenterDowntimeForClashes(tx, tenantId, workCenterId, e, s);
    return [
      ...ops.rows.map((r) => ({ type: 'OPERASI', title: `${r.order_number} · ${r.name}`, startsAt: r.scheduled_start, endsAt: r.scheduled_end })),
      ...down.rows.map((r) => ({ type: 'MESIN_MATI', title: r.reason, startsAt: r.starts_at, endsAt: r.ends_at })),
    ];
  }

  async schedule(u: AuthUser, opId: string, dto: ScheduleDto) {
    const s = new Date(dto.startsAt);
    const e = new Date(dto.endsAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) throw new BadRequestException('Rentang waktu tidak valid');
    if (e.getTime() - s.getTime() > 7 * 86_400_000) throw new BadRequestException('Satu operasi paling lama 7 hari');
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (!['PENDING'].includes(op.status)) throw new BadRequestException('Hanya operasi yang belum dimulai yang dapat dijadwalkan');
      if (!['DRAFT', 'IN_PROGRESS'].includes(op.order_status)) throw new BadRequestException('Perintah produksi sudah selesai/batal');
      await this.lockWc(tx, u.tenantId, op.work_center_id);
      const shift = await this.withinShift(tx, u.tenantId, op.work_center_id, s, e);
      let offShift = false;
      if (shift.hasCalendar && !shift.ok) {
        const reason = (dto.offShiftReason ?? '').trim();
        if (!reason) throw new BadRequestException('Jadwal di luar shift pusat kerja ini (harus di dalam satu shift pada hari yang sama). Admin dapat mengizinkan dengan alasan.');
        if (u.role !== 'OWNER' && u.role !== 'ADMIN') throw new ForbiddenException('Hanya Admin/Pemilik yang dapat menjadwalkan di luar shift');
        if (reason.length < 5) throw new BadRequestException('Alasan di luar shift minimal 5 huruf');
        offShift = true;
      }
      const clash = await this.clashes(tx, u.tenantId, op.work_center_id, s, e, opId);
      if (clash.length) throw new ConflictException({ message: `Jadwal bentrok dengan ${clash.length} jadwal lain di pusat kerja ini`, conflicts: clash });
      // urutan: operasi tidak boleh mulai sebelum operasi sebelumnya (jadwal) selesai
      const prev = (await this.repo.queryProductionOrderOperationForSchedule(tx, op.order_id, op.sequence)).rows[0];
      if (prev?.scheduled_end && s < new Date(prev.scheduled_end)) throw new BadRequestException(`Operasi ini tidak boleh mulai sebelum "${prev.name}" selesai (${new Date(prev.scheduled_end).toISOString()})`);
      const next = (await this.repo.queryProductionOrderOperationForSchedule2(tx, op.order_id, op.sequence)).rows[0];
      if (next?.scheduled_start && e > new Date(next.scheduled_start)) throw new BadRequestException(`Operasi ini harus selesai sebelum "${next.name}" dimulai`);
      await this.repo.querySchedule(tx, s, e, offShift, opId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { scheduledStart: s, scheduledEnd: e, offShift, offShiftReason: offShift ? dto.offShiftReason : undefined } });
    });
    return { ok: true };
  }

  async unschedule(u: AuthUser, opId: string) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'PENDING') throw new BadRequestException('Hanya operasi yang belum dimulai');
      await this.repo.queryUnschedule(tx, opId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { unscheduled: true } });
    });
    return { ok: true };
  }

  async startOp(u: AuthUser, opId: string) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'PENDING') throw new BadRequestException('Operasi sudah dimulai atau selesai');
      if (op.order_status !== 'IN_PROGRESS') throw new BadRequestException('Mulai produksi (keluarkan bahan) dulu sebelum menjalankan operasi');
      const prev = (await this.repo.queryProductionOrderOperationForStartOp(tx, op.order_id, op.sequence)).rows[0];
      if (prev) throw new BadRequestException(`Selesaikan dulu operasi "${prev.name}"`);
      const wc = await this.lockWc(tx, u.tenantId, op.work_center_id);
      // satu pusat kerja hanya menjalankan satu operasi pada satu waktu
      const busy = (await this.repo.queryProductionOrderOperationForStartOp2(tx, wc.id, opId)).rows[0];
      if (busy) throw new ConflictException(`Pusat kerja ${wc.code} sedang menjalankan "${busy.name}"`);
      await this.repo.queryStartOp(tx, opId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'START', entity: 'ProductionOperation', entityId: opId, data: { name: op.name } });
    });
    return { ok: true };
  }

  async finishOp(u: AuthUser, opId: string, dto: FinishOpDto) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'RUNNING') throw new BadRequestException('Operasi belum dimulai atau sudah selesai');
      const elapsed = op.started_at ? Math.max(1, Math.round((Date.now() - new Date(op.started_at).getTime()) / 60_000)) : 1;
      const minutes = dto.actualMinutes ?? elapsed;
      const planned = num(op.planned_minutes);
      if (minutes > planned * OVERRUN && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Waktu aktual ${minutes} menit melebihi ${Math.round(OVERRUN * 100)}% dari rencana (${planned} menit); tulis penjelasannya`);
      if (dto.operatorEmployeeId) {
        const e = await this.repo.queryEmployee(tx, dto.operatorEmployeeId, u.tenantId);
        if (!e.rows.length) throw new BadRequestException('Operator tidak ditemukan');
      }
      const wc = (await this.repo.queryWorkCenterForFinishOp(tx, op.work_center_id)).rows[0];
      const hours = D(minutes).div(60);
      const labor = money(hours.times(wc.labor_rate));
      const overhead = money(hours.times(wc.overhead_rate));
      await this.repo.queryFinishOp(tx, minutes, labor, overhead, dto, u.sub, opId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'COMPLETE', entity: 'ProductionOperation', entityId: opId, data: { name: op.name, minutes, planned, labor: labor.toFixed(2), overhead: overhead.toFixed(2) } });
    });
    return { ok: true };
  }

  /** Koreksi menit aktual operasi yang sudah selesai (Admin, alasan wajib), selama perintah belum selesai */
  async correctOp(u: AuthUser, opId: string, dto: CorrectOpDto) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'DONE') throw new BadRequestException('Hanya operasi yang sudah selesai yang dapat dikoreksi');
      if (op.order_status === 'COMPLETED') throw new BadRequestException('Perintah produksi sudah selesai; biayanya sudah dijurnal');
      const wc = (await this.repo.queryWorkCenterForFinishOp(tx, op.work_center_id)).rows[0];
      const hours = D(dto.actualMinutes).div(60);
      const labor = money(hours.times(wc.labor_rate));
      const overhead = money(hours.times(wc.overhead_rate));
      await this.repo.queryCorrectOp(tx, dto.actualMinutes, labor, overhead, opId);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { before: op.actual_minutes, after: dto.actualMinutes, reason: dto.reason } });
    });
    return { ok: true };
  }

  /** Rincian biaya perintah: bahan per baris, tiap operasi, dan total */
  async costing(tenantId: string, orderId: string) {
    const o = (await this.repo.queryProductionOrder(this.db, orderId, tenantId)).rows[0];
    if (!o) throw new NotFoundException('Perintah produksi tidak ditemukan');
    const ops = (await this.orderOperations(tenantId, orderId)) as { plannedMinutes: string; actualMinutes: string | null; laborCost: string; overheadCost: string; status: string }[];
    const opLabor = ops.reduce((a, x) => a.plus(x.laborCost), D(0));
    const opOverhead = ops.reduce((a, x) => a.plus(x.overheadCost), D(0));
    return { order: o, operations: ops, operationsLabor: opLabor.toFixed(2), operationsOverhead: opOverhead.toFixed(2), plannedMinutes: ops.reduce((a, x) => a + num(x.plannedMinutes), 0), actualMinutes: ops.reduce((a, x) => a + num(x.actualMinutes), 0) };
  }

  async schedulePlan(tenantId: string, q: RangeQuery) {
    const from = q.from ?? addDays(todayJakarta(), -2);
    const to = q.to ?? addDays(todayJakarta(), 14);
    const r = await this.repo.queryProductionOrderOperationForSchedulePlan(this.db, tenantId, to, from, q);
    const down = await this.repo.queryWorkCenterDowntimeForSchedulePlan(this.db, tenantId, to, from);
    return { from, to, operations: r.rows, downtime: down.rows };
  }

  async controls(tenantId: string) {
    const q = async (t: ReturnType<typeof sql>) => (await this.repo.queryControls(this.db, t)).rows;
    // kapasitas harian: dari kalender shift bila ada (jumlah jam shift pada hari itu), selain itu kapasitas jam/hari
    const days = await q(sql`
      SELECT w.id AS wid, w.code, w.name, to_char((o.scheduled_start AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day, ROUND(SUM(EXTRACT(EPOCH FROM (o.scheduled_end - o.scheduled_start)) / 3600)::numeric, 1) AS hours, w.capacity_hours AS capacity
      FROM production_order_operations o JOIN work_centers w ON w.id = o.work_center_id
      WHERE o.tenant_id = ${tenantId} AND o.status IN ('PENDING', 'RUNNING') AND o.scheduled_start > now() - interval '2 days'
      GROUP BY w.id, w.code, w.name, w.capacity_hours, (o.scheduled_start AT TIME ZONE 'Asia/Jakarta')::date ORDER BY 3 LIMIT 200`);
    const cal = await q(sql`SELECT work_center_id AS wid, weekday, SUM(end_minute - start_minute)::int AS minutes FROM work_center_shifts WHERE tenant_id = ${tenantId} GROUP BY work_center_id, weekday`);
    const capOf = (wid: string, day: string, fallback: number) => {
      const mine = cal.filter((c) => c.wid === wid);
      if (!mine.length) return fallback;
      const wd = new Date(`${day}T12:00:00+07:00`).getUTCDay() || 7;
      return Number(mine.find((c) => Number(c.weekday) === wd)?.minutes ?? 0) / 60;
    };
    const overbooked = days.map((d) => ({ code: d.code, name: d.name, day: d.day, hours: d.hours, capacity: capOf(String(d.wid), String(d.day), Number(d.capacity)) })).filter((d) => Number(d.hours) > d.capacity).slice(0, 50);
    const offShift = await q(sql`SELECT p.number AS "orderNumber", o.name, w.code AS "workCenter", o.scheduled_start AS "scheduledStart" FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id JOIN work_centers w ON w.id = o.work_center_id WHERE o.tenant_id = ${tenantId} AND o.off_shift AND o.status IN ('PENDING', 'RUNNING') AND o.scheduled_end > now() ORDER BY o.scheduled_start LIMIT 50`);
    const late = await q(sql`SELECT o.id, o.name, p.number AS "orderNumber", w.code AS "workCenter", o.scheduled_end AS "scheduledEnd" FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id JOIN work_centers w ON w.id = o.work_center_id WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_end < now() ORDER BY o.scheduled_end LIMIT 50`);
    const overrun = await q(sql`SELECT p.number AS "orderNumber", o.name, o.planned_minutes AS planned, o.actual_minutes AS actual, o.note FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id WHERE o.tenant_id = ${tenantId} AND o.status = 'DONE' AND o.actual_minutes > o.planned_minutes * ${OVERRUN} AND o.finished_at > now() - interval '60 days' ORDER BY o.finished_at DESC LIMIT 50`);
    const downtimeClash = await q(sql`SELECT p.number AS "orderNumber", o.name, w.code AS "workCenter", d.reason FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id JOIN work_centers w ON w.id = o.work_center_id JOIN work_center_downtime d ON d.work_center_id = o.work_center_id AND d.starts_at < o.scheduled_end AND d.ends_at > o.scheduled_start WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_start IS NOT NULL AND o.scheduled_end > now() LIMIT 50`);
    const unscheduled = await q(sql`SELECT p.number AS "orderNumber", COUNT(*)::int AS operations FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_start IS NULL AND p.status IN ('DRAFT', 'IN_PROGRESS') AND p.created_at < now() - interval '1 day' GROUP BY p.number ORDER BY p.number LIMIT 50`);
    return { overbookedDays: overbooked, overdueNotStarted: late, overruns: overrun, scheduledDuringDowntime: downtimeClash, scheduledOffShift: offShift, unscheduledOrders: unscheduled };
  }

  /** Pemakaian pusat kerja: jam aktual dan biaya per pusat kerja dalam periode */
  async utilization(tenantId: string, q: RangeQuery) {
    const to = q.to ?? todayJakarta();
    const from = q.from ?? addDays(to, -30);
    const r = await this.repo.queryWorkCenterForUtilization(this.db, from, to, tenantId);
    return { from, to, rows: r.rows };
  }
}
