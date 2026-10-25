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

const WIB_MS = 7 * 3600_000;

const toMin = (t: string) => (t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const OVERRUN = 1.5;

const num = (v: unknown) => Number(v ?? 0);

const dup = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');

type Op = { id: string; order_id: string; sequence: number; name: string; work_center_id: string; planned_minutes: string; actual_minutes: string | null; status: string; started_at: Date | null; scheduled_start: Date | null; scheduled_end: Date | null; labor_cost: string; overhead_cost: string };

@Injectable()
export class WorkCenterService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.execute(sql`SELECT id, code, name, kind, labor_rate AS "laborRate", overhead_rate AS "overheadRate", capacity_hours AS "capacityHours", is_active AS "isActive" FROM work_centers WHERE tenant_id = ${tenantId} ORDER BY code`).then((r) => r.rows);
  }

  async save(u: AuthUser, dto: WorkCenterDto, id?: string) {
    try {
      if (id) {
        const r = await this.db.execute(sql`UPDATE work_centers SET code = ${dto.code.trim()}, name = ${dto.name.trim()}, kind = ${dto.kind ?? 'MACHINE'}, labor_rate = ${dto.laborRate}, overhead_rate = ${dto.overheadRate}, capacity_hours = ${dto.capacityHours ?? 8}, is_active = ${dto.isActive ?? true} WHERE id = ${id} AND tenant_id = ${u.tenantId} RETURNING id`);
        if (!r.rows.length) throw new NotFoundException('Pusat kerja tidak ditemukan');
        await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WorkCenter', entityId: id, data: dto });
        return { id };
      }
      const r = await this.db.execute<{ id: string }>(sql`INSERT INTO work_centers (tenant_id, code, name, kind, labor_rate, overhead_rate, capacity_hours) VALUES (${u.tenantId}, ${dto.code.trim()}, ${dto.name.trim()}, ${dto.kind ?? 'MACHINE'}, ${dto.laborRate}, ${dto.overheadRate}, ${dto.capacityHours ?? 8}) RETURNING id`);
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WorkCenter', entityId: r.rows[0].id, data: dto });
      return { id: r.rows[0].id };
    } catch (e) {
      if (dup(e)) throw new BadRequestException('Kode pusat kerja sudah dipakai');
      throw e;
    }
  }

  downtimes(tenantId: string, workCenterId: string) {
    return this.db.execute(sql`SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", reason FROM work_center_downtime WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId} AND ends_at > now() - interval '30 days' ORDER BY starts_at`).then((r) => r.rows);
  }

  async addDowntime(u: AuthUser, workCenterId: string, dto: DowntimeDto) {
    const s = new Date(dto.startsAt);
    const e = new Date(dto.endsAt);
    if (e <= s) throw new BadRequestException('Waktu selesai harus setelah waktu mulai');
    await this.db.transaction(async (tx) => {
      await this.lockWc(tx, u.tenantId, workCenterId, false);
      await tx.execute(sql`INSERT INTO work_center_downtime (tenant_id, work_center_id, starts_at, ends_at, reason, created_by_id) VALUES (${u.tenantId}, ${workCenterId}, ${s.toISOString()}, ${e.toISOString()}, ${dto.reason}, ${u.sub})`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WorkCenterDowntime', entityId: workCenterId, data: dto });
    });
    // jadwal operasi yang kini bertabrakan dengan mesin mati dilaporkan di kontrol; tidak dibatalkan otomatis
    return { ok: true };
  }

  shifts(tenantId: string, workCenterId: string) {
    return this.db.execute(sql`SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute" FROM work_center_shifts WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId} ORDER BY weekday, start_minute`).then((r) => r.rows.map((x) => ({ weekday: Number(x.weekday), start: hhmm(Number(x.startMinute)), end: hhmm(Number(x.endMinute)) })));
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
      await tx.execute(sql`DELETE FROM work_center_shifts WHERE work_center_id = ${workCenterId} AND tenant_id = ${u.tenantId}`);
      for (const r of rows) await tx.execute(sql`INSERT INTO work_center_shifts (tenant_id, work_center_id, weekday, start_minute, end_minute) VALUES (${u.tenantId}, ${workCenterId}, ${r.weekday}, ${r.s}, ${r.e})`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WorkCenterShifts', entityId: workCenterId, data: { shifts: dto.shifts } });
    });
    return this.shifts(u.tenantId, workCenterId);
  }

  /** Apakah rentang berada di dalam satu shift (waktu Jakarta)? Tanpa kalender selalu benar. */
  private async withinShift(tx: DbOrTx, tenantId: string, workCenterId: string, s: Date, e: Date) {
    const cal = (await tx.execute<{ weekday: number; start_minute: number; end_minute: number }>(sql`SELECT weekday, start_minute, end_minute FROM work_center_shifts WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId}`)).rows;
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
    const r = await tx.execute<{ id: string; is_active: boolean; labor_rate: string; overhead_rate: string; code: string }>(sql`SELECT id, is_active, labor_rate, overhead_rate, code FROM work_centers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new BadRequestException('Pusat kerja tidak ditemukan');
    if (mustBeActive && !r.rows[0].is_active) throw new BadRequestException('Pusat kerja nonaktif');
    return r.rows[0];
  }

  bomOperations(tenantId: string, bomId: string) {
    return this.db.execute(sql`SELECT o.id, o.sequence, o.name, o.work_center_id AS "workCenterId", w.code AS "workCenterCode", w.name AS "workCenterName", o.minutes_per_batch AS "minutesPerBatch" FROM bom_operations o JOIN work_centers w ON w.id = o.work_center_id WHERE o.tenant_id = ${tenantId} AND o.bom_id = ${bomId} ORDER BY o.sequence`).then((r) => r.rows);
  }

  async setBomOperations(u: AuthUser, bomId: string, dto: BomOpsDto) {
    await this.db.transaction(async (tx) => {
      const b = await tx.execute(sql`SELECT 1 FROM boms WHERE id = ${bomId} AND tenant_id = ${u.tenantId}`);
      if (!b.rows.length) throw new NotFoundException('Resep tidak ditemukan');
      const ids = [...new Set(dto.operations.map((o) => o.workCenterId))];
      if (ids.length) {
        const w = await tx.execute(sql`SELECT id FROM work_centers WHERE tenant_id = ${u.tenantId} AND is_active AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
        if (w.rows.length !== ids.length) throw new BadRequestException('Ada pusat kerja yang tidak ditemukan atau nonaktif');
      }
      await tx.execute(sql`DELETE FROM bom_operations WHERE bom_id = ${bomId}`);
      for (const [i, o] of dto.operations.entries()) {
        await tx.execute(sql`INSERT INTO bom_operations (tenant_id, bom_id, sequence, name, work_center_id, minutes_per_batch) VALUES (${u.tenantId}, ${bomId}, ${i + 1}, ${o.name.trim()}, ${o.workCenterId}, ${o.minutesPerBatch})`);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'BomOperations', entityId: bomId, data: { operations: dto.operations.length } });
    });
    return this.bomOperations(u.tenantId, bomId);
  }

  /** Menyalin operasi resep ke perintah produksi baru (dipanggil dalam transaksi pembuatan perintah) */
  async copyToOrder(tx: DbOrTx, tenantId: string, bomId: string, orderId: string, batches: number) {
    await tx.execute(sql`INSERT INTO production_order_operations (tenant_id, order_id, sequence, name, work_center_id, planned_minutes) SELECT tenant_id, ${orderId}::uuid, sequence, name, work_center_id, ROUND(minutes_per_batch * ${batches}::numeric, 2) FROM bom_operations WHERE bom_id = ${bomId} AND tenant_id = ${tenantId}`);
  }

  /** Biaya operasi perintah ini; null bila perintah tidak punya operasi. Semua operasi harus selesai. */
  async orderConversionCost(tx: DbOrTx, tenantId: string, orderId: string): Promise<{ labor: ReturnType<typeof D>; overhead: ReturnType<typeof D> } | null> {
    const r = await tx.execute<{ status: string; labor_cost: string; overhead_cost: string; name: string }>(sql`SELECT status, labor_cost, overhead_cost, name FROM production_order_operations WHERE tenant_id = ${tenantId} AND order_id = ${orderId} AND status <> 'CANCELLED' ORDER BY sequence`);
    if (!r.rows.length) return null;
    const open = r.rows.filter((o) => o.status !== 'DONE');
    if (open.length) throw new BadRequestException(`Selesaikan dulu operasi: ${open.map((o) => o.name).join(', ')}`);
    return { labor: r.rows.reduce((a, o) => a.plus(o.labor_cost), D(0)), overhead: r.rows.reduce((a, o) => a.plus(o.overhead_cost), D(0)) };
  }

  async cancelOrderOps(tx: DbOrTx, tenantId: string, orderId: string) {
    await tx.execute(sql`UPDATE production_order_operations SET status = 'CANCELLED' WHERE tenant_id = ${tenantId} AND order_id = ${orderId} AND status IN ('PENDING', 'RUNNING')`);
  }

  orderOperations(tenantId: string, orderId: string) {
    return this.db.execute(sql`
      SELECT o.id, o.sequence, o.name, o.work_center_id AS "workCenterId", w.code AS "workCenterCode", w.name AS "workCenterName", o.planned_minutes AS "plannedMinutes", o.actual_minutes AS "actualMinutes",
             o.status, o.started_at AS "startedAt", o.finished_at AS "finishedAt", o.scheduled_start AS "scheduledStart", o.scheduled_end AS "scheduledEnd", o.labor_cost AS "laborCost", o.overhead_cost AS "overheadCost", o.note
      FROM production_order_operations o JOIN work_centers w ON w.id = o.work_center_id WHERE o.tenant_id = ${tenantId} AND o.order_id = ${orderId} ORDER BY o.sequence`).then((r) => r.rows);
  }

  private async lockOp(tx: Tx, tenantId: string, id: string) {
    const r = await tx.execute<Op & { order_status: string }>(sql`SELECT o.*, p.status AS order_status FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id WHERE o.id = ${id} AND o.tenant_id = ${tenantId} FOR UPDATE OF o`);
    if (!r.rows.length) throw new NotFoundException('Operasi tidak ditemukan');
    return r.rows[0];
  }

  /** Operasi lain yang menempati pusat kerja pada rentang ini, serta jadwal mesin mati */
  private async clashes(tx: DbOrTx, tenantId: string, workCenterId: string, s: Date, e: Date, exceptOpId: string) {
    const ops = await tx.execute<{ id: string; name: string; order_number: string; scheduled_start: Date; scheduled_end: Date }>(sql`
      SELECT o.id, o.name, p.number AS order_number, o.scheduled_start, o.scheduled_end FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id
      WHERE o.tenant_id = ${tenantId} AND o.work_center_id = ${workCenterId} AND o.id <> ${exceptOpId} AND o.status IN ('PENDING', 'RUNNING') AND o.scheduled_start IS NOT NULL
        AND o.scheduled_start < ${e.toISOString()}::timestamptz AND o.scheduled_end > ${s.toISOString()}::timestamptz ORDER BY o.scheduled_start`);
    const down = await tx.execute<{ reason: string; starts_at: Date; ends_at: Date }>(sql`SELECT reason, starts_at, ends_at FROM work_center_downtime WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId} AND starts_at < ${e.toISOString()}::timestamptz AND ends_at > ${s.toISOString()}::timestamptz`);
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
      const prev = (await tx.execute<{ name: string; scheduled_end: Date | null }>(sql`SELECT name, scheduled_end FROM production_order_operations WHERE order_id = ${op.order_id} AND sequence < ${op.sequence} AND status <> 'CANCELLED' ORDER BY sequence DESC LIMIT 1`)).rows[0];
      if (prev?.scheduled_end && s < new Date(prev.scheduled_end)) throw new BadRequestException(`Operasi ini tidak boleh mulai sebelum "${prev.name}" selesai (${new Date(prev.scheduled_end).toISOString()})`);
      const next = (await tx.execute<{ name: string; scheduled_start: Date | null }>(sql`SELECT name, scheduled_start FROM production_order_operations WHERE order_id = ${op.order_id} AND sequence > ${op.sequence} AND status <> 'CANCELLED' AND scheduled_start IS NOT NULL ORDER BY sequence LIMIT 1`)).rows[0];
      if (next?.scheduled_start && e > new Date(next.scheduled_start)) throw new BadRequestException(`Operasi ini harus selesai sebelum "${next.name}" dimulai`);
      await tx.execute(sql`UPDATE production_order_operations SET scheduled_start = ${s.toISOString()}, scheduled_end = ${e.toISOString()}, off_shift = ${offShift} WHERE id = ${opId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { scheduledStart: s, scheduledEnd: e, offShift, offShiftReason: offShift ? dto.offShiftReason : undefined } });
    });
    return { ok: true };
  }

  async unschedule(u: AuthUser, opId: string) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'PENDING') throw new BadRequestException('Hanya operasi yang belum dimulai');
      await tx.execute(sql`UPDATE production_order_operations SET scheduled_start = NULL, scheduled_end = NULL, off_shift = false WHERE id = ${opId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { unscheduled: true } });
    });
    return { ok: true };
  }

  async startOp(u: AuthUser, opId: string) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'PENDING') throw new BadRequestException('Operasi sudah dimulai atau selesai');
      if (op.order_status !== 'IN_PROGRESS') throw new BadRequestException('Mulai produksi (keluarkan bahan) dulu sebelum menjalankan operasi');
      const prev = (await tx.execute<{ name: string; status: string }>(sql`SELECT name, status FROM production_order_operations WHERE order_id = ${op.order_id} AND sequence < ${op.sequence} AND status NOT IN ('DONE', 'CANCELLED') LIMIT 1`)).rows[0];
      if (prev) throw new BadRequestException(`Selesaikan dulu operasi "${prev.name}"`);
      const wc = await this.lockWc(tx, u.tenantId, op.work_center_id);
      // satu pusat kerja hanya menjalankan satu operasi pada satu waktu
      const busy = (await tx.execute<{ name: string }>(sql`SELECT name FROM production_order_operations WHERE work_center_id = ${wc.id} AND status = 'RUNNING' AND id <> ${opId} LIMIT 1`)).rows[0];
      if (busy) throw new ConflictException(`Pusat kerja ${wc.code} sedang menjalankan "${busy.name}"`);
      await tx.execute(sql`UPDATE production_order_operations SET status = 'RUNNING', started_at = now() WHERE id = ${opId}`);
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
        const e = await tx.execute(sql`SELECT 1 FROM employees WHERE id = ${dto.operatorEmployeeId} AND tenant_id = ${u.tenantId}`);
        if (!e.rows.length) throw new BadRequestException('Operator tidak ditemukan');
      }
      const wc = (await tx.execute<{ labor_rate: string; overhead_rate: string }>(sql`SELECT labor_rate, overhead_rate FROM work_centers WHERE id = ${op.work_center_id}`)).rows[0];
      const hours = D(minutes).div(60);
      const labor = money(hours.times(wc.labor_rate));
      const overhead = money(hours.times(wc.overhead_rate));
      await tx.execute(sql`UPDATE production_order_operations SET status = 'DONE', actual_minutes = ${minutes}, finished_at = now(), labor_cost = ${labor.toFixed(2)}, overhead_cost = ${overhead.toFixed(2)}, note = ${dto.note ?? null}, operator_employee_id = ${dto.operatorEmployeeId ?? null}, finished_by_id = ${u.sub} WHERE id = ${opId}`);
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
      const wc = (await tx.execute<{ labor_rate: string; overhead_rate: string }>(sql`SELECT labor_rate, overhead_rate FROM work_centers WHERE id = ${op.work_center_id}`)).rows[0];
      const hours = D(dto.actualMinutes).div(60);
      const labor = money(hours.times(wc.labor_rate));
      const overhead = money(hours.times(wc.overhead_rate));
      await tx.execute(sql`UPDATE production_order_operations SET actual_minutes = ${dto.actualMinutes}, labor_cost = ${labor.toFixed(2)}, overhead_cost = ${overhead.toFixed(2)} WHERE id = ${opId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { before: op.actual_minutes, after: dto.actualMinutes, reason: dto.reason } });
    });
    return { ok: true };
  }

  /** Rincian biaya perintah: bahan per baris, tiap operasi, dan total */
  async costing(tenantId: string, orderId: string) {
    const o = (await this.db.execute<{ number: string; status: string; batches: string; planned_qty: string; output_qty: string; material_cost: string; labor_cost: string; overhead_cost: string; total_cost: string; unit_cost: string }>(sql`SELECT number, status, batches, planned_qty, output_qty, material_cost, labor_cost, overhead_cost, total_cost, unit_cost FROM production_orders WHERE id = ${orderId} AND tenant_id = ${tenantId}`)).rows[0];
    if (!o) throw new NotFoundException('Perintah produksi tidak ditemukan');
    const ops = (await this.orderOperations(tenantId, orderId)) as { plannedMinutes: string; actualMinutes: string | null; laborCost: string; overheadCost: string; status: string }[];
    const opLabor = ops.reduce((a, x) => a.plus(x.laborCost), D(0));
    const opOverhead = ops.reduce((a, x) => a.plus(x.overheadCost), D(0));
    return { order: o, operations: ops, operationsLabor: opLabor.toFixed(2), operationsOverhead: opOverhead.toFixed(2), plannedMinutes: ops.reduce((a, x) => a + num(x.plannedMinutes), 0), actualMinutes: ops.reduce((a, x) => a + num(x.actualMinutes), 0) };
  }

  async schedulePlan(tenantId: string, q: RangeQuery) {
    const from = q.from ?? addDays(todayJakarta(), -2);
    const to = q.to ?? addDays(todayJakarta(), 14);
    const r = await this.db.execute(sql`
      SELECT o.id, o.name, o.status, o.sequence, o.work_center_id AS "workCenterId", w.code AS "workCenterCode", w.name AS "workCenterName", p.id AS "orderId", p.number AS "orderNumber",
             o.scheduled_start AS "scheduledStart", o.scheduled_end AS "scheduledEnd", o.planned_minutes AS "plannedMinutes"
      FROM production_order_operations o JOIN work_centers w ON w.id = o.work_center_id JOIN production_orders p ON p.id = o.order_id
      WHERE o.tenant_id = ${tenantId} AND o.status <> 'CANCELLED' AND o.scheduled_start IS NOT NULL AND o.scheduled_start < (${to}::date + 1)::timestamptz AND o.scheduled_end > ${from}::date::timestamptz
        ${q.workCenterId ? sql`AND o.work_center_id = ${q.workCenterId}` : sql``} ORDER BY o.scheduled_start LIMIT 1000`);
    const down = await this.db.execute(sql`SELECT d.id, d.work_center_id AS "workCenterId", d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.reason FROM work_center_downtime d WHERE d.tenant_id = ${tenantId} AND d.starts_at < (${to}::date + 1)::timestamptz AND d.ends_at > ${from}::date::timestamptz ORDER BY d.starts_at`);
    return { from, to, operations: r.rows, downtime: down.rows };
  }

  async controls(tenantId: string) {
    const q = async (t: ReturnType<typeof sql>) => (await this.db.execute(t)).rows;
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
    const r = await this.db.execute(sql`
      SELECT w.id, w.code, w.name, w.capacity_hours AS "capacityHours",
             COALESCE(SUM(o.actual_minutes) FILTER (WHERE o.status = 'DONE'), 0) / 60.0 AS "actualHours",
             COALESCE(SUM(o.planned_minutes) FILTER (WHERE o.status = 'DONE'), 0) / 60.0 AS "plannedHours",
             COALESCE(SUM(o.labor_cost + o.overhead_cost) FILTER (WHERE o.status = 'DONE'), 0) AS cost
      FROM work_centers w LEFT JOIN production_order_operations o ON o.work_center_id = w.id AND o.finished_at >= ${from}::date::timestamptz AND o.finished_at < (${to}::date + 1)::timestamptz
      WHERE w.tenant_id = ${tenantId} GROUP BY w.id ORDER BY w.code`);
    return { from, to, rows: r.rows };
  }
}
