/**
 * Rute pengiriman: satu kendaraan/pengemudi membawa beberapa surat jalan pada satu tanggal.
 *  - Hanya surat jalan yang berstatus terkirim (DELIVERED, bukan batal) yang boleh dimasukkan, dan satu surat jalan hanya di satu rute yang
 *    masih berlaku (stop yang gagal boleh dijadwalkan ulang).
 *  - Rute: PLANNED → ON_ROUTE (berangkat, minimal satu stop) → COMPLETED (semua stop sudah diputuskan). Rute yang belum berangkat bisa dibatalkan.
 *  - Stop terkirim wajib memuat nama penerima (bukti terima); stop gagal wajib memuat alasan. Setiap perubahan tercatat di jejak audit.
 *  - Urutan stop dapat diatur manual atau diurutkan otomatis dari titik terdekat memakai koordinat pelanggan (bila ada). Jarak memakai layanan peta
 *    bila ROUTING_URL diisi (OSRM, jarak jalan); bila tidak ada atau gagal, jarak garis lurus.
 *  - Kendaraan punya kapasitas (kg) dan barang punya berat: muatan rute dihitung dari surat jalannya. Berangkat melebihi kapasitas hanya oleh Admin/Pemilik
 *    dengan alasan tertulis.
 *  - Lokasi: petugas membagikan posisi saat rute berjalan; hasil stop menyimpan lokasi dan jaraknya dari titik pelanggan (ditandai bila jauh).
 *  - Bukti terima dapat dilengkapi foto dan tanda tangan penerima.
 */
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsLatitude, IsLongitude, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { RequireApp } from '../../../common/apps/app.guard';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { Db, DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, deliveryOrders, deliveryTrips, deliveryTripStops, deliveryVehicles } from '../../../db/schema';
import { haversineM } from '../canvass/canvass';

export class CreateTripDto {
  @ApiPropertyOptional({ example: '2026-10-20', description: 'Tanggal pengiriman (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 'B 1234 XY' }) @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @ApiPropertyOptional({ description: 'Kendaraan terdaftar (kapasitas dipakai untuk memeriksa muatan)' }) @IsOptional() @IsUUID() vehicleId?: string;
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
const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 450_000; // ± 330 KB gambar

export class DepartDto {
  @ApiPropertyOptional({ description: 'Berangkat walau muatan melebihi kapasitas (hanya Admin/Pemilik, wajib alasan)' }) @IsOptional() @IsBoolean() acceptOverCapacity?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) reason?: string;
}
export class PositionDto {
  @ApiProperty() @IsLatitude() lat: number;
  @ApiProperty() @IsLongitude() lng: number;
}
export class VehicleDto {
  @ApiProperty({ example: 'B 1234 XY' }) @IsString() @MinLength(3) @MaxLength(20) plate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional({ example: '1500', description: 'Kapasitas muat (kg); kosong = tanpa batas' }) @IsOptional() @IsNumberString() capacityKg?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) defaultDriver?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class StopResultDto {
  @ApiProperty({ enum: ['DELIVERED', 'FAILED'] }) @IsIn(['DELIVERED', 'FAILED']) result: 'DELIVERED' | 'FAILED';
  @ApiPropertyOptional({ description: 'Nama penerima (wajib bila terkirim)' }) @IsOptional() @IsString() @MaxLength(120) receivedBy?: string;
  @ApiPropertyOptional({ description: 'Alasan gagal (wajib bila gagal)' }) @IsOptional() @IsString() @MaxLength(300) failReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'Lokasi saat hasil dicatat' }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'Foto bukti (data URL png/jpeg/webp, maks ± 330 KB)' }) @IsOptional() @IsString() @MaxLength(MAX_IMAGE_CHARS) @Matches(IMAGE_URL, { message: 'Foto harus berupa gambar png/jpeg/webp' }) photo?: string;
  @ApiPropertyOptional({ description: 'Tanda tangan penerima (data URL png/jpeg/webp)' }) @IsOptional() @IsString() @MaxLength(MAX_IMAGE_CHARS) @Matches(IMAGE_URL, { message: 'Tanda tangan harus berupa gambar png/jpeg/webp' }) signature?: string;
}
export class CancelTripDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
export class TripQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['PLANNED', 'ON_ROUTE', 'COMPLETED', 'CANCELLED']) status?: string;
}

