/**
 * Kedaluwarsa bahan: daftar lot yang masih ada stoknya berikut sisa hari, dan pembuangan lot (dicatat sebagai penyesuaian
 * stok "rusak/kedaluwarsa" sehingga jurnal, kartu stok, dan persetujuan berlaku seperti biasa).
 */
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AuditService } from '../../common/audit/audit.service';
import { InventoryService } from './inventory.service';

export const LOT_STATUSES = ['ALL', 'EXPIRED', 'SOON', 'WARNING'] as const;
/** Batas hari: "segera" ≤ 7 hari, "perlu diperhatikan" ≤ 30 hari */
const SOON_DAYS = 7;
const WARNING_DAYS = 30;

export class LotQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: LOT_STATUSES, description: 'EXPIRED = sudah lewat, SOON = ≤ 7 hari, WARNING = ≤ 30 hari' }) @IsOptional() @IsIn(LOT_STATUSES) status?: (typeof LOT_STATUSES)[number];
}

export class TraceQueryDto {
  @ApiPropertyOptional() @IsUUID() productId: string;
  @ApiPropertyOptional({ example: 'MIE-2409A' }) @IsString() @MinLength(1) @MaxLength(40) lotNo: string;
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
    private readonly audit: AuditService,
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

  /**
   * Penelusuran penarikan produk (recall): dari satu nomor lot barang ke asal penerimaan dan semua tujuan keluarnya
   * (pelanggan per dokumen, kasir tanpa pelanggan, transfer, penyesuaian/pembuangan, produksi). Hanya pengeluaran
   * sejak jejak lot dicatat yang terlacak; selisihnya ditampilkan sebagai "tidak terlacak" agar tidak menyesatkan.
   */
  async trace(u: AuthUser, q: TraceQueryDto) {
    const lots = await this.db.execute<{ id: string; warehouse_code: string; received_date: string; expiry_date: string | null; qty_received: string; qty_remaining: string; source_type: string; source_ref: string; grn_number: string | null; supplier: string | null; sku: string; name: string; base_uom: string }>(sql`
      SELECT l.id, w.code AS warehouse_code, l.received_date, l.expiry_date, l.qty_received, l.qty_remaining, l.source_type, l.source_ref,
             g.number AS grn_number, s.name AS supplier, p.sku, p.name, p.base_uom
      FROM stock_lots l
      JOIN warehouses w ON w.id = l.warehouse_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN goods_receipts g ON l.source_type = 'GOODS_RECEIPT' AND g.id::text = l.source_ref
      LEFT JOIN suppliers s ON s.id = g.supplier_id
      WHERE l.tenant_id = ${u.tenantId} AND l.product_id = ${q.productId} AND l.lot_no = ${q.lotNo}
      ORDER BY l.received_date, l.id`);
    if (!lots.rows.length) throw new NotFoundException('Lot tidak ditemukan');
    const issues = await this.db.execute<{ qty: string; move_type: string; ref_type: string; ref_id: string; date: string; doc_number: string | null; cancelled: boolean; is_estimate: boolean; customer_id: string | null; customer_code: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null }>(sql`
      SELECT i.qty, i.move_type, i.ref_type, i.ref_id, i.date, i.is_estimate,
             COALESCE(d.number, v.number, po.number) AS doc_number,
             COALESCE(d.status = 'CANCELLED', false) AS cancelled,
             c.id AS customer_id, c.code AS customer_code, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM stock_lot_issues i
      JOIN stock_lots l ON l.id = i.lot_id
      LEFT JOIN delivery_orders d ON i.ref_type = 'DELIVERY' AND d.id::text = i.ref_id
      LEFT JOIN invoices v ON i.ref_type = 'INVOICE' AND v.id::text = i.ref_id
      LEFT JOIN pos_orders po ON i.ref_type = 'POS_ORDER' AND po.id::text = i.ref_id
      LEFT JOIN customers c ON c.id = COALESCE(d.customer_id, v.customer_id, po.customer_id)
      WHERE l.tenant_id = ${u.tenantId} AND l.product_id = ${q.productId} AND l.lot_no = ${q.lotNo}
      ORDER BY i.date, i.created_at`);

    type Doc = { type: string; number: string | null; date: string; qty: string; cancelled: boolean; estimate: boolean };
    const customers = new Map<string, { customerId: string; code: string; name: string; phone: string | null; address: string | null; qty: ReturnType<typeof D>; docs: Doc[] }>();
    const walkIn = { qty: D(0), docs: [] as Doc[] };
    const other = new Map<string, { type: string; label: string; qty: ReturnType<typeof D>; docs: Doc[] }>();
    const LABEL: Record<string, string> = { TRANSFER_OUT: 'Pindah ke gudang lain', ADJUSTMENT_OUT: 'Penyesuaian / dibuang', PRODUCTION_ISSUE: 'Dipakai produksi', PURCHASE_RETURN: 'Retur ke pemasok', SALE: 'Penjualan' };
    let traced = D(0);
    let estimated = D(0);
    let tracedAll = D(0); // termasuk dokumen yang dibatalkan (stok kembali tetapi lot tidak dipulihkan)
    for (const r of issues.rows) {
      const doc: Doc = { type: r.ref_type, number: r.doc_number, date: r.date, qty: r.qty, cancelled: r.cancelled, estimate: r.is_estimate };
      if (r.is_estimate && !r.cancelled) estimated = estimated.plus(r.qty);
      tracedAll = tracedAll.plus(r.qty);
      if (!r.cancelled) traced = traced.plus(r.qty);
      if (r.customer_id) {
        const c = customers.get(r.customer_id) ?? { customerId: r.customer_id, code: r.customer_code!, name: r.customer_name!, phone: r.customer_phone, address: r.customer_address, qty: D(0), docs: [] };
        if (!r.cancelled) c.qty = c.qty.plus(r.qty);
        c.docs.push(doc);
        customers.set(r.customer_id, c);
      } else if (r.ref_type === 'POS_ORDER' || r.ref_type === 'DELIVERY' || r.ref_type === 'INVOICE') {
        // kasir tanpa pelanggan terdaftar (pembeli umum)
        if (!r.cancelled) walkIn.qty = walkIn.qty.plus(r.qty);
        walkIn.docs.push(doc);
      } else {
        const o = other.get(r.move_type) ?? { type: r.move_type, label: LABEL[r.move_type] ?? r.move_type, qty: D(0), docs: [] };
        o.qty = o.qty.plus(r.qty);
        o.docs.push(doc);
        other.set(r.move_type, o);
      }
    }
    const received = lots.rows.reduce((a, l) => a.plus(l.qty_received), D(0));
    const remaining = lots.rows.reduce((a, l) => a.plus(l.qty_remaining), D(0));
    const f = (x: ReturnType<typeof D>) => x.toFixed(4);
    return {
      product: { id: q.productId, sku: lots.rows[0].sku, name: lots.rows[0].name, baseUom: lots.rows[0].base_uom },
      lotNo: q.lotNo,
      lots: lots.rows.map((l) => ({ id: l.id, warehouse: l.warehouse_code, receivedDate: l.received_date, expiryDate: l.expiry_date, qtyReceived: l.qty_received, qtyRemaining: l.qty_remaining, source: l.grn_number ? { type: 'Penerimaan barang', number: l.grn_number, supplier: l.supplier } : { type: l.source_type, number: null, supplier: null } })),
      summary: { received: f(received), remaining: f(remaining), toCustomers: f([...customers.values()].reduce((a, c) => a.plus(c.qty), D(0))), walkIn: f(walkIn.qty), other: f([...other.values()].reduce((a, o) => a.plus(o.qty), D(0))), untraced: f(received.minus(remaining).minus(tracedAll)), estimated: f(estimated) },
      customers: [...customers.values()].sort((a, b) => b.qty.cmp(a.qty)).map((c) => ({ ...c, qty: f(c.qty) })),
      walkIn: { qty: f(walkIn.qty), docs: walkIn.docs },
      other: [...other.values()].map((o) => ({ ...o, qty: f(o.qty) })),
    };
  }

