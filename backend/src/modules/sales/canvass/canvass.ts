/**
 * Kanvas / van sales. Setiap sales kanvas punya gudang "mobil" sendiri (stok dimuat/dibongkar gudang). Sales menjual dari mobilnya
 * lewat satu langkah (pesanan → konfirmasi → faktur) TANPA bisa mengubah harga atau potongan: harga selalu dari daftar harga outlet
 * dan promo yang berlaku. Uang tagihan yang diterima di lapangan dicatat sebagai setoran berstatus menunggu dan baru menjadi
 * pelunasan setelah Keuangan menerima uangnya; kekurangan setoran tercatat atas nama sales. Kunjungan dicatat satu per outlet per
 * hari dengan koordinat dan jarak ke outlet. Stok mobil diperiksa lewat stock opname gudang mobil seperti gudang biasa.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { canvassCollections, customers, invoices, salesRouteStops, salesRoutes, salesVisits, users, warehouses } from '../../../db/schema';
import { WarehouseOpsService } from '../../inventory/warehouse-ops';
import { InvoicesService } from '../invoices/invoices.service';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { PaymentsService } from '../payments/payments.service';

/** Jarak maksimum kunjungan dari titik outlet sebelum ditandai mencurigakan */
const FAR_METERS = 300;
const STALE_DAYS = 2;

export const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
};

export class VanDto {
  @ApiProperty({ description: 'Pengguna berperan Sales pemilik mobil' }) @IsUUID() userId: string;
}
export class VanLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '48', description: 'Satuan dasar' }) @IsNumberString() qty: string;
}
export class VanMoveDto {
  @ApiProperty({ description: 'Gudang biasa (asal saat muat, tujuan saat bongkar)' }) @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [VanLineDto] }) @ValidateNested({ each: true }) @Type(() => VanLineDto) @ArrayMinSize(1) @ArrayMaxSize(500) lines: VanLineDto[];
}
export class CanvassLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '6' }) @IsNumberString() qty: string;
}
export class CollectDto {
  @ApiProperty({ example: '150000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] }) @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
}
export class CanvassSaleDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional({ description: 'Mobil (hanya Admin; Sales memakai mobilnya sendiri)' }) @IsOptional() @IsUUID() vanId?: string;
  @ApiProperty({ type: [CanvassLineDto] }) @ValidateNested({ each: true }) @Type(() => CanvassLineDto) @ArrayMinSize(1) @ArrayMaxSize(200) lines: CanvassLineDto[];
  @ApiPropertyOptional({ description: 'Uang yang diterima di tempat (menunggu verifikasi Keuangan)' }) @IsOptional() @ValidateNested() @Type(() => CollectDto) collect?: CollectDto;
}
export class CollectionDto extends CollectDto {
  @ApiProperty() @IsUUID() invoiceId: string;
}
export class VerifyDto {
  @ApiProperty({ example: '150000', description: 'Uang yang benar-benar diterima Keuangan' }) @IsNumberString() receivedAmount: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
export class RejectCollectionDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}
export class RouteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiProperty() @IsUUID() salespersonId: string;
  @ApiPropertyOptional({ description: '1 = Senin … 7 = Minggu' }) @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [String], description: 'Outlet sesuai urutan kunjungan' }) @IsArray() @ArrayMaxSize(300) @IsUUID(undefined, { each: true }) customerIds: string[];
}
export class VisitDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() routeId?: string;
  @ApiProperty({ enum: ['ORDER', 'NO_ORDER', 'CLOSED'] }) @IsIn(['ORDER', 'NO_ORDER', 'CLOSED']) result: 'ORDER' | 'NO_ORDER' | 'CLOSED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
  @ApiPropertyOptional({ example: -6.2 }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: 106.8 }) @IsOptional() @IsLongitude() lng?: number;
}
export class SummaryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}
export class CollectionQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'VERIFIED', 'REJECTED'] }) @IsOptional() @IsIn(['PENDING', 'VERIFIED', 'REJECTED']) status?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

