import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { DbOrTx } from '../../../db/db';
import { customers, deliveryOrders, deliveryTrips, deliveryTripStops, deliveryVehicles } from '../../../db/schema';

type NewTrip = typeof deliveryTrips.$inferInsert;
type TripPatch = Partial<typeof deliveryTrips.$inferInsert>;
type StopPatch = Partial<typeof deliveryTripStops.$inferInsert>;
type VehiclePatch = Partial<typeof deliveryVehicles.$inferInsert>;

/** Akses data rute pengiriman, stop, dan kendaraan. Setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class DeliveryTripRepository {
  // ---- rute ----
  listTrips(db: DbOrTx, tenantId: string, q: { from?: string; to?: string; status?: string }) {
    const where = [eq(deliveryTrips.tenantId, tenantId)];
    if (q.from) where.push(gte(deliveryTrips.date, q.from));
    if (q.to) where.push(lte(deliveryTrips.date, q.to));
    if (q.status) where.push(eq(deliveryTrips.status, q.status as 'PLANNED'));
    return db.select().from(deliveryTrips).where(and(...where)).orderBy(desc(deliveryTrips.date), desc(deliveryTrips.number)).limit(300);
  }

  async insertTrip(db: DbOrTx, values: NewTrip) {
    const [t] = await db.insert(deliveryTrips).values(values).returning();
    return t;
  }

  async patchTrip(db: DbOrTx, id: string, patch: TripPatch) {
    await db.update(deliveryTrips).set(patch).where(eq(deliveryTrips.id, id));
  }

  /** Simpan posisi terakhir; hanya berlaku bila rute sedang berjalan (kosong = tidak ada yang diubah) */
  setPositionIfOnRoute(db: DbOrTx, tenantId: string, id: string, lat: string, lng: string) {
    return db
      .update(deliveryTrips)
      .set({ lastLat: lat, lastLng: lng, lastPositionAt: new Date() })
      .where(and(eq(deliveryTrips.id, id), eq(deliveryTrips.tenantId, tenantId), eq(deliveryTrips.status, 'ON_ROUTE')))
      .returning({ id: deliveryTrips.id });
  }

  /** Rute yang berangkat sebelum `today` tetapi belum selesai */
  tripsNotCompletedBefore(db: DbOrTx, tenantId: string, today: string) {
    return db
      .select({ id: deliveryTrips.id, number: deliveryTrips.number, date: deliveryTrips.date })
      .from(deliveryTrips)
      .where(and(eq(deliveryTrips.tenantId, tenantId), eq(deliveryTrips.status, 'ON_ROUTE'), sql`${deliveryTrips.date} < ${today}::date`));
  }

  // ---- stop ----
  stopStatuses(db: DbOrTx, tripIds: string[]) {
    return db.select({ tripId: deliveryTripStops.tripId, status: deliveryTripStops.status }).from(deliveryTripStops).where(inArray(deliveryTripStops.tripId, tripIds));
  }

  /** Stop satu rute lengkap dengan surat jalan dan pelanggan, berurutan */
  stopsDetail(db: DbOrTx, tripId: string) {
    return db
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
      .where(eq(deliveryTripStops.tripId, tripId))
      .orderBy(asc(deliveryTripStops.sequence));
  }

  /** Koordinat pelanggan tiap stop menurut urutan rute */
  stopGeoInOrder(db: DbOrTx, tenantId: string, tripId: string) {
    return db
      .select({ lat: customers.geoLat, lng: customers.geoLng })
      .from(deliveryTripStops)
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryTripStops.tripId, tripId), eq(deliveryTripStops.tenantId, tenantId)))
      .orderBy(asc(deliveryTripStops.sequence));
  }

  customerGeo(db: DbOrTx, tenantId: string, customerIds: string[]) {
    return db.select({ id: customers.id, lat: customers.geoLat, lng: customers.geoLng }).from(customers).where(and(eq(customers.tenantId, tenantId), inArray(customers.id, customerIds)));
  }

  async deliveryGeo(db: DbOrTx, deliveryId: string) {
    const [c] = await db
      .select({ lat: customers.geoLat, lng: customers.geoLng })
      .from(deliveryOrders)
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(eq(deliveryOrders.id, deliveryId));
    return c;
  }

  async maxStopSequence(db: DbOrTx, tripId: string) {
    const [{ max }] = await db.select({ max: sql<number>`COALESCE(MAX(${deliveryTripStops.sequence}), 0)::int` }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId));
    return max;
  }

  async countStops(db: DbOrTx, tripId: string, status?: 'PENDING') {
    const [{ n }] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(deliveryTripStops)
      .where(status ? and(eq(deliveryTripStops.tripId, tripId), eq(deliveryTripStops.status, status)) : eq(deliveryTripStops.tripId, tripId));
    return n;
  }

  async insertStops(db: DbOrTx, tenantId: string, tripId: string, deliveryIds: string[], startAfter: number) {
    await db.insert(deliveryTripStops).values(deliveryIds.map((deliveryId, i) => ({ tenantId, tripId, deliveryId, sequence: startAfter + i + 1 })));
  }

  deleteStop(db: DbOrTx, tripId: string, stopId: string) {
    return db.delete(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, tripId))).returning({ id: deliveryTripStops.id });
  }

  async deleteStopsOfTrip(db: DbOrTx, tripId: string) {
    await db.delete(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId));
  }

  stopIds(db: DbOrTx, tripId: string) {
    return db.select({ id: deliveryTripStops.id }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId));
  }

  stopIdsInOrder(db: DbOrTx, tripId: string) {
    return db.select({ id: deliveryTripStops.id }).from(deliveryTripStops).where(eq(deliveryTripStops.tripId, tripId)).orderBy(asc(deliveryTripStops.sequence));
  }

  async setStopSequence(db: DbOrTx, stopId: string, sequence: number) {
    await db.update(deliveryTripStops).set({ sequence }).where(eq(deliveryTripStops.id, stopId));
  }

  async lockStop(db: DbOrTx, tripId: string, stopId: string) {
    const [s] = await db.select().from(deliveryTripStops).where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, tripId))).for('update');
    return s;
  }

  async patchStop(db: DbOrTx, stopId: string, patch: StopPatch) {
    await db.update(deliveryTripStops).set(patch).where(eq(deliveryTripStops.id, stopId));
  }

  async stopProof(db: DbOrTx, tripId: string, stopId: string) {
    const [s] = await db
      .select({ photo: deliveryTripStops.proofPhoto, signature: deliveryTripStops.proofSignature })
      .from(deliveryTripStops)
      .where(and(eq(deliveryTripStops.id, stopId), eq(deliveryTripStops.tripId, tripId)));
    return s;
  }

  // ---- surat jalan ----
  /** Surat jalan terkirim yang belum masuk rute mana pun yang berlaku */
  unscheduledDeliveries(db: DbOrTx, tenantId: string) {
    const onTrip = db
      .select({ id: deliveryTripStops.deliveryId })
      .from(deliveryTripStops)
      .where(and(eq(deliveryTripStops.tenantId, tenantId), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED'])));
    return db
      .select({ id: deliveryOrders.id, number: deliveryOrders.number, date: deliveryOrders.date, customerId: customers.id, customerName: customers.name, address: customers.address })
      .from(deliveryOrders)
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryOrders.tenantId, tenantId), eq(deliveryOrders.status, 'DELIVERED'), notInArray(deliveryOrders.id, onTrip)))
      .orderBy(asc(deliveryOrders.date), asc(deliveryOrders.number))
      .limit(300);
  }

  deliveriesByIds(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: deliveryOrders.id, number: deliveryOrders.number, status: deliveryOrders.status })
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.tenantId, tenantId), inArray(deliveryOrders.id, ids)));
  }

  /** Surat jalan di `ids` yang sudah ada di rute lain yang berlaku */
  deliveriesAlreadyOnTrip(db: DbOrTx, ids: string[]) {
    return db
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .where(and(inArray(deliveryTripStops.deliveryId, ids), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED'])));
  }

  /** Stop gagal kirim yang suratnya belum dijadwalkan ulang */
  failedNotRescheduled(db: DbOrTx, tenantId: string) {
    return db
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number, reason: deliveryTripStops.failReason })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .where(
        and(
          eq(deliveryTripStops.tenantId, tenantId),
          eq(deliveryTripStops.status, 'FAILED'),
          notInArray(
            deliveryTripStops.deliveryId,
            db
              .select({ id: deliveryTripStops.deliveryId })
              .from(deliveryTripStops)
              .where(and(eq(deliveryTripStops.tenantId, tenantId), inArray(deliveryTripStops.status, ['PENDING', 'DELIVERED']))),
          ),
        ),
      );
  }

  /** Pengiriman terkirim yang titik terimanya jauh dari lokasi pelanggan */
  deliveredFarFromCustomer(db: DbOrTx, tenantId: string, farMeters: number) {
    return db
      .select({ number: deliveryOrders.number, trip: deliveryTrips.number, customer: customers.name, distanceM: deliveryTripStops.resultDistanceM })
      .from(deliveryTripStops)
      .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripStops.tripId))
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, deliveryTripStops.deliveryId))
      .innerJoin(customers, eq(customers.id, deliveryOrders.customerId))
      .where(and(eq(deliveryTripStops.tenantId, tenantId), eq(deliveryTripStops.status, 'DELIVERED'), sql`${deliveryTripStops.resultDistanceM} > ${farMeters}`))
      .orderBy(desc(deliveryTrips.date))
      .limit(100);
  }

  // ---- kendaraan ----
  async vehicleCapacityKg(db: DbOrTx, vehicleId: string) {
    const [v] = await db.select({ c: deliveryVehicles.capacityKg }).from(deliveryVehicles).where(eq(deliveryVehicles.id, vehicleId));
    return v?.c ?? null;
  }

  listVehicles(db: DbOrTx, tenantId: string) {
    return db.select().from(deliveryVehicles).where(eq(deliveryVehicles.tenantId, tenantId)).orderBy(asc(deliveryVehicles.plate));
  }

  async plateExists(db: DbOrTx, tenantId: string, plate: string) {
    const [dup] = await db
      .select({ id: deliveryVehicles.id })
      .from(deliveryVehicles)
      .where(and(eq(deliveryVehicles.tenantId, tenantId), sql`lower(${deliveryVehicles.plate}) = ${plate.toLowerCase()}`));
    return !!dup;
  }

  async insertVehicle(db: DbOrTx, values: typeof deliveryVehicles.$inferInsert) {
    const [v] = await db.insert(deliveryVehicles).values(values).returning();
    return v;
  }

  async patchVehicle(db: DbOrTx, id: string, patch: VehiclePatch) {
    const [v] = await db.update(deliveryVehicles).set(patch).where(eq(deliveryVehicles.id, id)).returning();
    return v;
  }
}
