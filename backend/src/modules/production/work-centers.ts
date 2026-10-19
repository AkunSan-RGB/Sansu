/**
 * Pusat kerja (mesin / lini / stasiun), rute operasi resep, jadwal mesin, dan biaya per operasi.
 *
 * - Resep dapat punya urutan operasi (pusat kerja + menit per batch). Perintah produksi menyalin operasinya (menit × batch).
 * - Jadwal mesin: tiap operasi dijadwalkan pada pusat kerja untuk rentang waktu. Bentrok ditolak (dengan daftar yang bertabrakan), termasuk
 *   pemesanan bersamaan (baris pusat kerja dikunci), bentrok dengan jadwal perawatan/mesin mati, dan pelanggaran urutan (operasi berikutnya
 *   tidak boleh dijadwalkan sebelum operasi sebelumnya selesai).
 * - Pelaksanaan: operasi dimulai setelah operasi sebelumnya selesai; saat selesai dicatat menit aktual → biaya upah dan overhead operasi
 *   = jam aktual × tarif pusat kerja (snapshot). Aktual > 150% rencana wajib catatan. Koreksi operasi selesai hanya Admin dengan alasan.
 * - Biaya konversi perintah produksi dihitung dari biaya operasi (bukan diketik) bila resepnya punya operasi.
 */
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';

const KINDS = ['MACHINE', 'LINE', 'STATION'] as const;
const OVERRUN = 1.5;
const num = (v: unknown) => Number(v ?? 0);
const dup = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');

export class WorkCenterDto {
  @ApiProperty({ example: 'MSN-01' }) @IsString() @MinLength(2) @MaxLength(30) code: string;
  @ApiProperty({ example: 'Mesin Potong 1' }) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: 'MACHINE' | 'LINE' | 'STATION';
  @ApiProperty({ example: 25000, description: 'Tarif upah per jam' }) @IsNumber() @Min(0) @Max(100_000_000) laborRate: number;
  @ApiProperty({ example: 40000, description: 'Tarif overhead (listrik, penyusutan, dll.) per jam' }) @IsNumber() @Min(0) @Max(100_000_000) overheadRate: number;
  @ApiPropertyOptional({ example: 8, description: 'Kapasitas jam per hari' }) @IsOptional() @IsNumber() @Min(0.5) @Max(24) capacityHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class DowntimeDto {
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) reason: string;
}
export class BomOpDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @IsUUID() workCenterId: string;
  @ApiProperty({ example: 30, description: 'Menit per batch' }) @IsNumber() @Min(1) @Max(100_000) minutesPerBatch: number;
}
export class BomOpsDto {
  @ApiProperty({ type: [BomOpDto], description: 'Urutan operasi (menggantikan yang lama)' }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BomOpDto) operations: BomOpDto[];
}
export class ScheduleDto {
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
}
export class FinishOpDto {
  @ApiPropertyOptional({ description: 'Menit aktual; kosong = selisih waktu mulai–selesai' }) @IsOptional() @IsNumber() @Min(1) @Max(1440) actualMinutes?: number;
  @ApiPropertyOptional({ description: 'Wajib bila aktual > 150% rencana' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() operatorEmployeeId?: string;
}
export class CorrectOpDto {
  @ApiProperty() @IsNumber() @Min(1) @Max(1440) actualMinutes: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class RangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workCenterId?: string;
}

type Op = { id: string; order_id: string; sequence: number; name: string; work_center_id: string; planned_minutes: string; actual_minutes: string | null; status: string; started_at: Date | null; scheduled_start: Date | null; scheduled_end: Date | null; labor_cost: string; overhead_cost: string };

@Injectable()
export class WorkCenterService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---------- pusat kerja ----------
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

  private async lockWc(tx: Tx, tenantId: string, id: string, mustBeActive = true) {
    const r = await tx.execute<{ id: string; is_active: boolean; labor_rate: string; overhead_rate: string; code: string }>(sql`SELECT id, is_active, labor_rate, overhead_rate, code FROM work_centers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new BadRequestException('Pusat kerja tidak ditemukan');
    if (mustBeActive && !r.rows[0].is_active) throw new BadRequestException('Pusat kerja nonaktif');
    return r.rows[0];
  }

  // ---------- operasi resep ----------
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

  // ---------- operasi perintah ----------
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
      const clash = await this.clashes(tx, u.tenantId, op.work_center_id, s, e, opId);
      if (clash.length) throw new ConflictException({ message: `Jadwal bentrok dengan ${clash.length} jadwal lain di pusat kerja ini`, conflicts: clash });
      // urutan: operasi tidak boleh mulai sebelum operasi sebelumnya (jadwal) selesai
      const prev = (await tx.execute<{ name: string; scheduled_end: Date | null }>(sql`SELECT name, scheduled_end FROM production_order_operations WHERE order_id = ${op.order_id} AND sequence < ${op.sequence} AND status <> 'CANCELLED' ORDER BY sequence DESC LIMIT 1`)).rows[0];
      if (prev?.scheduled_end && s < new Date(prev.scheduled_end)) throw new BadRequestException(`Operasi ini tidak boleh mulai sebelum "${prev.name}" selesai (${new Date(prev.scheduled_end).toISOString()})`);
      const next = (await tx.execute<{ name: string; scheduled_start: Date | null }>(sql`SELECT name, scheduled_start FROM production_order_operations WHERE order_id = ${op.order_id} AND sequence > ${op.sequence} AND status <> 'CANCELLED' AND scheduled_start IS NOT NULL ORDER BY sequence LIMIT 1`)).rows[0];
      if (next?.scheduled_start && e > new Date(next.scheduled_start)) throw new BadRequestException(`Operasi ini harus selesai sebelum "${next.name}" dimulai`);
      await tx.execute(sql`UPDATE production_order_operations SET scheduled_start = ${s.toISOString()}, scheduled_end = ${e.toISOString()} WHERE id = ${opId}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ProductionOperation', entityId: opId, data: { scheduledStart: s, scheduledEnd: e } });
    });
    return { ok: true };
  }