@Injectable()
export class CanvassService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly ops: WarehouseOpsService,
    private readonly orders: SalesOrdersService,
    private readonly invoicesSvc: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- mobil ----------------
  async vans(tenantId: string) {
    const rows = await this.db.execute<{ id: string; code: string; name: string; user_id: string; user_name: string; is_active: boolean; qty: string; value: string; skus: string }>(sql`
      SELECT w.id, w.code, w.name, w.van_user_id AS user_id, u.name AS user_name, w.is_active,
             COALESCE(SUM(b.qty), 0)::text AS qty, COALESCE(SUM(b.qty * b.avg_cost), 0)::text AS value, COUNT(b.product_id) FILTER (WHERE b.qty > 0)::text AS skus
      FROM warehouses w LEFT JOIN users u ON u.id = w.van_user_id LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.qty > 0
      WHERE w.tenant_id = ${tenantId} AND w.kind = 'VAN' GROUP BY w.id, u.name ORDER BY w.code`);
    return rows.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, userId: r.user_id, userName: r.user_name, isActive: r.is_active, qty: r.qty, value: D(r.value).toFixed(2), skus: Number(r.skus) }));
  }

  async createVan(u: AuthUser, dto: VanDto) {
    const [sp] = await this.db.select().from(users).where(and(eq(users.id, dto.userId), eq(users.tenantId, u.tenantId), eq(users.role, 'SALES'), eq(users.isActive, true)));
    if (!sp) throw new BadRequestException('Mobil hanya untuk pengguna berperan Sales yang aktif');
    const [exist] = await this.db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.tenantId, u.tenantId), eq(warehouses.kind, 'VAN'), eq(warehouses.vanUserId, sp.id)));
    if (exist) throw new BadRequestException(`${sp.name} sudah punya mobil`);
    const n = await this.db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM warehouses WHERE tenant_id = ${u.tenantId} AND kind = 'VAN'`);
    const [row] = await this.db.insert(warehouses).values({ tenantId: u.tenantId, code: `VAN-${String(Number(n.rows[0].n) + 1).padStart(2, '0')}`, name: `Mobil ${sp.name}`, kind: 'VAN', vanUserId: sp.id }).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'Van', entityId: row.id, data: { code: row.code, sales: sp.name } });
    return row;
  }

  private async van(tenantId: string, id: string) {
    const [w] = await this.db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId), eq(warehouses.kind, 'VAN')));
    if (!w) throw new NotFoundException('Mobil tidak ditemukan');
    return w;
  }
  private async mainWh(tenantId: string, id: string) {
    const [w] = await this.db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
    if (!w || w.kind !== 'MAIN') throw new BadRequestException('Pilih gudang biasa');
    return w;
  }

  async moveVan(u: AuthUser, vanId: string, dto: VanMoveDto, dir: 'LOAD' | 'UNLOAD') {
    const van = await this.van(u.tenantId, vanId);
    const main = await this.mainWh(u.tenantId, dto.warehouseId);
    const merged = new Map<string, ReturnType<typeof D>>();
    for (const l of dto.lines) merged.set(l.productId, (merged.get(l.productId) ?? D(0)).plus(l.qty));
    const t = await this.ops.createTransfer(u, {
      fromWarehouseId: dir === 'LOAD' ? main.id : van.id,
      toWarehouseId: dir === 'LOAD' ? van.id : main.id,
      date: toDocDate(dto.date),
      mode: 'DIRECT',
      notes: `${dir === 'LOAD' ? 'Muat' : 'Bongkar'} ${van.name}${dto.notes ? ` — ${dto.notes}` : ''}`.slice(0, 255),
      lines: [...merged].map(([productId, q]) => ({ productId, qty: q.toFixed(4) })),
    } as never);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: dir, entity: 'Van', entityId: van.id, data: { lines: merged.size, transfer: (t as { number?: string }).number } });
    return t;
  }

  // ---------------- penjualan kanvas ----------------
  async sale(u: AuthUser, dto: CanvassSaleDto) {
    let van;
    if (u.role === 'SALES') {
      const [mine] = await this.db.select().from(warehouses).where(and(eq(warehouses.tenantId, u.tenantId), eq(warehouses.kind, 'VAN'), eq(warehouses.vanUserId, u.sub), eq(warehouses.isActive, true)));
      if (!mine) throw new BadRequestException('Anda belum punya mobil kanvas; minta Admin membuatnya');
      van = mine;
    } else {
      if (!dto.vanId) throw new BadRequestException('Pilih mobil');
      van = await this.van(u.tenantId, dto.vanId);
    }
    const [cust] = await this.db.select().from(customers).where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, u.tenantId)));
    if (!cust || !cust.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
    const date = toDocDate(undefined);
    // harga & potongan tidak bisa diisi sales: server memakai daftar harga outlet dan promo yang berlaku
    const so = await this.orders.create(u, { customerId: cust.id, warehouseId: van.id, date, notes: `Penjualan kanvas ${van.name}`, salespersonId: van.vanUserId ?? undefined, lines: dto.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: l.qty })) } as never);
    try {
      await this.orders.confirm(u, so.id);
    } catch (e) {
      await this.orders.cancel(u, so.id).catch(() => undefined);
      throw e;
    }
    const inv = await this.invoicesSvc.createFromOrder(u, { salesOrderId: so.id, date } as never);
    let collection: { id: string; number: string } | undefined;
    if (dto.collect) collection = await this.collect(u, { invoiceId: inv.id, amount: dto.collect.amount, method: dto.collect.method }, van.vanUserId ?? u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CANVASS_SALE', entity: 'Invoice', entityId: inv.id, data: { van: van.code, customer: cust.name, invoice: inv.number, total: inv.total } });
    return { salesOrderId: so.id, invoiceId: inv.id, invoiceNumber: inv.number, total: inv.total, collection };
  }

  // ---------------- setoran tagihan ----------------
  async collect(u: AuthUser, dto: CollectionDto, collectorId = u.sub) {
    const amount = D(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
    const date = toDocDate(undefined);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${u.tenantId} FOR UPDATE`);
      const inv = await tx.query.invoices.findFirst({ where: and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, u.tenantId)) });
      if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
      if (u.role === 'SALES') {
        // sales hanya menagih faktur dari pesanan yang ia pegang
        const mine = await tx.execute(sql`SELECT 1 FROM sales_orders WHERE id = ${inv.salesOrderId} AND salesperson_id = ${collectorId}`);
        if (!mine.rows.length) throw new ForbiddenException('Anda hanya dapat menagih faktur pesanan yang Anda pegang');
      }
      const pending = await tx.execute<{ s: string }>(sql`SELECT COALESCE(SUM(amount), 0)::text AS s FROM canvass_collections WHERE invoice_id = ${inv.id} AND status = 'PENDING'`);
      const room = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount).minus(pending.rows[0].s);
      if (amount.gt(room)) throw new BadRequestException(`Jumlah melebihi sisa tagihan yang belum disetor (${room.toFixed(2)})`);
      const number = await this.seq.next(tx, u.tenantId, 'CANVASS_REMITTANCE', date);
      const [row] = await tx.insert(canvassCollections).values({ tenantId: u.tenantId, number, userId: collectorId, invoiceId: inv.id, customerId: inv.customerId, date, method: dto.method ?? 'CASH', amount: amount.toFixed(2) }).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'CanvassCollection', entityId: row.id, data: { number, invoice: inv.number, amount: amount.toFixed(2) } });
      return row;
    });
  }

  async collections(u: AuthUser, status?: string) {
    const rows = await this.db
      .select({ c: canvassCollections, sales: users.name, cust: customers.name, inv: invoices.number })
      .from(canvassCollections)
      .innerJoin(users, eq(users.id, canvassCollections.userId))
      .innerJoin(customers, eq(customers.id, canvassCollections.customerId))
      .innerJoin(invoices, eq(invoices.id, canvassCollections.invoiceId))
      .where(and(eq(canvassCollections.tenantId, u.tenantId), status ? eq(canvassCollections.status, status as 'PENDING') : undefined, u.role === 'SALES' ? eq(canvassCollections.userId, u.sub) : undefined))
      .orderBy(desc(canvassCollections.date), desc(canvassCollections.number))
      .limit(300);
    const today = todayJakarta();
    return rows.map((r) => ({ ...r.c, salesName: r.sales, customerName: r.cust, invoiceNumber: r.inv, overdue: r.c.status === 'PENDING' && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.c.date}T00:00:00Z`) > STALE_DAYS * 86_400_000 }));
  }

  async verify(u: AuthUser, id: string, dto: VerifyDto) {
    const received = D(dto.receivedAmount);
    if (received.lt(0)) throw new BadRequestException('Jumlah diterima tidak valid');
    const [c] = await this.db.select().from(canvassCollections).where(and(eq(canvassCollections.id, id), eq(canvassCollections.tenantId, u.tenantId)));
    if (!c) throw new NotFoundException('Setoran tidak ditemukan');
    if (c.status !== 'PENDING') throw new BadRequestException('Setoran ini sudah diputuskan');
    if (c.userId === u.sub) throw new ForbiddenException('Setoran tidak dapat diverifikasi oleh sales yang menyetornya');
    if (received.gt(c.amount)) throw new BadRequestException('Uang yang diterima tidak boleh melebihi yang dicatat sales; catat kelebihan sebagai penerimaan terpisah');
    const claimed = await this.db.update(canvassCollections).set({ status: 'VERIFIED', verifiedById: u.sub, verifiedAt: new Date() }).where(and(eq(canvassCollections.id, id), eq(canvassCollections.status, 'PENDING'))).returning({ id: canvassCollections.id });
    if (!claimed.length) throw new BadRequestException('Setoran ini sedang/sudah diputuskan');
    try {
      let paymentId: string | null = null;
      if (received.gt(0)) {
        const pay = await this.payments.create(u, { invoiceId: c.invoiceId, amount: received.toFixed(2), method: c.method as 'CASH', cashAccountId: dto.cashAccountId, date: dto.date, notes: `Setoran kanvas ${c.number}` } as never);
        paymentId = (pay as { id: string }).id;
      }
      const shortage = D(c.amount).minus(received);
      await this.db.update(canvassCollections).set({ receivedAmount: received.toFixed(2), shortage: shortage.toFixed(2), paymentId }).where(eq(canvassCollections.id, id));
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'VERIFY', entity: 'CanvassCollection', entityId: id, data: { number: c.number, claimed: c.amount, received: received.toFixed(2), shortage: shortage.toFixed(2) } });
      return { id, status: 'VERIFIED', received: received.toFixed(2), shortage: shortage.toFixed(2) };
    } catch (e) {
      await this.db.update(canvassCollections).set({ status: 'PENDING', verifiedById: null, verifiedAt: null }).where(eq(canvassCollections.id, id));
      throw e;
    }
  }

  async rejectCollection(u: AuthUser, id: string, reason: string) {
    const [c] = await this.db.select().from(canvassCollections).where(and(eq(canvassCollections.id, id), eq(canvassCollections.tenantId, u.tenantId)));
    if (!c) throw new NotFoundException('Setoran tidak ditemukan');
    if (c.status !== 'PENDING') throw new BadRequestException('Setoran ini sudah diputuskan');
    await this.db.update(canvassCollections).set({ status: 'REJECTED', verifiedById: u.sub, verifiedAt: new Date(), rejectReason: reason, receivedAmount: '0', shortage: c.amount }).where(eq(canvassCollections.id, id));
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'CanvassCollection', entityId: id, data: { number: c.number, reason, amount: c.amount } });
    return { id, status: 'REJECTED' };
  }

  // ---------------- rute & kunjungan ----------------
  async routes(u: AuthUser) {
    const rows = await this.db.select({ r: salesRoutes, sales: users.name }).from(salesRoutes).innerJoin(users, eq(users.id, salesRoutes.salespersonId)).where(and(eq(salesRoutes.tenantId, u.tenantId), u.role === 'SALES' ? eq(salesRoutes.salespersonId, u.sub) : undefined)).orderBy(salesRoutes.name);
    const stops = rows.length ? await this.db.select({ s: salesRouteStops, code: customers.code, name: customers.name }).from(salesRouteStops).innerJoin(customers, eq(customers.id, salesRouteStops.customerId)).where(inArray(salesRouteStops.routeId, rows.map((r) => r.r.id))).orderBy(salesRouteStops.seq) : [];
    return rows.map((r) => ({ ...r.r, salesName: r.sales, stops: stops.filter((s) => s.s.routeId === r.r.id).map((s) => ({ customerId: s.s.customerId, seq: s.s.seq, code: s.code, name: s.name })) }));
  }

  private async checkRoute(u: AuthUser, dto: RouteDto) {
    const [sp] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, dto.salespersonId), eq(users.tenantId, u.tenantId), eq(users.role, 'SALES')));
    if (!sp) throw new BadRequestException('Rute hanya untuk pengguna berperan Sales');
    const ids = [...new Set(dto.customerIds)];
    if (ids.length !== dto.customerIds.length) throw new BadRequestException('Satu outlet tidak boleh dua kali dalam satu rute');
    if (ids.length) {
      const found = await this.db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, u.tenantId), inArray(customers.id, ids)));
      if (found.length !== ids.length) throw new BadRequestException('Ada outlet yang tidak ditemukan');
    }
  }

  async saveRoute(u: AuthUser, dto: RouteDto, id?: string) {
    await this.checkRoute(u, dto);
    return this.db.transaction(async (tx) => {
      let routeId = id;
      if (id) {
        const [cur] = await tx.select().from(salesRoutes).where(and(eq(salesRoutes.id, id), eq(salesRoutes.tenantId, u.tenantId)));
        if (!cur) throw new NotFoundException('Rute tidak ditemukan');
        await tx.update(salesRoutes).set({ name: dto.name.trim(), salespersonId: dto.salespersonId, weekday: dto.weekday ?? null, isActive: dto.isActive ?? true }).where(eq(salesRoutes.id, id));
        await tx.delete(salesRouteStops).where(eq(salesRouteStops.routeId, id));
      } else {
        try {
          const [row] = await tx.insert(salesRoutes).values({ tenantId: u.tenantId, name: dto.name.trim(), salespersonId: dto.salespersonId, weekday: dto.weekday ?? null }).returning();
          routeId = row.id;
        } catch (e) {
          if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') throw new BadRequestException(`Rute "${dto.name}" sudah ada`);
          throw e;
        }
      }
      if (dto.customerIds.length) await tx.insert(salesRouteStops).values(dto.customerIds.map((customerId, i) => ({ tenantId: u.tenantId, routeId: routeId!, customerId, seq: i + 1 })));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'SalesRoute', entityId: routeId!, data: { name: dto.name, stops: dto.customerIds.length } });
      return { id: routeId };
    });
  }

  async visit(u: AuthUser, dto: VisitDto) {
    const [cust] = await this.db.select().from(customers).where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, u.tenantId)));
    if (!cust) throw new BadRequestException('Outlet tidak ditemukan');
    const date = todayJakarta();
    let distance: number | null = null;
    if (dto.lat != null && dto.lng != null && cust.geoLat && cust.geoLng) distance = haversineM(dto.lat, dto.lng, Number(cust.geoLat), Number(cust.geoLng));
    try {
      const [row] = await this.db
        .insert(salesVisits)
        .values({ tenantId: u.tenantId, userId: u.sub, customerId: cust.id, routeId: dto.routeId ?? null, date, lat: dto.lat?.toFixed(6), lng: dto.lng?.toFixed(6), distanceM: distance, result: dto.result, note: dto.note })
        .returning();
      return { ...row, farFromOutlet: distance !== null && distance > FAR_METERS };
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') throw new BadRequestException('Kunjungan ke outlet ini hari ini sudah dicatat');
      throw e;
    }
  }

  async summary(u: AuthUser, dateStr?: string) {
    const date = dateStr ? toDocDate(dateStr) : todayJakarta();
    const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const only = u.role === 'SALES' ? u.sub : null;
    const sales = await this.db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.tenantId, u.tenantId), eq(users.role, 'SALES'), eq(users.isActive, true), only ? eq(users.id, only) : undefined));
    const q = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => (await this.db.execute<T>(query)).rows;
    const planned = await q<{ uid: string; n: string }>(sql`SELECT r.salesperson_id AS uid, COUNT(s.id)::text AS n FROM sales_routes r JOIN sales_route_stops s ON s.route_id = r.id WHERE r.tenant_id = ${u.tenantId} AND r.is_active AND r.weekday = ${weekday} GROUP BY r.salesperson_id`);
    const visits = await q<{ uid: string; n: string; eff: string; far: string }>(sql`SELECT user_id AS uid, COUNT(*)::text AS n, COUNT(*) FILTER (WHERE result = 'ORDER')::text AS eff, COUNT(*) FILTER (WHERE distance_m > ${FAR_METERS})::text AS far FROM sales_visits WHERE tenant_id = ${u.tenantId} AND date = ${date} GROUP BY user_id`);
    const sold = await q<{ uid: string; n: string; v: string }>(sql`SELECT o.salesperson_id AS uid, COUNT(*)::text AS n, COALESCE(SUM(i.total), 0)::text AS v FROM invoices i JOIN sales_orders o ON o.id = i.sales_order_id JOIN warehouses w ON w.id = o.warehouse_id WHERE i.tenant_id = ${u.tenantId} AND i.date = ${date} AND w.kind = 'VAN' GROUP BY o.salesperson_id`);
    const col = await q<{ uid: string; pending: string; verified: string; shortage: string; stale: string }>(sql`SELECT user_id AS uid,
        COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0)::text AS pending, COALESCE(SUM(received_amount) FILTER (WHERE status = 'VERIFIED'), 0)::text AS verified,
        COALESCE(SUM(shortage) FILTER (WHERE status IN ('VERIFIED', 'REJECTED')), 0)::text AS shortage,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND date < (${date}::date - ${STALE_DAYS}::int))::text AS stale
      FROM canvass_collections WHERE tenant_id = ${u.tenantId} GROUP BY user_id`);
    const van = await q<{ uid: string; qty: string; value: string }>(sql`SELECT w.van_user_id AS uid, COALESCE(SUM(b.qty), 0)::text AS qty, COALESCE(SUM(b.qty * b.avg_cost), 0)::text AS value FROM warehouses w LEFT JOIN stock_balances b ON b.warehouse_id = w.id WHERE w.tenant_id = ${u.tenantId} AND w.kind = 'VAN' GROUP BY w.van_user_id`);
    const pick = <T extends { uid: string }>(rows: T[], id: string) => rows.find((r) => r.uid === id);
    return {
      date,
      rows: sales.map((s) => ({
        userId: s.id,
        name: s.name,
        plannedStops: Number(pick(planned, s.id)?.n ?? 0),
        visits: Number(pick(visits, s.id)?.n ?? 0),
        effectiveCalls: Number(pick(visits, s.id)?.eff ?? 0),
        farVisits: Number(pick(visits, s.id)?.far ?? 0),
        invoices: Number(pick(sold, s.id)?.n ?? 0),
        vanSales: D(pick(sold, s.id)?.v).toFixed(2),
        collectionsPending: D(pick(col, s.id)?.pending).toFixed(2),
        collectionsVerified: D(pick(col, s.id)?.verified).toFixed(2),
        shortage: D(pick(col, s.id)?.shortage).toFixed(2),
        staleCollections: Number(pick(col, s.id)?.stale ?? 0),
        vanQty: D(pick(van, s.id)?.qty).toFixed(4),
        vanValue: D(pick(van, s.id)?.value).toFixed(2),
      })),
    };
  }

  async visits(u: AuthUser, dateStr?: string) {
    const date = dateStr ? toDocDate(dateStr) : todayJakarta();
    const rows = await this.db
      .select({ v: salesVisits, sales: users.name, code: customers.code, name: customers.name })
      .from(salesVisits)
      .innerJoin(users, eq(users.id, salesVisits.userId))
      .innerJoin(customers, eq(customers.id, salesVisits.customerId))
      .where(and(eq(salesVisits.tenantId, u.tenantId), eq(salesVisits.date, date), u.role === 'SALES' ? eq(salesVisits.userId, u.sub) : undefined))
      .orderBy(desc(salesVisits.checkedInAt));
    return rows.map((r) => ({ ...r.v, salesName: r.sales, customerCode: r.code, customerName: r.name, farFromOutlet: r.v.distanceM !== null && r.v.distanceM > FAR_METERS }));
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('canvass')
export class CanvassController {
  constructor(private readonly svc: CanvassService) {}

  @Get('vans')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'SALES')
  vans(@CurrentUser() u: AuthUser) {
    return this.svc.vans(u.tenantId);
  }
  @Post('vans')
  @Roles('ADMIN')
  createVan(@CurrentUser() u: AuthUser, @Body() dto: VanDto) {
    return this.svc.createVan(u, dto);
  }
  @Post('vans/:id/load')
  @Roles('ADMIN', 'WAREHOUSE')
  load(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VanMoveDto) {
    return this.svc.moveVan(u, id, dto, 'LOAD');
  }
  @Post('vans/:id/unload')
  @Roles('ADMIN', 'WAREHOUSE')
  unload(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VanMoveDto) {
    return this.svc.moveVan(u, id, dto, 'UNLOAD');
  }

  @Post('sales')
  @Roles('ADMIN', 'SALES')
  sale(@CurrentUser() u: AuthUser, @Body() dto: CanvassSaleDto) {
    return this.svc.sale(u, dto);
  }

  @Get('collections')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  collections(@CurrentUser() u: AuthUser, @Query() q: CollectionQueryDto) {
    return this.svc.collections(u, q.status);
  }
  @Post('collections')
  @Roles('ADMIN', 'SALES')
  collect(@CurrentUser() u: AuthUser, @Body() dto: CollectionDto) {
    return this.svc.collect(u, dto);
  }
  @Post('collections/:id/verify')
  @Roles('ADMIN', 'FINANCE')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    return this.svc.verify(u, id, dto);
  }
  @Post('collections/:id/reject')
  @Roles('ADMIN', 'FINANCE')
  rejectCollection(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCollectionDto) {
    return this.svc.rejectCollection(u, id, dto.reason);
  }

  @Get('routes')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  routes(@CurrentUser() u: AuthUser) {
    return this.svc.routes(u);
  }
  @Post('routes')
  @Roles('ADMIN')
  createRoute(@CurrentUser() u: AuthUser, @Body() dto: RouteDto) {
    return this.svc.saveRoute(u, dto);
  }
  @Put('routes/:id')
  @Roles('ADMIN')
  updateRoute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.svc.saveRoute(u, dto, id);
  }

  @Get('visits')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  visits(@CurrentUser() u: AuthUser, @Query() q: SummaryQueryDto) {
    return this.svc.visits(u, q.date);
  }
  @Post('visits')
  @Roles('SALES')
  visit(@CurrentUser() u: AuthUser, @Body() dto: VisitDto) {
    return this.svc.visit(u, dto);
  }
  @Get('summary')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  summary(@CurrentUser() u: AuthUser, @Query() q: SummaryQueryDto) {
    return this.svc.summary(u, q.date);
  }
}
