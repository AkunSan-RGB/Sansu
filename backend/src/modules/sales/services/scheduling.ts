/**
 * Penjadwalan sumber daya (usaha jasa): orang, ruang, dan peralatan dipesan untuk pekerjaan pelanggan/proyek pada rentang waktu tertentu.
 *
 * Aturan keras: satu sumber daya tidak boleh punya dua pemesanan aktif yang tumpang tindih. Pemeriksaan dilakukan di dalam transaksi
 * dengan mengunci baris sumber daya, sehingga dua pemesanan bersamaan tidak bisa sama-sama lolos. Pemesanan yang bentrok ditolak (409)
 * dengan daftar pemesanan yang bertabrakan.
 * Pemesanan selesai dapat diubah menjadi draf catatan waktu (lembar waktu) untuk penagihan.
 */
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { addDays, todayJakarta } from '../../../common/utils/dates';
import { Db, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { TimesheetService } from './timesheets';

const KINDS = ['PERSON', 'ROOM', 'EQUIPMENT'] as const;
const MAX_DAYS = 14;
const WORK_START = 8; // WIB
const WORK_END = 17;
const OVERLOAD_HOURS = 10;
const WIB = 7 * 3600_000;
const num = (v: unknown) => Number(v ?? 0);

export class ResourceDto {
  @ApiProperty({ example: 'Ruang Rapat A' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind: 'PERSON' | 'ROOM' | 'EQUIPMENT';
  @ApiPropertyOptional({ description: 'Sumber daya orang: karyawan terkait' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class BookingDto {
  @ApiProperty() @IsUUID() resourceId: string;
  @ApiProperty({ example: 'Survei lokasi PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiProperty({ example: '2026-10-20T09:00:00+07:00' }) @IsDateString() startsAt: string;
  @ApiProperty({ example: '2026-10-20T12:00:00+07:00' }) @IsDateString() endsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class MoveDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
}
export class CancelDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class BookingsQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
}
export class SlotQuery {
  @ApiProperty() @IsUUID() resourceId: string;
  @ApiProperty({ example: '2026-10-20' }) @IsDateString() from: string;
  @ApiProperty({ example: '2026-10-24' }) @IsDateString() to: string;
  @ApiProperty({ example: 120, description: 'Lama yang dibutuhkan (menit)' }) @Type(() => Number) @IsInt() @Min(15) @Max(600) minutes: number;
}

type Booking = { id: string; resource_id: string; title: string; starts_at: Date; ends_at: Date; status: string; customer_id: string | null; project_id: string | null };

@Injectable()
export class SchedulingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly timesheets: TimesheetService,
  ) {}

  // ---------- sumber daya ----------
  resources(tenantId: string) {
    return this.db.execute(sql`SELECT r.id, r.name, r.kind, r.employee_id AS "employeeId", e.name AS "employeeName", r.note, r.is_active AS "isActive" FROM scheduling_resources r LEFT JOIN employees e ON e.id = r.employee_id WHERE r.tenant_id = ${tenantId} ORDER BY r.kind, r.name`).then((x) => x.rows);
  }

  async saveResource(u: AuthUser, dto: ResourceDto, id?: string) {
    if (dto.kind === 'PERSON' && dto.employeeId) {
      const e = await this.db.execute(sql`SELECT 1 FROM employees WHERE id = ${dto.employeeId} AND tenant_id = ${u.tenantId}`);
      if (!e.rows.length) throw new BadRequestException('Karyawan tidak ditemukan');
    }
    if (dto.kind !== 'PERSON' && dto.employeeId) throw new BadRequestException('Karyawan hanya untuk sumber daya berjenis orang');
    try {
      if (id) {
        const r = await this.db.execute(sql`UPDATE scheduling_resources SET name = ${dto.name.trim()}, kind = ${dto.kind}, employee_id = ${dto.employeeId ?? null}, note = ${dto.note ?? null}, is_active = ${dto.isActive ?? true} WHERE id = ${id} AND tenant_id = ${u.tenantId} RETURNING id`);
        if (!r.rows.length) throw new NotFoundException('Sumber daya tidak ditemukan');
        await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'SchedulingResource', entityId: id, data: dto });
        return { id };
      }
      const r = await this.db.execute<{ id: string }>(sql`INSERT INTO scheduling_resources (tenant_id, name, kind, employee_id, note) VALUES (${u.tenantId}, ${dto.name.trim()}, ${dto.kind}, ${dto.employeeId ?? null}, ${dto.note ?? null}) RETURNING id`);
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SchedulingResource', entityId: r.rows[0].id, data: dto });
      return { id: r.rows[0].id };
    } catch (e) {
      if (['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '')) throw new BadRequestException('Nama sumber daya sudah dipakai');
      throw e;
    }
  }

  // ---------- pemesanan ----------
  private parse(startsAt: string, endsAt: string) {
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new BadRequestException('Waktu tidak valid');
    if (e <= s) throw new BadRequestException('Waktu selesai harus setelah waktu mulai');
    if (e.getTime() - s.getTime() > MAX_DAYS * 86_400_000) throw new BadRequestException(`Satu pemesanan paling lama ${MAX_DAYS} hari`);
    return { s, e };
  }

  /** Pemesanan aktif yang bertabrakan dengan rentang ini (sumber daya sudah terkunci oleh pemanggil) */
  private async conflicts(tx: Tx | Db, tenantId: string, resourceId: string, s: Date, e: Date, exceptId?: string) {
    const r = await tx.execute<{ id: string; title: string; starts_at: Date; ends_at: Date }>(sql`
      SELECT id, title, starts_at, ends_at FROM resource_bookings
      WHERE tenant_id = ${tenantId} AND resource_id = ${resourceId} AND status = 'BOOKED' AND starts_at < ${e.toISOString()}::timestamptz AND ends_at > ${s.toISOString()}::timestamptz ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
      ORDER BY starts_at`);
    return r.rows;
  }

  private conflictError(rows: { id: string; title: string; starts_at: Date; ends_at: Date }[]) {
    return new ConflictException({ message: `Jadwal bentrok dengan ${rows.length} pemesanan lain`, conflicts: rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at })) });
  }

  private async lockResource(tx: Tx, tenantId: string, id: string) {
    const r = await tx.execute<{ id: string; name: string; is_active: boolean; employee_id: string | null }>(sql`SELECT id, name, is_active, employee_id FROM scheduling_resources WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new BadRequestException('Sumber daya tidak ditemukan');
    if (!r.rows[0].is_active) throw new BadRequestException('Sumber daya nonaktif');
    return r.rows[0];
  }

  private async validateLinks(tx: Tx, tenantId: string, projectId?: string, customerId?: string) {
    let cust = customerId ?? null;
    if (projectId) {
      const p = (await tx.execute<{ customer_id: string; status: string }>(sql`SELECT customer_id, status FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`)).rows[0];
      if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      if (cust && cust !== p.customer_id) throw new BadRequestException('Proyek ini milik pelanggan lain');
      cust = p.customer_id;
    }
    if (cust) {
      const c = await tx.execute(sql`SELECT 1 FROM customers WHERE id = ${cust} AND tenant_id = ${tenantId}`);
      if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
    }
    return cust;
  }

  async book(u: AuthUser, dto: BookingDto) {
    const { s, e } = this.parse(dto.startsAt, dto.endsAt);
    if (e.getTime() < Date.now() - 86_400_000 && u.role !== 'OWNER' && u.role !== 'ADMIN') throw new BadRequestException('Tidak dapat memesan jadwal yang sudah lewat lebih dari sehari');
    const id = await this.db.transaction(async (tx) => {
      await this.lockResource(tx, u.tenantId, dto.resourceId);
      const cust = await this.validateLinks(tx, u.tenantId, dto.projectId, dto.customerId);
      const clash = await this.conflicts(tx, u.tenantId, dto.resourceId, s, e);
      if (clash.length) throw this.conflictError(clash);
      const r = await tx.execute<{ id: string }>(sql`INSERT INTO resource_bookings (tenant_id, resource_id, project_id, customer_id, title, starts_at, ends_at, note, created_by_id) VALUES (${u.tenantId}, ${dto.resourceId}, ${dto.projectId ?? null}, ${cust}, ${dto.title.trim()}, ${s.toISOString()}, ${e.toISOString()}, ${dto.note ?? null}, ${u.sub}) RETURNING id`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ResourceBooking', entityId: r.rows[0].id, data: { resourceId: dto.resourceId, title: dto.title, startsAt: s, endsAt: e } });
      return r.rows[0].id;
    });
    return this.get(u.tenantId, id);
  }

  private async lockBooking(tx: Tx, tenantId: string, id: string) {
    const r = await tx.execute<Booking>(sql`SELECT * FROM resource_bookings WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new NotFoundException('Pemesanan tidak ditemukan');
    return r.rows[0];
  }

  async move(u: AuthUser, id: string, dto: MoveDto) {
    const { s, e } = this.parse(dto.startsAt, dto.endsAt);
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, u.tenantId, id);
      if (b.status !== 'BOOKED') throw new BadRequestException('Hanya pemesanan aktif yang dapat dipindah');
      const target = dto.resourceId ?? b.resource_id;
      await this.lockResource(tx, u.tenantId, target);
      const clash = await this.conflicts(tx, u.tenantId, target, s, e, id);
      if (clash.length) throw this.conflictError(clash);
      await tx.execute(sql`UPDATE resource_bookings SET resource_id = ${target}, starts_at = ${s.toISOString()}, ends_at = ${e.toISOString()} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ResourceBooking', entityId: id, data: { before: { resourceId: b.resource_id, startsAt: b.starts_at, endsAt: b.ends_at }, after: { resourceId: target, startsAt: s, endsAt: e } } });
    });
    return this.get(u.tenantId, id);
  }

  async cancel(u: AuthUser, id: string, dto: CancelDto) {
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, u.tenantId, id);
      if (b.status !== 'BOOKED') throw new BadRequestException('Hanya pemesanan aktif yang dapat dibatalkan');
      await tx.execute(sql`UPDATE resource_bookings SET status = 'CANCELLED', cancel_reason = ${dto.reason} WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'ResourceBooking', entityId: id, data: { reason: dto.reason, title: b.title } });
    });
    return this.get(u.tenantId, id);
  }

  async done(u: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const b = await this.lockBooking(tx, u.tenantId, id);
      if (b.status !== 'BOOKED') throw new BadRequestException('Hanya pemesanan aktif yang dapat ditandai selesai');
      if (new Date(b.starts_at) > new Date()) throw new BadRequestException('Pemesanan yang belum dimulai tidak bisa ditandai selesai');
      await tx.execute(sql`UPDATE resource_bookings SET status = 'DONE' WHERE id = ${id}`);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ResourceBooking', entityId: id, data: { status: 'DONE' } });
    });
    return this.get(u.tenantId, id);
  }

  /** Ubah pemesanan sumber daya orang menjadi draf catatan waktu (jam = lama pemesanan) untuk ditagih */
  async toTimeEntry(u: AuthUser, id: string) {
    const b = (await this.db.execute<Booking & { employee_id: string | null; kind: string; project_id: string | null }>(sql`SELECT b.*, r.employee_id, r.kind FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id WHERE b.id = ${id} AND b.tenant_id = ${u.tenantId}`)).rows[0];
    if (!b) throw new NotFoundException('Pemesanan tidak ditemukan');
    if (b.kind !== 'PERSON' || !b.employee_id) throw new BadRequestException('Hanya pemesanan sumber daya orang yang terhubung ke karyawan yang dapat dijadikan catatan waktu');
    if (!b.customer_id && !b.project_id) throw new BadRequestException('Pemesanan belum terkait pelanggan/proyek');
    if (b.status === 'CANCELLED') throw new BadRequestException('Pemesanan sudah dibatalkan');
    if (new Date(b.starts_at) > new Date()) throw new BadRequestException('Pemesanan belum dimulai');
    const exist = await this.db.execute(sql`SELECT 1 FROM time_entries WHERE booking_id = ${id}`);
    if (exist.rows.length) throw new BadRequestException('Pemesanan ini sudah dijadikan catatan waktu');
    const hours = Math.min(16, Math.max(0.25, Math.round(((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 3_600_000) * 4) / 4));
    const workDate = new Date(new Date(b.starts_at).getTime() + WIB).toISOString().slice(0, 10);
    const entry = (await this.timesheets.create(u, { employeeId: b.employee_id, projectId: b.project_id ?? undefined, customerId: b.customer_id ?? undefined, workDate, hours: String(hours), description: b.title })) as { id: string };
    await this.db.execute(sql`UPDATE time_entries SET booking_id = ${id} WHERE id = ${entry.id}`);
    await this.db.execute(sql`UPDATE resource_bookings SET status = 'DONE' WHERE id = ${id} AND status = 'BOOKED'`);
    return entry;
  }

  async get(tenantId: string, id: string) {
    const r = await this.list(tenantId, {}, id);
    if (!r.length) throw new NotFoundException('Pemesanan tidak ditemukan');
    return r[0];
  }

  async list(tenantId: string, q: BookingsQuery, onlyId?: string) {
    const from = q.from ?? addDays(todayJakarta(), -7);
    const to = q.to ?? addDays(todayJakarta(), 30);
    const r = await this.db.execute(sql`
      SELECT b.id, b.resource_id AS "resourceId", r.name AS "resourceName", r.kind, b.title, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.note, b.cancel_reason AS "cancelReason",
             b.customer_id AS "customerId", c.name AS "customerName", b.project_id AS "projectId", p.name AS "projectName"
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN projects p ON p.id = b.project_id
      WHERE b.tenant_id = ${tenantId}
        ${onlyId ? sql`AND b.id = ${onlyId}` : sql`AND b.starts_at < (${to}::date + 1)::timestamptz AND b.ends_at > ${from}::date::timestamptz`}
        ${q.resourceId ? sql`AND b.resource_id = ${q.resourceId}` : sql``}
      ORDER BY b.starts_at LIMIT 1000`);
    return r.rows as Record<string, unknown>[];
  }

  /** Slot kosong jam kerja (08.00–17.00 WIB, Senin–Sabtu) yang cukup untuk `minutes`, per hari */
  async freeSlots(tenantId: string, q: SlotQuery) {
    const res = (await this.db.execute<{ id: string }>(sql`SELECT id FROM scheduling_resources WHERE id = ${q.resourceId} AND tenant_id = ${tenantId} AND is_active`)).rows;
    if (!res.length) throw new BadRequestException('Sumber daya tidak ditemukan atau nonaktif');
    const days: string[] = [];
    for (let d = q.from; d <= q.to && days.length < 31; d = addDays(d, 1)) days.push(d);
    const winStart = new Date(`${q.from}T00:00:00+07:00`);
    const winEnd = new Date(`${addDays(q.to, 1)}T00:00:00+07:00`);
    const booked = (await this.conflicts(this.db, tenantId, q.resourceId, winStart, winEnd)).map((b) => ({ s: new Date(b.starts_at).getTime(), e: new Date(b.ends_at).getTime() }));
    const slots: { date: string; startsAt: string; endsAt: string }[] = [];
    for (const day of days) {
      if (new Date(`${day}T12:00:00+07:00`).getUTCDay() === 0) continue; // Minggu
      let cursor = new Date(`${day}T${String(WORK_START).padStart(2, '0')}:00:00+07:00`).getTime();
      const end = new Date(`${day}T${String(WORK_END).padStart(2, '0')}:00:00+07:00`).getTime();
      for (const b of booked.filter((x) => x.e > cursor && x.s < end).sort((a, b2) => a.s - b2.s)) {
        if (b.s - cursor >= q.minutes * 60_000) slots.push({ date: day, startsAt: new Date(cursor).toISOString(), endsAt: new Date(b.s).toISOString() });
        cursor = Math.max(cursor, b.e);
      }
      if (end - cursor >= q.minutes * 60_000) slots.push({ date: day, startsAt: new Date(cursor).toISOString(), endsAt: new Date(end).toISOString() });
    }
    return slots;
  }

  /** Kontrol: orang terlalu padat, pemesanan lewat belum diselesaikan */
  async controls(tenantId: string) {
    const overloaded = await this.db.execute(sql`
      SELECT r.name AS resource, to_char((b.starts_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day, ROUND(SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600)::numeric, 1) AS hours
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id
      WHERE b.tenant_id = ${tenantId} AND b.status = 'BOOKED' AND r.kind = 'PERSON' AND b.starts_at > now() - interval '7 days'
      GROUP BY r.name, (b.starts_at AT TIME ZONE 'Asia/Jakarta')::date HAVING SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600) > ${OVERLOAD_HOURS} ORDER BY 2 LIMIT 50`);
    const stale = await this.db.execute(sql`SELECT b.id, b.title, r.name AS resource, b.ends_at AS "endsAt" FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id WHERE b.tenant_id = ${tenantId} AND b.status = 'BOOKED' AND b.ends_at < now() - interval '1 day' ORDER BY b.ends_at LIMIT 50`);
    return { overloadedPeople: overloaded.rows, notCompleted: stale.rows, overloadHours: OVERLOAD_HOURS };
  }
}

@ApiTags('Penjadwalan')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly svc: SchedulingService) {}

  @Get('resources') resources(@CurrentUser() u: AuthUser) { return this.svc.resources(u.tenantId); }
  @Roles('ADMIN') @Post('resources') createResource(@CurrentUser() u: AuthUser, @Body() dto: ResourceDto) { return this.svc.saveResource(u, dto); }
  @Roles('ADMIN') @Put('resources/:id') updateResource(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResourceDto) { return this.svc.saveResource(u, dto, id); }

  @Get('bookings') bookings(@CurrentUser() u: AuthUser, @Query() q: BookingsQuery) { return this.svc.list(u.tenantId, q); }
  @Get('free-slots') slots(@CurrentUser() u: AuthUser, @Query() q: SlotQuery) { return this.svc.freeSlots(u.tenantId, { ...q, minutes: Number(q.minutes) }); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings') book(@CurrentUser() u: AuthUser, @Body() dto: BookingDto) { return this.svc.book(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Put('bookings/:id') move(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDto) { return this.svc.move(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancel(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('bookings/:id/done') done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.done(u, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/:id/time-entry') toEntry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.toTimeEntry(u, id); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}
