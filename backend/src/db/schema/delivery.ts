// Skema database — delivery
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';
import { tenantId } from './tenancy';
import { deliveryOrders } from './sales';

/** Kendaraan pengiriman beserta kapasitas muat (kg); kosong = tanpa batas */
export const deliveryVehicles = pgTable(
  'delivery_vehicles',
  {
    id: id(),
    tenantId: tenantId(),
    plate: text('plate').notNull(),
    name: text('name'),
    capacityKg: numeric('capacity_kg', { precision: 18, scale: 2 }),
    defaultDriver: text('default_driver'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('delivery_vehicles_plate_uq').on(t.tenantId, sql`lower(${t.plate})`)],
);

/** Rute pengiriman: satu kendaraan/pengemudi membawa beberapa surat jalan pada satu tanggal */
export const deliveryTrips = pgTable(
  'delivery_trips',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    vehicle: text('vehicle'),
    driverName: text('driver_name'),
    status: text('status').$type<'PLANNED' | 'ON_ROUTE' | 'COMPLETED' | 'CANCELLED'>().notNull().default('PLANNED'),
    notes: text('notes'),
    departedAt: timestamp('departed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    vehicleId: uuid('vehicle_id').references(() => deliveryVehicles.id),
    /** Jarak rute (meter) dan sumbernya: JALAN (layanan peta) atau LURUS (garis lurus antar titik) */
    distanceM: integer('distance_m'),
    distanceSource: text('distance_source').$type<'JALAN' | 'LURUS'>(),
    /** Lokasi terakhir yang dibagikan petugas saat rute berjalan */
    lastLat: numeric('last_lat', { precision: 9, scale: 6 }),
    lastLng: numeric('last_lng', { precision: 9, scale: 6 }),
    lastPositionAt: timestamp('last_position_at', { withTimezone: true }),
    /** Alasan Admin/Pemilik memberangkatkan muatan melebihi kapasitas */
    overCapacityReason: text('over_capacity_reason'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('delivery_trips_number_uq').on(t.tenantId, t.number), index('delivery_trips_date_idx').on(t.tenantId, t.date)],
);

export const deliveryTripStops = pgTable(
  'delivery_trip_stops',
  {
    id: id(),
    tenantId: tenantId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => deliveryTrips.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveryOrders.id),
    sequence: integer('sequence').notNull(),
    status: text('status').$type<'PENDING' | 'DELIVERED' | 'FAILED'>().notNull().default('PENDING'),
    receivedBy: text('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    failReason: text('fail_reason'),
    note: text('note'),
    /** Lokasi saat hasil dicatat dan jaraknya dari titik pelanggan (meter) */
    resultLat: numeric('result_lat', { precision: 9, scale: 6 }),
    resultLng: numeric('result_lng', { precision: 9, scale: 6 }),
    resultDistanceM: integer('result_distance_m'),
    /** Foto bukti dan tanda tangan penerima (data URL gambar, dikompres di tampilan) */
    proofPhoto: text('proof_photo'),
    proofSignature: text('proof_signature'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_trip_stops_active_uq').on(t.deliveryId).where(sql`${t.status} IN ('PENDING', 'DELIVERED')`),
    index('delivery_trip_stops_trip_idx').on(t.tripId, t.sequence),
  ],
);