  /**
   * Rekonstruksi jejak lot untuk pengeluaran lama (sebelum jejak per lot dicatat): setiap mutasi keluar yang belum terkait lot
   * dialokasikan ke lot yang paling cepat kedaluwarsa dan sudah diterima pada tanggal itu (FEFO), hanya sebesar sisa yang memang
   * belum terjelaskan pada lot. Hasilnya ditandai "perkiraan" (is_estimate) dan tidak pernah menimpa jejak asli; aman dijalankan ulang.
   */
  async rebuildTrace(u: AuthUser) {
    const lots = await this.db.execute<{ id: string; product_id: string; warehouse_id: string; received_date: string; expiry_date: string | null; untraced: string }>(sql`
      SELECT l.id, l.product_id, l.warehouse_id, l.received_date, l.expiry_date,
             (l.qty_received - l.qty_remaining - COALESCE((SELECT SUM(i.qty) FROM stock_lot_issues i WHERE i.lot_id = l.id), 0))::text AS untraced
      FROM stock_lots l WHERE l.tenant_id = ${u.tenantId} AND l.lot_no IS NOT NULL
      ORDER BY l.expiry_date NULLS LAST, l.received_date, l.id`);
    const open = lots.rows.map((l) => ({ ...l, left: D(l.untraced) })).filter((l) => l.left.gt(0));
    if (!open.length) return { allocated: 0, quantity: '0.0000', pairs: 0 };
    const pairs = [...new Set(open.map((l) => `${l.product_id}|${l.warehouse_id}`))];
    let rows = 0;
    let qty = D(0);
    await this.db.transaction(async (tx) => {
      for (const pair of pairs) {
        const [pid, wid] = pair.split('|');
        const mine = open.filter((l) => l.product_id === pid && l.warehouse_id === wid);
        const moves = await tx.execute<{ type: string; qty: string; ref_type: string; ref_id: string; date: string; done: string }>(sql`
          SELECT m.type, m.qty, m.ref_type, m.ref_id, m.date,
                 COALESCE((SELECT SUM(i.qty) FROM stock_lot_issues i WHERE i.tenant_id = m.tenant_id AND i.product_id = m.product_id AND i.warehouse_id = m.warehouse_id AND i.ref_type = m.ref_type AND i.ref_id = m.ref_id), 0)::text AS done
          FROM stock_moves m
          WHERE m.tenant_id = ${u.tenantId} AND m.product_id = ${pid} AND m.warehouse_id = ${wid} AND m.qty < 0
            AND m.type IN ('SALE', 'ADJUSTMENT_OUT', 'PRODUCTION_ISSUE', 'PURCHASE_RETURN')
          ORDER BY m.date, m.id`);
        for (const m of moves.rows) {
          let need = D(m.qty).abs().minus(m.done);
          for (const l of mine) {
            if (need.lte(0)) break;
            if (l.left.lte(0) || l.received_date > m.date) continue;
            const take = l.left.lt(need) ? l.left : need;
            await tx.execute(sql`
              INSERT INTO stock_lot_issues (tenant_id, lot_id, product_id, warehouse_id, qty, move_type, ref_type, ref_id, date, is_estimate)
              VALUES (${u.tenantId}, ${l.id}, ${pid}, ${wid}, ${take.toFixed(4)}, ${m.type}, ${m.ref_type}, ${m.ref_id}, ${m.date}, true)`);
            l.left = l.left.minus(take);
            need = need.minus(take);
            rows++;
            qty = qty.plus(take);
          }
        }
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REBUILD', entity: 'LotTrace', entityId: u.tenantId, data: { rows, quantity: qty.toFixed(4), pairs: pairs.length } });
    });
    return { allocated: rows, quantity: qty.toFixed(4), pairs: pairs.length };
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

  @Get('trace')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES', 'ACCOUNTANT')
  trace(@CurrentUser() u: AuthUser, @Query() q: TraceQueryDto) {
    return this.svc.trace(u, q);
  }

  @Post('rebuild-trace')
  @Roles('ADMIN')
  rebuild(@CurrentUser() u: AuthUser) {
    return this.svc.rebuildTrace(u);
  }

  @Post(':id/discard')
  @Roles('ADMIN', 'WAREHOUSE')
  discard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscardLotDto) {
    return this.svc.discard(u, id, dto);
  }
}