  async unschedule(u: AuthUser, opId: string) {
    await this.db.transaction(async (tx) => {
      const op = await this.lockOp(tx, u.tenantId, opId);
      if (op.status !== 'PENDING') throw new BadRequestException('Hanya operasi yang belum dimulai');
      await tx.execute(sql`UPDATE production_order_operations SET scheduled_start = NULL, scheduled_end = NULL WHERE id = ${opId}`);
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

  // ---------- jadwal dan kontrol ----------
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
    const overbooked = await q(sql`
      SELECT w.code, w.name, to_char((o.scheduled_start AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day, ROUND(SUM(EXTRACT(EPOCH FROM (o.scheduled_end - o.scheduled_start)) / 3600)::numeric, 1) AS hours, w.capacity_hours AS capacity
      FROM production_order_operations o JOIN work_centers w ON w.id = o.work_center_id
      WHERE o.tenant_id = ${tenantId} AND o.status IN ('PENDING', 'RUNNING') AND o.scheduled_start > now() - interval '2 days'
      GROUP BY w.code, w.name, w.capacity_hours, (o.scheduled_start AT TIME ZONE 'Asia/Jakarta')::date
      HAVING SUM(EXTRACT(EPOCH FROM (o.scheduled_end - o.scheduled_start)) / 3600) > w.capacity_hours ORDER BY 3 LIMIT 50`);
    const late = await q(sql`SELECT o.id, o.name, p.number AS "orderNumber", w.code AS "workCenter", o.scheduled_end AS "scheduledEnd" FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id JOIN work_centers w ON w.id = o.work_center_id WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_end < now() ORDER BY o.scheduled_end LIMIT 50`);
    const overrun = await q(sql`SELECT p.number AS "orderNumber", o.name, o.planned_minutes AS planned, o.actual_minutes AS actual, o.note FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id WHERE o.tenant_id = ${tenantId} AND o.status = 'DONE' AND o.actual_minutes > o.planned_minutes * ${OVERRUN} AND o.finished_at > now() - interval '60 days' ORDER BY o.finished_at DESC LIMIT 50`);
    const downtimeClash = await q(sql`SELECT p.number AS "orderNumber", o.name, w.code AS "workCenter", d.reason FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id JOIN work_centers w ON w.id = o.work_center_id JOIN work_center_downtime d ON d.work_center_id = o.work_center_id AND d.starts_at < o.scheduled_end AND d.ends_at > o.scheduled_start WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_start IS NOT NULL AND o.scheduled_end > now() LIMIT 50`);
    const unscheduled = await q(sql`SELECT p.number AS "orderNumber", COUNT(*)::int AS operations FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id WHERE o.tenant_id = ${tenantId} AND o.status = 'PENDING' AND o.scheduled_start IS NULL AND p.status IN ('DRAFT', 'IN_PROGRESS') AND p.created_at < now() - interval '1 day' GROUP BY p.number ORDER BY p.number LIMIT 50`);
    return { overbookedDays: overbooked, overdueNotStarted: late, overruns: overrun, scheduledDuringDowntime: downtimeClash, unscheduledOrders: unscheduled };
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

@ApiTags('Pusat kerja & jadwal mesin')
@ApiBearerAuth()
@RequireApp('inventory')
@Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
@Controller('production')
export class WorkCenterController {
  constructor(private readonly svc: WorkCenterService) {}

  @Get('work-centers') list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Roles('ADMIN') @Post('work-centers') create(@CurrentUser() u: AuthUser, @Body() dto: WorkCenterDto) { return this.svc.save(u, dto); }
  @Roles('ADMIN') @Put('work-centers/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkCenterDto) { return this.svc.save(u, dto, id); }
  @Get('work-centers/:id/downtime') downtimes(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.downtimes(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('work-centers/:id/downtime') addDowntime(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DowntimeDto) { return this.svc.addDowntime(u, id, dto); }

  @Get('boms/:id/operations') bomOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.bomOperations(u.tenantId, id); }
  @Roles('ADMIN') @Put('boms/:id/operations') setBomOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BomOpsDto) { return this.svc.setBomOperations(u, id, dto); }

  @Get('orders/:id/operations') orderOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.orderOperations(u.tenantId, id); }
  @Get('orders/:id/costing') costing(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.costing(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/schedule') schedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto) { return this.svc.schedule(u, id, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/unschedule') unschedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.unschedule(u, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/start') start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.startOp(u, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/finish') finish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FinishOpDto) { return this.svc.finishOp(u, id, dto); }
  @Roles('ADMIN') @Post('operations/:id/correct') correct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectOpDto) { return this.svc.correctOp(u, id, dto); }

  @Get('schedule') plan(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.schedulePlan(u.tenantId, q); }
  @Get('schedule/controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
  @Get('work-centers-utilization') utilization(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.utilization(u.tenantId, q); }
}
