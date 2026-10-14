/**
 * Kedaluwarsa bahan: daftar lot yang masih ada stoknya berikut sisa hari, dan pembuangan lot (dicatat sebagai penyesuaian
 * stok "rusak/kedaluwarsa" sehingga jurnal, kartu stok, dan persetujuan berlaku seperti biasa).
 */
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { InventoryService } from './inventory.service';

export const LOT_STATUSES = ['ALL', 'EXPIRED', 'SOON', 'WARNING'] as const;
/** Batas hari: "segera" ≤ 7 hari, "perlu diperhatikan" ≤ 30 hari */
const SOON_DAYS = 7;
const WARNING_DAYS = 30;

export class LotQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: LOT_STATUSES, description: 'EXPIRED = sudah lewat, SOON = ≤ 7 hari, WARNING = ≤ 30 hari' }) @IsOptional() @IsIn(LOT_STATUSES) status?: (typeof LOT_STATUSES)[number];
}

export class DiscardLotDto {
  @ApiPropertyOptional({ example: 'Dibuang saat pengecekan pagi' }) @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export type LotStatus = 'EXPIRED' | 'SOON' | 'WARNING' | 'OK' | 'NO_EXPIRY';

type Row = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  base_uom: string;
  warehouse_id: string;
  warehouse_code: string;
  lot_no: string | null;
  expiry_date: string | null;
  received_date: string;
  qty_remaining: string;
  avg_cost: string | null;
};

@Injectable()
export class LotsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly inventory: InventoryService,
  ) {}

  private statusOf(expiry: string | null, today: string): { status: LotStatus; daysLeft: number | null } {
    if (!expiry) return { status: 'NO_EXPIRY', daysLeft: null };
    const daysLeft = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    // lewat tanggal = kedaluwarsa; hari ini masih boleh dipakai tetapi "segera"
    const status: LotStatus = daysLeft < 0 ? 'EXPIRED' : daysLeft <= SOON_DAYS ? 'SOON' : daysLeft <= WARNING_DAYS ? 'WARNING' : 'OK';
    return { status, daysLeft };
  }

  async list(u: AuthUser, q: LotQueryDto) {
    if (q.warehouseId) assertWarehouseAccess(u, q.warehouseId);
    const allowed = allowedWarehouses(u);
    const today = todayJakarta();
    const rows = await this.db.execute<Row>(sql`
      SELECT l.id, l.product_id, p.sku, p.name, p.base_uom, l.warehouse_id, w.code AS warehouse_code, l.lot_no, l.expiry_date,
             l.received_date, l.qty_remaining, b.avg_cost
      FROM stock_lots l
      JOIN products p ON p.id = l.product_id
      JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = l.warehouse_id
      WHERE l.tenant_id = ${u.tenantId} AND l.qty_remaining > 0
        ${q.warehouseId ? sql`AND l.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND l.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY l.expiry_date NULLS LAST, p.sku, l.id
      LIMIT 1000`);
    const items = rows.rows.map((r) => {
      const { status, daysLeft } = this.statusOf(r.expiry_date, today);
      return {
        id: r.id,
        productId: r.product_id,
        sku: r.sku,
        productName: r.name,
        baseUom: r.base_uom,
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        lotNo: r.lot_no,
        expiryDate: r.expiry_date,
        receivedDate: r.received_date,
        qtyRemaining: r.qty_remaining,
        daysLeft,
        status,
        value: D(r.qty_remaining).times(r.avg_cost ?? 0).toFixed(2),
      };
    });
    const sum = (s: LotStatus) => items.filter((i) => i.status === s);
    const val = (xs: typeof items) => xs.reduce((a, i) => a.plus(i.value), D(0)).toFixed(2);
    const filtered = !q.status || q.status === 'ALL' ? items : items.filter((i) => i.status === q.status);
    return {
      today,
      soonDays: SOON_DAYS,
      warningDays: WARNING_DAYS,
      summary: {
        expired: sum('EXPIRED').length,
        expiredValue: val(sum('EXPIRED')),
        soon: sum('SOON').length,
        soonValue: val(sum('SOON')),
        warning: sum('WARNING').length,
        tracked: items.length,
      },
      items: filtered,
    };
  }

  /** Buang sisa satu lot: penyesuaian stok "rusak/kedaluwarsa" yang hanya mengurangi lot ini */
  async discard(u: AuthUser, id: string, dto: DiscardLotDto) {
    const r = await this.db.execute<{ product_id: string; warehouse_id: string; qty_remaining: string; lot_no: string | null; expiry_date: string | null }>(sql`
      SELECT product_id, warehouse_id, qty_remaining, lot_no, expiry_date FROM stock_lots WHERE id = ${id} AND tenant_id = ${u.tenantId}`);
    const lot = r.rows[0];
    if (!lot) throw new NotFoundException('Lot tidak ditemukan');
    if (D(lot.qty_remaining).lte(0)) throw new BadRequestException('Lot ini sudah habis');
    assertWarehouseAccess(u, lot.warehouse_id);
    const label = lot.lot_no ? `lot ${lot.lot_no}` : `lot kedaluwarsa ${lot.expiry_date ?? '-'}`;
    return this.inventory.adjust(u, {
      warehouseId: lot.warehouse_id,
      reason: 'DAMAGED',
      notes: `Bahan terbuang (${label})${dto.notes ? ` - ${dto.notes}` : ''}`.slice(0, 255),
      lines: [{ productId: lot.product_id, qty: D(lot.qty_remaining).negated().toFixed(4), lotId: id }],
    });
  }
}

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory/lots')
export class LotsController {
  constructor(private readonly svc: LotsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: LotQueryDto) {
    return this.svc.list(u, q);
  }

  @Post(':id/discard')
  @Roles('ADMIN', 'WAREHOUSE')
  discard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscardLotDto) {
    return this.svc.discard(u, id, dto);
  }
}