/** Jarak antar dua titik (meter); bawaan garis lurus */
export type DistFn = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number;
const straight: DistFn = (a, b) => haversineM(a.lat, a.lng, b.lat, b.lng);

/** Urutan terdekat (nearest neighbour) dimulai dari stop pertama yang berkoordinat; stop tanpa koordinat tetap di belakang dengan urutan semula */
export function nearestOrder<T extends { id: string; lat: number | null; lng: number | null }>(stops: T[], dist: DistFn = straight): T[] {
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
      const d = dist({ lat: cur.lat!, lng: cur.lng! }, { lat: s.lat!, lng: s.lng! });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return [...out, ...without];
}

/** Jarak jalan dari layanan peta kompatibel OSRM (ROUTING_URL, mis. server OSRM sendiri); gagal/tidak diisi → garis lurus. Tidak pernah melempar galat. */
@Injectable()
export class RoutingService {
  async matrix(points: { lat: number; lng: number }[]): Promise<{ dist: DistFn; source: 'JALAN' | 'LURUS' }> {
    const base = process.env.ROUTING_URL?.replace(/\/+$/, '');
    if (!base || points.length < 2 || points.length > 100) return { dist: straight, source: 'LURUS' };
    try {
      const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const res = await fetch(`${base}/table/v1/driving/${coords}?annotations=distance`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { code?: string; distances?: (number | null)[][] };
      const m = body.distances;
      if (body.code !== 'Ok' || !m || m.length !== points.length || m.some((r) => !r || r.length !== points.length)) throw new Error('bentuk jawaban tidak sesuai');
      const key = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
      const index = new Map(points.map((p, i) => [key(p), i]));
      const dist: DistFn = (a, b) => {
        const i = index.get(key(a));
        const j = index.get(key(b));
        const v = i === undefined || j === undefined ? null : m[i][j];
        return v === null || v === undefined ? straight(a, b) : v;
      };
      return { dist, source: 'JALAN' };
    } catch {
      return { dist: straight, source: 'LURUS' };
    }
  }
}

/** Jarak maksimum titik pencatatan dari lokasi pelanggan sebelum ditandai mencurigakan */
export const FAR_DELIVERY_M = 300;

@Injectable()
export class DeliveryTripsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly routing: RoutingService,
    private readonly storage: StorageService,
  ) {}

  private async trip(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [t] = await db.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, tenantId)));
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

  /** Muatan rute (kg) dari berat barang pada surat jalannya; stop gagal tidak dihitung */
  private async load(tripId: string, db: DbOrTx = this.db) {
    const r = await db.execute<{ kg: string; unweighted: number }>(sql`
      SELECT COALESCE(SUM(dol.qty * dol.uom_factor * COALESCE(p.weight_kg, 0)), 0)::text AS kg,
             COUNT(DISTINCT dol.product_id) FILTER (WHERE p.weight_kg IS NULL)::int AS unweighted
      FROM delivery_trip_stops s
      JOIN delivery_order_lines dol ON dol.delivery_id = s.delivery_id
      JOIN products p ON p.id = dol.product_id
      WHERE s.trip_id = ${tripId} AND s.status <> 'FAILED'`);
    return { loadKg: Number(r.rows[0].kg), unweightedProducts: r.rows[0].unweighted };
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const t = await this.trip(tenantId, id, db);
    const stops = await db
      .select({
        id: deliveryTripStops.id,
        sequence: deliveryTripStops.sequence,
        status: deliveryTripStops.status,
        receivedBy: deliveryTripStops.receivedBy,
        receivedAt: deliveryTripStops.receivedAt,
        failReason: deliveryTripStops.failReason,
        note: deliveryTripStops.note,
        resultDistanceM: deliveryTripStops.resultDistanceM,
        hasPhoto: sql<boolean>`(${deliveryTripStops.proofPhoto} IS NOT NULL)`,
        hasSignature: sql<boolean>`(${deliveryTripStops.proofSignature} IS NOT NULL)`,
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
    let capacityKg: number | null = null;
    if (t.vehicleId) {
      const [v] = await db.select({ c: deliveryVehicles.capacityKg }).from(deliveryVehicles).where(eq(deliveryVehicles.id, t.vehicleId));
      capacityKg = v?.c != null ? Number(v.c) : null;
    }
    const { loadKg, unweightedProducts } = await this.load(id, db);
    return {
      ...t,
      stops: stops.map((s) => ({ ...s, farFromCustomer: s.resultDistanceM !== null && s.resultDistanceM > FAR_DELIVERY_M })),
      loadKg,
      capacityKg,
      overCapacity: capacityKg !== null && loadKg > capacityKg,
      unweightedProducts,
    };
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
      let vehicle = dto.vehicle?.trim() || null;
      let driver = dto.driverName?.trim() || null;
      if (dto.vehicleId) {
        const [v] = await tx.select().from(deliveryVehicles).where(and(eq(deliveryVehicles.id, dto.vehicleId), eq(deliveryVehicles.tenantId, u.tenantId)));
        if (!v) throw new BadRequestException('Kendaraan tidak ditemukan');
        if (!v.isActive) throw new BadRequestException(`Kendaraan ${v.plate} tidak aktif`);
        vehicle = v.plate;
        driver = driver ?? v.defaultDriver;
      }
      const number = await this.seq.next(tx, u.tenantId, 'DELIVERY_TRIP', date);
      const [t] = await tx.insert(deliveryTrips).values({ tenantId: u.tenantId, number, date, vehicle, vehicleId: dto.vehicleId ?? null, driverName: driver, notes: dto.notes?.trim() || null, createdById: u.sub }).returning();
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
    await this.refreshDistance(u.tenantId, id);
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
    await this.refreshDistance(u.tenantId, id);
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
    await this.refreshDistance(u.tenantId, id);
    return this.get(u.tenantId, id);
  }

  /** Susun ulang stop menurut titik terdekat (koordinat pelanggan) */
  /** Hitung ulang jarak rute (sesuai urutan stop yang berkoordinat) dan simpan beserta sumbernya */
  private async refreshDistance(tenantId: string, tripId: string) {
    const stops = await this.db
      .select({ lat: customers.geoLat, lng: customers.geoLng })
      .from(deliveryTripStops)
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryTripStops.tripId, tripId), eq(deliveryTripStops.tenantId, tenantId)))
      .orderBy(asc(deliveryTripStops.sequence));
    const pts = stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
    if (pts.length < 2) {
      await this.db.update(deliveryTrips).set({ distanceM: null, distanceSource: null }).where(eq(deliveryTrips.id, tripId));
      return;
    }
    const { dist, source } = await this.routing.matrix(pts);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    await this.db.update(deliveryTrips).set({ distanceM: Math.round(total), distanceSource: source }).where(eq(deliveryTrips.id, tripId));
  }

  /** Susun ulang stop menurut titik terdekat (jarak jalan bila layanan peta tersedia, selain itu garis lurus) */
  async optimize(u: AuthUser, id: string) {
    const t = await this.get(u.tenantId, id);
    this.assertPlanned(t);
    const geo = await this.db.select({ id: customers.id, lat: customers.geoLat, lng: customers.geoLng }).from(customers).where(and(eq(customers.tenantId, u.tenantId), inArray(customers.id, [...new Set(t.stops.map((s) => s.customerId))])));
    const g = new Map(geo.map((c) => [c.id, c]));
    const rows = t.stops.map((s) => ({ id: s.id, lat: g.get(s.customerId)?.lat != null ? Number(g.get(s.customerId)!.lat) : null, lng: g.get(s.customerId)?.lng != null ? Number(g.get(s.customerId)!.lng) : null }));
    const pts = rows.filter((r) => r.lat !== null && r.lng !== null).map((r) => ({ lat: r.lat!, lng: r.lng! }));
    const { dist } = await this.routing.matrix(pts);
    const ordered = nearestOrder(rows, dist);
    return this.reorder(u, id, { stopIds: ordered.map((r) => r.id) });
  }

  async depart(u: AuthUser, id: string, dto: DepartDto = {}) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const [{ n }] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, id));
      if (!n) throw new BadRequestException('Rute belum punya stop; tambahkan surat jalan dulu');
      const cur = await this.get(u.tenantId, id, tx);
      let overReason: string | null = null;
      if (cur.overCapacity) {
        const may = u.role === 'OWNER' || u.role === 'ADMIN';
        if (!dto.acceptOverCapacity || !may || !dto.reason?.trim()) {
          throw new BadRequestException(`Muatan ${cur.loadKg.toFixed(1)} kg melebihi kapasitas ${cur.capacityKg!.toFixed(1)} kg. ${may ? 'Kurangi surat jalan, atau berangkatkan dengan menyatakan alasan.' : 'Kurangi surat jalan, atau minta Admin/Pemilik menyetujui.'}`);
        }
        overReason = dto.reason.trim();
      }
      await tx.update(deliveryTrips).set({ status: 'ON_ROUTE', departedAt: new Date(), overCapacityReason: overReason }).where(eq(deliveryTrips.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'DEPART', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stops: n, vehicle: t.vehicle, driver: t.driverName, loadKg: cur.loadKg, capacityKg: cur.capacityKg, overCapacityReason: overReason } });
    });
    return this.get(u.tenantId, id);
  }

  /** Lokasi terbaru yang dibagikan petugas saat rute berjalan (hanya posisi terakhir yang disimpan) */
  async position(u: AuthUser, id: string, dto: PositionDto) {
    const r = await this.db
      .update(deliveryTrips)
      .set({ lastLat: dto.lat.toFixed(6), lastLng: dto.lng.toFixed(6), lastPositionAt: new Date() })
      .where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId), eq(deliveryTrips.status, 'ON_ROUTE')))
      .returning({ id: deliveryTrips.id });
    if (!r.length) {
      await this.trip(u.tenantId, id);
      throw new BadRequestException('Lokasi hanya bisa dibagikan saat rute sedang berjalan');
    }
    return { ok: true };
  }

  async markStop(u: AuthUser, id: string, stopId: string, dto: StopResultDto) {
    const receivedBy = dto.receivedBy?.trim();
    const failReason = dto.failReason?.trim();
    if (dto.result === 'DELIVERED' && (!receivedBy || receivedBy.length < 2)) throw new BadRequestException('Nama penerima wajib diisi sebagai bukti terima');
    if (dto.result === 'FAILED' && (!failReason || failReason.length < 3)) throw new BadRequestException('Alasan gagal kirim wajib diisi');
    if ((dto.lat === undefined) !== (dto.lng === undefined)) throw new BadRequestException('Lintang dan bujur harus diisi bersamaan');
    if (dto.result === 'FAILED' && (dto.photo || dto.signature)) throw new BadRequestException('Foto dan tanda tangan hanya untuk pengiriman yang terkirim');
    // gambar diunggah lebih dulu (isinya divalidasi); bila pencatatan gagal, berkas yatim dihapus lagi
    const photoRef = await this.storage.store(u.tenantId, 'bukti-kirim', dto.photo);
    const signatureRef = await this.storage.store(u.tenantId, 'tanda-tangan', dto.signature);
    await this.storage.guard([photoRef, signatureRef], () => this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTrips).where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, u.tenantId))).for('update');
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      if (t.status !== 'ON_ROUTE') throw new BadRequestException('Hasil pengiriman hanya bisa dicatat saat rute sedang berjalan');
      const [s] = await tx.select().from(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, id))).for('update');
      if (!s) throw new NotFoundException('Stop tidak ditemukan');
      if (s.status !== 'PENDING') throw new BadRequestException('Hasil stop ini sudah dicatat dan tidak bisa diubah');
      let distance: number | null = null;
      if (dto.lat !== undefined && dto.lng !== undefined) {
        const [c] = await tx.select({ lat: customers.geoLat, lng: customers.geoLng }).from(deliveryOrders).innerJoin(customers, eq(customers.id, deliveryOrders.customerId)).where(eq(deliveryOrders.id, s.deliveryId));
        if (c?.lat != null && c?.lng != null) distance = haversineM(dto.lat, dto.lng, Number(c.lat), Number(c.lng));
      }
      await tx.update(deliveryTripStops).set({
        status: dto.result,
        receivedBy: dto.result === 'DELIVERED' ? receivedBy : null,
        receivedAt: dto.result === 'DELIVERED' ? new Date() : null,
        failReason: dto.result === 'FAILED' ? failReason : null,
        note: dto.note?.trim() || null,
        resultLat: dto.lat !== undefined ? dto.lat.toFixed(6) : null,
        resultLng: dto.lng !== undefined ? dto.lng.toFixed(6) : null,
        resultDistanceM: distance,
        proofPhoto: photoRef,
        proofSignature: signatureRef,
      }).where(eq(deliveryTripStops.id, stopId));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.result === 'DELIVERED' ? 'STOP_DELIVERED' : 'STOP_FAILED', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stop: s.sequence, receivedBy, failReason, distanceM: distance, photo: !!dto.photo, signature: !!dto.signature } });
    }));
    return this.get(u.tenantId, id);
  }

  /** Foto dan tanda tangan bukti terima satu stop */
  async proof(tenantId: string, id: string, stopId: string) {
    await this.trip(tenantId, id);
    const [s] = await this.db.select({ photo: deliveryTripStops.proofPhoto, signature: deliveryTripStops.proofSignature }).from(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, id)));
    if (!s) throw new NotFoundException('Stop tidak ditemukan');
    return { photo: await this.storage.load(tenantId, s.photo), signature: await this.storage.load(tenantId, s.signature) };
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
    const far = await this.db
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number, customer: customers.name, distanceM: deliveryTripStops.resultDistanceM })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryTripStops.tenantId, tenantId), eq(deliveryTripStops.status, 'DELIVERED'), sql`${deliveryTripStops.resultDistanceM} > ${FAR_DELIVERY_M}`))
      .orderBy(desc(deliveryTrips.date))
      .limit(100);
    return { unscheduledOlder: unscheduled, tripsNotCompleted: stuck, failedNotRescheduled: failed, farDelivered: far };
  }
}

