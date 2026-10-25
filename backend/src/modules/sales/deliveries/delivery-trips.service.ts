import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { Db, DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { deliveryTrips, deliveryVehicles } from '../../../db/schema';
import { haversineM } from '../canvass/canvass.service';
import { TripQueryDto, CreateTripDto, AddStopsDto, ReorderDto, DepartDto, PositionDto, StopResultDto, CancelTripDto, VehicleDto } from './delivery-trips.dto';
import { findOwned, lockOwned } from '../../../db/owned';
import { DeliveryTripRepository } from './delivery-trip.repository';

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
    private readonly repo: DeliveryTripRepository,
  ) {}

  private async trip(tenantId: string, id: string, db: DbOrTx = this.db) {
    const t = await findOwned(db, deliveryTrips, tenantId, id);
    if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
    return t;
  }

  async list(tenantId: string, q: TripQueryDto) {
    const trips = await this.repo.listTrips(this.db, tenantId, q);
    if (!trips.length) return [];
    const stops = await this.repo.stopStatuses(this.db, trips.map((t) => t.id));
    return trips.map((t) => {
      const s = stops.filter((x) => x.tripId === t.id);
      return { ...t, stops: s.length, delivered: s.filter((x) => x.status === 'DELIVERED').length, failed: s.filter((x) => x.status === 'FAILED').length, pending: s.filter((x) => x.status === 'PENDING').length };
    });
  }

  /** Muatan rute (kg) dari berat barang pada surat jalannya; stop gagal tidak dihitung */
  private async load(tripId: string, db: DbOrTx = this.db) {
    const r = await this.repo.queryDeliveryTripStop(db, tripId);
    return { loadKg: Number(r.rows[0].kg), unweightedProducts: r.rows[0].unweighted };
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const t = await this.trip(tenantId, id, db);
    const stops = await this.repo.stopsDetail(db, id);
    let capacityKg: number | null = null;
    if (t.vehicleId) {
      const cap = await this.repo.vehicleCapacityKg(db, t.vehicleId);
      capacityKg = cap != null ? Number(cap) : null;
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
    return this.repo.unscheduledDeliveries(this.db, tenantId);
  }

  private async addStopsTx(tx: Db, tenantId: string, tripId: string, deliveryIds: string[]) {
    const unique = [...new Set(deliveryIds)];
    if (unique.length !== deliveryIds.length) throw new BadRequestException('Surat jalan ganda dalam satu permintaan');
    const dos = await this.repo.deliveriesByIds(tx, tenantId, unique);
    if (dos.length !== unique.length) throw new BadRequestException('Ada surat jalan yang tidak ditemukan');
    const cancelled = dos.filter((d) => d.status !== 'DELIVERED');
    if (cancelled.length) throw new BadRequestException(`Surat jalan batal tidak bisa dikirim: ${cancelled.map((d) => d.number).join(', ')}`);
    const busy = await this.repo.deliveriesAlreadyOnTrip(tx, unique);
    if (busy.length) throw new BadRequestException(`Sudah ada di rute lain: ${busy.map((b) => `${b.number} (${b.trip})`).join(', ')}`);
    const max = await this.repo.maxStopSequence(tx, tripId);
    await this.repo.insertStops(tx, tenantId, tripId, unique, max);
  }

  async create(u: AuthUser, dto: CreateTripDto) {
    const date = toDocDate(dto.date ?? todayJakarta());
    return this.db.transaction(async (tx) => {
      let vehicle = dto.vehicle?.trim() || null;
      let driver = dto.driverName?.trim() || null;
      if (dto.vehicleId) {
        const v = await findOwned(tx, deliveryVehicles, u.tenantId, dto.vehicleId);
        if (!v) throw new BadRequestException('Kendaraan tidak ditemukan');
        if (!v.isActive) throw new BadRequestException(`Kendaraan ${v.plate} tidak aktif`);
        vehicle = v.plate;
        driver = driver ?? v.defaultDriver;
      }
      const number = await this.seq.next(tx, u.tenantId, 'DELIVERY_TRIP', date);
      const t = await this.repo.insertTrip(tx, { tenantId: u.tenantId, number, date, vehicle, vehicleId: dto.vehicleId ?? null, driverName: driver, notes: dto.notes?.trim() || null, createdById: u.sub });
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
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
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
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const del = await this.repo.deleteStop(tx, id, stopId);
      if (!del.length) throw new NotFoundException('Stop tidak ditemukan');
      await this.renumber(tx as unknown as Db, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REMOVE_STOP', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    await this.refreshDistance(u.tenantId, id);
    return this.get(u.tenantId, id);
  }

  private async renumber(tx: Db, tripId: string) {
    const rows = await this.repo.stopIdsInOrder(tx, tripId);
    for (let i = 0; i < rows.length; i++) await this.repo.setStopSequence(tx, rows[i].id, i + 1);
  }

  async reorder(u: AuthUser, id: string, dto: ReorderDto) {
    await this.db.transaction(async (tx) => {
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const cur = await this.repo.stopIds(tx, id);
      const a = new Set(cur.map((c) => c.id));
      if (dto.stopIds.length !== a.size || dto.stopIds.some((s) => !a.has(s)) || new Set(dto.stopIds).size !== a.size) throw new BadRequestException('Daftar stop harus memuat semua stop rute ini, tepat satu kali');
      for (let i = 0; i < dto.stopIds.length; i++) await this.repo.setStopSequence(tx, dto.stopIds[i], i + 1);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REORDER', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    await this.refreshDistance(u.tenantId, id);
    return this.get(u.tenantId, id);
  }

  /** Susun ulang stop menurut titik terdekat (koordinat pelanggan) */
  /** Hitung ulang jarak rute (sesuai urutan stop yang berkoordinat) dan simpan beserta sumbernya */
  private async refreshDistance(tenantId: string, tripId: string) {
    const stops = await this.repo.stopGeoInOrder(this.db, tenantId, tripId);
    const pts = stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
    if (pts.length < 2) {
      await this.repo.patchTrip(this.db, tripId, { distanceM: null, distanceSource: null });
      return;
    }
    const { dist, source } = await this.routing.matrix(pts);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    await this.repo.patchTrip(this.db, tripId, { distanceM: Math.round(total), distanceSource: source });
  }

  /** Susun ulang stop menurut titik terdekat (jarak jalan bila layanan peta tersedia, selain itu garis lurus) */
  async optimize(u: AuthUser, id: string) {
    const t = await this.get(u.tenantId, id);
    this.assertPlanned(t);
    const geo = await this.repo.customerGeo(this.db, u.tenantId, [...new Set(t.stops.map((s) => s.customerId))]);
    const g = new Map(geo.map((c) => [c.id, c]));
    const rows = t.stops.map((s) => ({ id: s.id, lat: g.get(s.customerId)?.lat != null ? Number(g.get(s.customerId)!.lat) : null, lng: g.get(s.customerId)?.lng != null ? Number(g.get(s.customerId)!.lng) : null }));
    const pts = rows.filter((r) => r.lat !== null && r.lng !== null).map((r) => ({ lat: r.lat!, lng: r.lng! }));
    const { dist } = await this.routing.matrix(pts);
    const ordered = nearestOrder(rows, dist);
    return this.reorder(u, id, { stopIds: ordered.map((r) => r.id) });
  }

  async depart(u: AuthUser, id: string, dto: DepartDto = {}) {
    await this.db.transaction(async (tx) => {
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      const n = await this.repo.countStops(tx, id);
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
      await this.repo.patchTrip(tx, id, { status: 'ON_ROUTE', departedAt: new Date(), overCapacityReason: overReason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'DEPART', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stops: n, vehicle: t.vehicle, driver: t.driverName, loadKg: cur.loadKg, capacityKg: cur.capacityKg, overCapacityReason: overReason } });
    });
    return this.get(u.tenantId, id);
  }

  /** Lokasi terbaru yang dibagikan petugas saat rute berjalan (hanya posisi terakhir yang disimpan) */
  async position(u: AuthUser, id: string, dto: PositionDto) {
    const r = await this.repo.setPositionIfOnRoute(this.db, u.tenantId, id, dto.lat.toFixed(6), dto.lng.toFixed(6));
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
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      if (t.status !== 'ON_ROUTE') throw new BadRequestException('Hasil pengiriman hanya bisa dicatat saat rute sedang berjalan');
      const s = await this.repo.lockStop(tx, id, stopId);
      if (!s) throw new NotFoundException('Stop tidak ditemukan');
      if (s.status !== 'PENDING') throw new BadRequestException('Hasil stop ini sudah dicatat dan tidak bisa diubah');
      let distance: number | null = null;
      if (dto.lat !== undefined && dto.lng !== undefined) {
        const c = await this.repo.deliveryGeo(tx, s.deliveryId);
        if (c?.lat != null && c?.lng != null) distance = haversineM(dto.lat, dto.lng, Number(c.lat), Number(c.lng));
      }
      await this.repo.patchStop(tx, stopId, {
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
      });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: dto.result === 'DELIVERED' ? 'STOP_DELIVERED' : 'STOP_FAILED', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, stop: s.sequence, receivedBy, failReason, distanceM: distance, photo: !!dto.photo, signature: !!dto.signature } });
    }));
    return this.get(u.tenantId, id);
  }

  /** Foto dan tanda tangan bukti terima satu stop */
  async proof(tenantId: string, id: string, stopId: string) {
    await this.trip(tenantId, id);
    const s = await this.repo.stopProof(this.db, id, stopId);
    if (!s) throw new NotFoundException('Stop tidak ditemukan');
    return { photo: await this.storage.load(tenantId, s.photo), signature: await this.storage.load(tenantId, s.signature) };
  }

  async complete(u: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      if (t.status !== 'ON_ROUTE') throw new BadRequestException('Hanya rute yang sedang berjalan yang bisa diselesaikan');
      const n = await this.repo.countStops(tx, id, 'PENDING');
      if (n) throw new BadRequestException(`Masih ada ${n} stop yang belum diputuskan (terkirim atau gagal)`);
      await this.repo.patchTrip(tx, id, { status: 'COMPLETED', completedAt: new Date() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'COMPLETE', entity: 'DeliveryTrip', entityId: id, data: { number: t.number } });
    });
    return this.get(u.tenantId, id);
  }

  async cancel(u: AuthUser, id: string, dto: CancelTripDto) {
    await this.db.transaction(async (tx) => {
      const t = await lockOwned(tx, deliveryTrips, u.tenantId, id);
      if (!t) throw new NotFoundException('Rute pengiriman tidak ditemukan');
      this.assertPlanned(t);
      await this.repo.deleteStopsOfTrip(tx, id);
      await this.repo.patchTrip(tx, id, { status: 'CANCELLED', cancelReason: dto.reason.trim() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'DeliveryTrip', entityId: id, data: { number: t.number, reason: dto.reason } });
    });
    return this.get(u.tenantId, id);
  }

  /** Peringatan kontrol: surat jalan lama belum dijadwalkan, rute berangkat lebih dari 1 hari belum selesai, stop gagal belum dijadwalkan ulang */
  async controls(tenantId: string, today = todayJakarta()) {
    const unscheduled = (await this.unscheduled(tenantId)).filter((d) => d.date < today);
    const stuck = await this.repo.tripsNotCompletedBefore(this.db, tenantId, today);
    const failed = await this.repo.failedNotRescheduled(this.db, tenantId);
    const far = await this.repo.deliveredFarFromCustomer(this.db, tenantId, FAR_DELIVERY_M);
    return { unscheduledOlder: unscheduled, tripsNotCompleted: stuck, failedNotRescheduled: failed, farDelivered: far };
  }
}

