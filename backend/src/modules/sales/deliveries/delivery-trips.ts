/**
 * Rute pengiriman: satu kendaraan/pengemudi membawa beberapa surat jalan pada satu tanggal.
 *  - Hanya surat jalan yang berstatus terkirim (DELIVERED, bukan batal) yang boleh dimasukkan, dan satu surat jalan hanya di satu rute yang
 *    masih berlaku (stop yang gagal boleh dijadwalkan ulang).
 *  - Rute: PLANNED → ON_ROUTE (berangkat, minimal satu stop) → COMPLETED (semua stop sudah diputuskan). Rute yang belum berangkat bisa dibatalkan.
 *  - Stop terkirim wajib memuat nama penerima (bukti terima); stop gagal wajib memuat alasan. Setiap perubahan tercatat di jejak audit.
 *  - Urutan stop dapat diatur manual atau diurutkan otomatis dari titik terdekat memakai koordinat pelanggan (bila ada).
 */
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, deliveryOrders, deliveryTrips, deliveryTripStops } from '../../../db/schema';
import { haversineM } from '../canvass/canvass';

export class CreateTripDto {
  @ApiPropertyOptional({ example: '2026-10-20', description: 'Tanggal pengiriman (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 'B 1234 XY' }) @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @ApiPropertyOptional({ example: 'Pak Slamet' }) @IsOptional() @IsString() @MaxLength(100) driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ type: [String], description: 'Surat jalan yang langsung dimasukkan (urutan = urutan stop)' }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) deliveryIds?: string[];
}
export class AddStopsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) deliveryIds: string[];
}
export class ReorderDto {
  @ApiProperty({ type: [String], description: 'Seluruh id stop pada rute ini, dalam urutan baru' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) stopIds: string[];
}
export class StopResultDto {
  @ApiProperty({ enum: ['DELIVERED', 'FAILED'] }) @IsIn(['DELIVERED', 'FAILED']) result: 'DELIVERED' | 'FAILED';
  @ApiPropertyOptional({ description: 'Nama penerima (wajib bila terkirim)' }) @IsOptional() @IsString() @MaxLength(120) receivedBy?: string;
  @ApiPropertyOptional({ description: 'Alasan gagal (wajib bila gagal)' }) @IsOptional() @IsString() @MaxLength(300) failReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class CancelTripDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
export class TripQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED']) status?: string;
}

/** Urutan terdekat (nearest neighbour) dimulai dari stop pertama yang berkoordinat; stop tanpa koordinat tetap di belakang dengan urutan semula */
export function nearestOrder<T extends { id: string; lat: number | null; lng: number | null }>(stops: T[]): T[] {
  const withGeo = stops.filter((s) => s.lat !== null && s.lng !== null);
  const without = stops.filter((s) => s.lat === null || s.lng === null);
  if (withGeo.length < 2) return stops;
  const left = [...withGeo];
  const out: T[] = [left.shift()!];
  while (left.length) {
    const cur = out[out.length - 1];
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, i) => {
      const d = haversineM(cur.lat!, cur.lng!, s.lat!, s.lng!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return [...out, ...without];
}

@Injectable()
export class DeliveryTripsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private async trip(tenantId: string, id: string) {
    const [t] = await this.db.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, tenantId)));
    if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
    return t;
  }

  async list(tenantId: string, q: TripQueryDto) {
    const where = [eq(deliveryTrips.tenantId, tenantId)];
    if (q.from) where.push(gte(deliveryTrips.date, q.from));
    if (q.to) where.push(lte(deliveryTrips.date, q.to));
    if (q.status) where.push(eq(deliveryTrips.status, q.status as 'PLANNED'));
    const trips = await this.db.select().from(deliveryTrips).where(and(...where)).orderBy(desc(deliveryTrips.date), desc(deliveryTrips.number)).limit(300);
    if (!trips.length) return [];
    const stops = await this.db.select({ tripId: deliveryTripStops.tripId, status: deliveryTripStops.status }).from(deliveryTripStops).where(inArray(deliveryTripStops.tripId, trips.map((t) => t.id)));
    return trips.map((t) => {
      const s = stops.filter((x) => x.tripId === t.id);
      return { ...t, stops: s.length, delivered: s.filter((x) => x.status === 'DELIVERED').length, failed: s.filter((x) => x.status === 'FAILED').length, pending: s.filter((x) => x.status === 'PENDING').length };
    });
  }

  async get(tenantId: string, id: string) {
    const t = await this.trip(tenantId, id);
    const stops = await this.db
      .select({
        id: deliveryTripStops.id,
        sequence: deliveryTripStops.sequence,
        status: deliveryTripStops.status,
        receivedBy: deliveryTripStops.receivedBy,
        receivedAt: deliveryTripStops.receivedAt,
        failReason: deliveryTripStops.failReason,
        note: deliveryTripStops.note,
        deliveryId: deliveryOrders.id,
        deliveryNumber: deliveryOrders.number,
        customerId: customers.id,
        customerCode: customers.code,
        customerName: customers.name,
        address: customers.address,
        phone: customers.phone,
        hasGeo: sql<boolean>`(${customers.geoLat} IS NOT NULL AND ${customers.geoLng} IS NOT NULL)`,
      })
      .from(deliveryTripStops)
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(eq(deliveryTripStops.tripId, id))
      .orderBy(asc(deliveryTripStops.sequence));
    return { ...t, stops };
  }

  /** Surat jalan yang belum masuk rute mana pun yang berlaku */
  async unscheduled(tenantId: string) {
    const onTrip = this.db.select({ id: deliveryTripStops.deliveryId }).from(deliveryTripStops).where(and(eq(deliveryTripStops.tenantId, tenantId), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED'])));
    return this.db
      .select({ id: deliveryOrders.id, number: deliveryOrders.number, date: deliveryOrders.date, customerId: customers.id, customerName: customers.name, address: customers.address })
      .from(deliveryOrders)
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryOrders.tenantId, tenantId), eq(deliveryOrders.status, 'DELIVERED'), notInArray(deliveryOrders.id, onTrip)))
      .orderBy(asc(deliveryOrders.date), asc(deliveryOrders.number))
      .limit(300);
  }

  private async addStopsTx(tx: Db, tenantId: string, tripId: string, deliveryIds: string[]) {
    const unique = [...new Set(deliveryIds)];
    if (unique.length !== deliveryIds.length) throw new BadRequestException('Surat jalan ganda dalam satu permintaan');
    const dos = await tx.select({ id: deliveryOrders.id, number: deliveryOrders.number, status: deliveryOrders.status }).from(deliveryOrders).where(and(eq(deliveryOrders.tenantId, tenantId), inArray(deliveryOrders.id, unique)));
    if (dos.length !== unique.length) throw new BadRequestException('Ada surat jalan yang tidak ditemukan');
    const cancelled = dos.filter((d) => d.status !== 'DELIVERED');
    if (cancelled.length) throw new BadRequestException(`Surat jalan batal tidak bisa dikirim: ${cancelled.map((d) => d.number).join(', ')}`);
    const busy = await tx
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .where(and(inArray(deliveryTripStops.deliveryId, unique), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED'])));
    if (busy.length) throw new BadRequestException(`Sudah ada di rute lain: ${busy.map((b) => `${b.number} (${b.trip})`).join(', ')}`);
    const [{ max }] = await tx.select({ max: sql<number>`COALESCE(MAX(${deliveryTripStops.sequence}), 0)::int` }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId));
    await tx.insert(deliveryTripStops).values(unique.map((deliveryId, i) => ({ tenantId, tripId, deliveryId, sequence: max + i + 1 })));
  }

  async create(u: AuthUser, dto: CreateTripDto) {
    const date = toDocDate(dto.date ?? todayJakarta());
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'DELIVERY_TRIP', date);
      const [t] = await tx.insert(deliveryTrips).values({ tenantId: u.tenantId, number, date, vehicle: dto.vehicle?.trim() || null, driverName: dto.driverName?.trim() || null, notes: dto.notes?.trim() || null, createdById: u.sub }).returning();
      if (dto.deliveryIds?.length) await this.addStopsTx(tx as unknown as Db, u.tenantId, t.id, dto.deliveryIds);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'DeliveryTrip', entityId: t.id, data: { number, stops: dto.deliveryIds?.length ?? 0 } });
      return t;
    });
  }

  private assertPlanned(t: { status: string; number: string }) {
    if (t.status !== 'PLANNED') throw new BadRequestException(`Rute ${t.number} sudah ${t.status === 'ON_ROUTE' ? 'berangkat' : t.status === 'COMPLETED' ? 'selesai' : 'dibatalkan'}; susunan stop tidak bisa diubah`);
  }

  async addStops(u: AuthUser, id: string, dto: AddStopsDto) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      await this.addStopsTx(tx as unknown as Db, u.tenantId, id, dto.deliveryIds);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'ADD_STOPS', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, added: dto.deliveryIds.length } });
    });
    return this.get(u.tenantId, id);
  }

  async removeStop(u: AuthUser, id: string, stopId: string) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const del = await tx.delete(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, id))).returning({ id: deliveryTripStops.id });
      if (!del.length) throw new NotFoundException('Stop tidak ditemukan');
      await this.renumber(tx as unknown as Db, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REMOVE_STOP', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    return this.get(u.tenantId, id);
  }

  private async renumber(tx: Db, tripId: string) {
    const rows = await tx.select({ id: deliveryTripStops.id }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId)).orderBy(asc(deliveryTripStops.sequence));
    for (let i = 0; i < rows.length; i++) await tx.update(deliveryTripStops).set({ sequence: i + 1 }).where(eq(deliveryTripStops.id, rows[i].id));
  }

  async reorder(u: AuthUser, id: string, dto: ReorderDto) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const cur = await tx.select({ id: deliveryTripStops.id }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, id));
      const a = new Set(cur.map((c) => c.id));
      if (dto.stopIds.length !== a.size || dto.stopIds.some((s) => !a.has(s)) || new Set(dto.stopIds).size !== a.size) throw new BadRequestException('Daftar stop harus memuat semua stop rute ini, tepat satu kali');
      for (let i = 0; i < dto.stopIds.length; i++) await tx.update(deliveryTripStops).set({ sequence: i + 1 }).where(eq(deliveryTripStops.id, dto.stopIds[i]));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REORDER', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    return this.get(u.tenantId, id);
  }

  /** Susun ulang stop menurut titik terdekat (koordinat pelanggan) */
  async optimize(u: AuthUser, id: string) {
    const t = await this.get(u.tenantId, id);
    this.assertPlanned(t);
    const geo = await this.db.select({ id: customers.id, lat: customers.geoLat, lng: customers.geoLng }).from(customers).where(and(eq(customers.tenantId, u.tenantId), inArray(customers.id, [...new Set(t.stops.map((s) => s.customerId))])));
    const g = new Map(geo.map((c) => [c.id, c]));
    const rows = t.stops.map((s) => ({ id: s.id, lat: g.get(s.customerId)?.lat != null ? Number(g.get(s.customerId)!.lat) : null, lng: g.get(s.customerId)?.lng != null ? Number(g.get(s.customerId)!.lng) : null }));
    const ordered = nearestOrder(rows);
    return this.reorder(u, id, { stopIds: ordered.map((r) => r.id) });
  }

  async depart(u: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const [{ n }] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, id));
      if (!n) throw new BadRequestException('Rute belum punya stop; tambahkan surat jalan dulu');
      await tx.update(deliveryTrips).set({ status: 'ON_ROUTE', departedAt: new Date() }).where(eq(deliveryTrips.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'DEPART', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stops: n, vehicle: t.vehicle, driver: t.driverName } });
    });
    return this.get(u.tenantId, id);
  }

  async markStop(u: AuthUser, id: string, stopId: string, dto: StopResultDto) {
    const receivedBy = dto.receivedBy?.trim();
    const failReason = dto.failReason?.trim();
    if (dto.result === 'DELIVERED' && (!receivedBy || receivedBy.length < 2)) throw new BadRequestException('Nama penerima wajib diisi sebagai bukti terima');
    if (dto.result === 'FAILED' && (!failReason || failReason.length < 3)) throw new BadRequestException('Alasan gagal kirim wajib diisi');
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      if (t.status !== 'ON_ROUTE') throw new BadRequestException('Hasil pengiriman hanya bisa dicatat saat rute sedang berjalan');
      const [s] = await tx.select().from(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, id))).for('update');
      if (!s) throw new NotFoundException('Stop tidak ditemukan');
      if (s.status !== 'PENDING') throw new BadRequestException('Hasil stop ini sudah dicatat dan tidak bisa diubah');
      await tx.update(deliveryTripStops).set({ status: dto.result, receivedBy: dto.result === 'DELIVERED' ? receivedBy : null, receivedAt: dto.result === 'DELIVERED' ? new Date() : null, failReason: dto.result === 'FAILED' ? failReason : null, note: dto.note?.trim() || null }).where(eq(deliveryTripStops.id, stopId));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.result === 'DELIVERED' ? 'STOP_DELIVERED' : 'STOP_FAILED', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stop: s.sequence, receivedBy, failReason } });
    });
    return this.get(u.tenantId, id);
  }

  async complete(u: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      if (t.status !== 'ON_ROUTE') throw new BadRequestException('Hanya rute yang sedang berjalan yang bisa diselesaikan');
      const [{ n }] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(deliveryTripStops).where(and(eq(deliveryTripStops.tripId, id), eq(deliveryTripStops.status, 'PENDING')));
      if (n) throw new BadRequestException(`Masih ada ${n} stop yang belum diputuskan (terkirim atau gagal)`);
      await tx.update(deliveryTrips).set({ status: 'COMPLETED', completedAt: new Date() }).where(eq(deliveryTrips.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'COMPLETE', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    return this.get(u.tenantId, id);
  }

  async cancel(u: AuthUser, id: string, dto: CancelTripDto) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      await tx.delete(deliveryTripStops).where(eq(deliveryTripStops.tripId, id));
      await tx.update(deliveryTrips).set({ status: 'CANCELLED', cancelReason: dto.reason.trim() }).where(eq(deliveryTrips.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, reason: dto.reason } });
    });
    return this.get(u.tenantId, id);
  }

  /** Peringatan kontrol: surat jalan lama belum dijadwalkan, rute berangkat lebih dari 1 hari belum selesai, stop gagal belum dijadwalkan ulang */
  async controls(tenantId: string, today = todayJakarta()) {
    const unscheduled = (await this.unscheduled(tenantId)).filter((d) => d.date < today);
    const stuck = await this.db.select({ id: deliveryTrips.id, number: deliveryTrips.number, date: deliveryTrips.date }).from(deliveryTrips).where(and(eq(deliveryTrips.tenantId, tenantId), eq(deliveryTrips.status, 'ON_ROUTE'), sql`${deliveryTrips.date} < ${today}::date`));
    const failed = await this.db
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number, reason: deliveryTripStops.failReason })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .where(and(eq(deliveryTripStops.tenantId, tenantId), eq(deliveryTripStops.status, 'FAILED'), notInArray(deliveryTripStops.deliveryId, this.db.select({ id: deliveryTripStops.deliveryId }).from(deliveryTripStops).where(and(eq(deliveryTripStops.tenantId, tenantId), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED']))))));
    return { unscheduledOlder: unscheduled, tripsNotCompleted: stuck, failedNotRescheduled: failed };
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('delivery-trips')
export class DeliveryTripsController {
  constructor(private readonly svc: DeliveryTripsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: TripQueryDto) {
    return this.svc.list(u.tenantId, q);
  }
  @Get('unscheduled')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  unscheduled(@CurrentUser() u: AuthUser) {
    return this.svc.unscheduled(u.tenantId);
  }
  @Get('controls')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Post()
  @Roles('ADMIN', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTripDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id/stops')
  @Roles('ADMIN', 'WAREHOUSE')
  addStops(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddStopsDto) {
    return this.svc.addStops(u, id, dto);
  }
  @Post(':id/stops/:stopId/remove')
  @Roles('ADMIN', 'WAREHOUSE')
  removeStop(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.removeStop(u, id, stopId);
  }
  @Post(':id/reorder')
  @Roles('ADMIN', 'WAREHOUSE')
  reorder(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderDto) {
    return this.svc.reorder(u, id, dto);
  }
  @Post(':id/optimize')
  @Roles('ADMIN', 'WAREHOUSE')
  optimize(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.optimize(u, id);
  }
  @Post(':id/depart')
  @Roles('ADMIN', 'WAREHOUSE')
  depart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.depart(u, id);
  }
  @Post(':id/stops/:stopId/result')
  @Roles('ADMIN', 'WAREHOUSE')
  result(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string, @Body() dto: StopResultDto) {
    return this.svc.markStop(u, id, stopId, dto);
  }
  @Post(':id/complete')
  @Roles('ADMIN', 'WAREHOUSE')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.complete(u, id);
  }
  @Post(':id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTripDto) {
    return this.svc.cancel(u, id, dto);
  }
}