@Injectable()
export class DeliveryVehiclesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.select().from(deliveryVehicles).where(eq(deliveryVehicles.tenantId, tenantId)).orderBy(asc(deliveryVehicles.plate));
  }

  async create(u: AuthUser, dto: VehicleDto) {
    const plate = dto.plate.trim().toUpperCase();
    const [dup] = await this.db.select({ id: deliveryVehicles.id }).from(deliveryVehicles).where(and(eq(deliveryVehicles.tenantId, u.tenantId), sql`lower(${deliveryVehicles.plate}) = ${plate.toLowerCase()}`));
    if (dup) throw new BadRequestException(`Kendaraan ${plate} sudah terdaftar`);
    const [v] = await this.db.insert(deliveryVehicles).values({ tenantId: u.tenantId, plate, name: dto.name?.trim() || null, capacityKg: dto.capacityKg ?? null, defaultDriver: dto.defaultDriver?.trim() || null }).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'DeliveryVehicle', entityId: v.id, data: { plate, capacityKg: dto.capacityKg } });
    return v;
  }

  async update(u: AuthUser, id: string, dto: Partial<VehicleDto>) {
    const [cur] = await this.db.select().from(deliveryVehicles).where(and(eq(deliveryVehicles.id, id), eq(deliveryVehicles.tenantId, u.tenantId)));
    if (!cur) throw new NotFoundException('Kendaraan tidak ditemukan');
    const plate = dto.plate?.trim().toUpperCase();
    if (plate && plate.toLowerCase() !== cur.plate.toLowerCase()) {
      const [dup] = await this.db.select({ id: deliveryVehicles.id }).from(deliveryVehicles).where(and(eq(deliveryVehicles.tenantId, u.tenantId), sql`lower(${deliveryVehicles.plate}) = ${plate.toLowerCase()}`));
      if (dup) throw new BadRequestException(`Kendaraan ${plate} sudah terdaftar`);
    }
    const [v] = await this.db.update(deliveryVehicles).set({ plate, name: dto.name === undefined ? undefined : dto.name.trim() || null, capacityKg: dto.capacityKg, defaultDriver: dto.defaultDriver === undefined ? undefined : dto.defaultDriver.trim() || null, isActive: dto.isActive }).where(eq(deliveryVehicles.id, id)).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'DeliveryVehicle', entityId: id, data: { before: { plate: cur.plate, capacityKg: cur.capacityKg, isActive: cur.isActive }, after: { plate: v.plate, capacityKg: v.capacityKg, isActive: v.isActive } } });
    return v;
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('delivery-vehicles')
export class DeliveryVehiclesController {
  constructor(private readonly svc: DeliveryVehiclesService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }
  @Post()
  @Roles('ADMIN', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: VehicleDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id')
  @Roles('ADMIN', 'WAREHOUSE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VehicleDto) {
    return this.svc.update(u, id, dto);
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
  depart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepartDto) {
    return this.svc.depart(u, id, dto);
  }
  @Post(':id/position')
  @Roles('ADMIN', 'WAREHOUSE')
  position(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PositionDto) {
    return this.svc.position(u, id, dto);
  }
  @Get(':id/stops/:stopId/proof')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  proof(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.proof(u.tenantId, id, stopId);
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