@Injectable()
export class DeliveryVehiclesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly repo: DeliveryTripRepository,
  ) {}

  list(tenantId: string) {
    return this.repo.listVehicles(this.db, tenantId);
  }

  async create(u: AuthUser, dto: VehicleDto) {
    const plate = dto.plate.trim().toUpperCase();
    if (await this.repo.plateExists(this.db, u.tenantId, plate)) throw new BadRequestException(`Kendaraan ${plate} sudah terdaftar`);
    const v = await this.repo.insertVehicle(this.db, { tenantId: u.tenantId, plate, name: dto.name?.trim() || null, capacityKg: dto.capacityKg ?? null, defaultDriver: dto.defaultDriver?.trim() || null });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'DeliveryVehicle', entityId: v.id, data: { plate, capacityKg: dto.capacityKg } });
    return v;
  }

  async update(u: AuthUser, id: string, dto: Partial<VehicleDto>) {
    const cur = await findOwned(this.db, deliveryVehicles, u.tenantId, id);
    if (!cur) throw new NotFoundException('Kendaraan tidak ditemukan');
    const plate = dto.plate?.trim().toUpperCase();
    if (plate && plate.toLowerCase() !== cur.plate.toLowerCase()) {
      if (await this.repo.plateExists(this.db, u.tenantId, plate)) throw new BadRequestException(`Kendaraan ${plate} sudah terdaftar`);
    }
    const v = await this.repo.patchVehicle(this.db, id, { plate, name: dto.name === undefined ? undefined : dto.name.trim() || null, capacityKg: dto.capacityKg, defaultDriver: dto.defaultDriver === undefined ? undefined : dto.defaultDriver.trim() || null, isActive: dto.isActive });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'DeliveryVehicle', entityId: id, data: { before: { plate: cur.plate, capacityKg: cur.capacityKg, isActive: cur.isActive }, after: { plate: v.plate, capacityKg: v.capacityKg, isActive: v.isActive } } });
    return v;
  }
}
