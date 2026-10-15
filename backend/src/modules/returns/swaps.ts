/**
 * Retur tukar-guling: barang rusak/kedaluwarsa/ditarik dari outlet ditukar barang yang SAMA dengan jumlah yang sama, tanpa
 * mengubah piutang. Barang lama dimusnahkan/dikarantina (tidak masuk stok layak jual); barang pengganti keluar dari gudang dan
 * biayanya menjadi Beban Barang Kedaluwarsa & Retur Rusak (Dr 6-2160 | Cr Persediaan).
 * Pencegahan kecurangan: wajib mengacu pada faktur outlet itu sendiri (≤ 180 hari); jumlah tukar kumulatif per baris faktur tidak
 * boleh melebihi yang pernah dijual (dikurangi retur & tukar sebelumnya, termasuk yang menunggu persetujuan); pengganti selalu
 * produk & jumlah yang sama (tidak bisa ditukar ke barang lain/lebih banyak); stok hanya bergerak setelah DISETUJUI oleh orang
 * lain dari pembuatnya (Pemilik dikecualikan); semua tercatat di jejak audit dan jejak lot.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate } from '../../common/utils/dates';
import { D, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { customers, goodsSwapLines, goodsSwaps, invoiceLines, invoices, salesOrders } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { inventoryLines, semiSet } from '../inventory/inventory-accounts';
import { StockService } from '../inventory/stock.service';

const REASONS = ['EXPIRED', 'DAMAGED', 'RECALL'] as const;
const MAX_AGE_DAYS = 180;

export class SwapLineDto {
  @ApiProperty() @IsUUID() invoiceLineId: string;
  @ApiProperty({ example: '2', description: 'Jumlah (satuan baris faktur) yang ditarik dan diganti' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ example: 'MIE-2409A' }) @IsOptional() @IsString() @MaxLength(40) lotNo?: string;
}
export class CreateSwapDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty({ enum: REASONS }) @IsIn(REASONS) reason: (typeof REASONS)[number];
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiProperty({ type: [SwapLineDto] }) @ValidateNested({ each: true }) @Type(() => SwapLineDto) @ArrayMinSize(1) @ArrayMaxSize(200) lines: SwapLineDto[];
}
export class RejectSwapDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) reason: string;
}
export class SwapQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

@Injectable()
export class SwapsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, status?: string) {
    const rows = await this.db.query.goodsSwaps.findMany({
      where: and(eq(goodsSwaps.tenantId, tenantId), status ? eq(goodsSwaps.status, status as 'PENDING') : undefined),
      orderBy: [desc(goodsSwaps.date), desc(goodsSwaps.number)],
      limit: 300,
    });
    const cust = rows.length ? await this.db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))])) : [];
    const inv = rows.length ? await this.db.select({ id: invoices.id, number: invoices.number }).from(invoices).where(inArray(invoices.id, [...new Set(rows.map((r) => r.invoiceId))])) : [];
    const lines = rows.length ? await this.db.select().from(goodsSwapLines).where(inArray(goodsSwapLines.swapId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, customer: cust.find((c) => c.id === r.customerId), invoiceNumber: inv.find((i) => i.id === r.invoiceId)?.number, lines: lines.filter((l) => l.swapId === r.id) }));
  }

  async create(u: AuthUser, dto: CreateSwapDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${u.tenantId} FOR UPDATE`);
      const inv = await tx.query.invoices.findFirst({ where: and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, u.tenantId)), with: { lines: true } });
      if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
      if (inv.kind === 'SERVICE') throw new BadRequestException('Faktur jasa tidak dapat ditukar-guling');
      if (date < inv.date) throw new BadRequestException('Tanggal tukar tidak boleh sebelum tanggal faktur');
      if (date > addDays(inv.date, MAX_AGE_DAYS)) throw new BadRequestException(`Tukar-guling hanya untuk faktur yang berumur paling lama ${MAX_AGE_DAYS} hari`);
      const [order] = inv.salesOrderId ? await tx.select({ warehouseId: salesOrders.warehouseId }).from(salesOrders).where(eq(salesOrders.id, inv.salesOrderId)) : [];
      if (!order) throw new BadRequestException('Gudang asal faktur tidak diketahui');
      const seen = new Set<string>();
      for (const l of dto.lines) {
        if (seen.has(l.invoiceLineId)) throw new BadRequestException('Satu baris faktur hanya boleh sekali per dokumen tukar');
        seen.add(l.invoiceLineId);
        const src = inv.lines.find((x) => x.id === l.invoiceLineId);
        if (!src) throw new BadRequestException('Baris faktur tidak ditemukan pada faktur ini');
        const q = D(l.qty);
        if (q.lte(0)) throw new BadRequestException('Jumlah tukar harus lebih dari nol');
        const used = await tx.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${src.id} AND s.status IN ('PENDING', 'APPROVED')`);
        const room = D(src.qty).minus(src.returnedQty).minus(used.rows[0].q);
        if (q.gt(room)) throw new BadRequestException(`Jumlah tukar melebihi yang tersisa pada baris faktur (${room.toFixed(4).replace(/\.?0+$/, '')}) setelah retur dan tukar sebelumnya`);
      }
      const number = await this.seq.next(tx, u.tenantId, 'GOODS_SWAP', date);
      const [swap] = await tx
        .insert(goodsSwaps)
        .values({ tenantId: u.tenantId, number, date, customerId: inv.customerId, invoiceId: inv.id, warehouseId: order.warehouseId, reason: dto.reason, notes: dto.notes, createdById: u.sub })
        .returning();
      await tx.insert(goodsSwapLines).values(
        dto.lines.map((l) => {
          const src = inv.lines.find((x) => x.id === l.invoiceLineId)!;
          return { swapId: swap.id, invoiceLineId: src.id, productId: src.productId, uom: src.uom, uomFactor: src.uomFactor, qty: D(l.qty).toFixed(4), lotNo: l.lotNo?.trim() || null };
        }),
      );
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'GoodsSwap', entityId: swap.id, data: { number, invoice: inv.number, reason: dto.reason, lines: dto.lines.length } });
      return swap;
    });
  }

  async approve(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const [swap] = await tx.select().from(goodsSwaps).where(and(eq(goodsSwaps.id, id), eq(goodsSwaps.tenantId, u.tenantId))).for('update');
      if (!swap) throw new NotFoundException('Dokumen tukar-guling tidak ditemukan');
      if (swap.status !== 'PENDING') throw new BadRequestException('Dokumen ini sudah diputuskan');
      if (swap.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Tukar-guling disetujui oleh orang lain dari pembuatnya (pemisahan fungsi)');
      const lines = await tx.select().from(goodsSwapLines).where(eq(goodsSwapLines.swapId, id));
      // periksa ulang batas jumlah saat disetujui (retur lain mungkin masuk sejak dibuat)
      for (const l of lines) {
        const [src] = await tx.select().from(invoiceLines).where(eq(invoiceLines.id, l.invoiceLineId));
        const used = await tx.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${l.invoiceLineId} AND s.status = 'APPROVED'`);
        if (D(l.qty).gt(D(src.qty).minus(src.returnedQty).minus(used.rows[0].q))) throw new BadRequestException('Jumlah tukar sudah melebihi sisa baris faktur (ada retur/tukar lain); tolak dan buat ulang');
      }
      const items: { productId: string; value: ReturnType<typeof D> }[] = [];
      let cost = ZERO;
      for (const l of lines) {
        const out = await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId: l.productId,
          warehouseId: swap.warehouseId,
          type: 'ADJUSTMENT_OUT',
          qty: D(l.qty).times(l.uomFactor).negated(),
          refType: 'GOODS_SWAP',
          refId: swap.id,
          refNumber: swap.number,
          date: swap.date,
        });
        items.push({ productId: l.productId, value: out.value });
        cost = cost.plus(out.value);
      }
      const semi = await semiSet(tx, u.tenantId, items.map((i) => i.productId));
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: swap.date,
        description: `Tukar-guling ${swap.number} (${swap.reason === 'EXPIRED' ? 'kedaluwarsa' : swap.reason === 'DAMAGED' ? 'rusak' : 'penarikan produk'})`,
        sourceType: 'GOODS_SWAP',
        sourceId: swap.id,
        createdById: u.sub,
        lines: [{ key: SYS.EXPIRED_LOSS, debit: cost }, ...inventoryLines(items, semi, 'credit')],
      });
      await tx.update(goodsSwaps).set({ status: 'APPROVED', decidedById: u.sub, decidedAt: new Date(), journalId: journal.id, costAmount: cost.toFixed(2) }).where(eq(goodsSwaps.id, id));
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'GoodsSwap', entityId: id, data: { number: swap.number, cost: cost.toFixed(2), journal: journal.number } });
      return { id, status: 'APPROVED', cost: cost.toFixed(2), journalNumber: journal.number };
    });
  }

  async reject(u: AuthUser, id: string, reason: string) {
    const [swap] = await this.db.select().from(goodsSwaps).where(and(eq(goodsSwaps.id, id), eq(goodsSwaps.tenantId, u.tenantId)));
    if (!swap) throw new NotFoundException('Dokumen tukar-guling tidak ditemukan');
    if (swap.status !== 'PENDING') throw new BadRequestException('Dokumen ini sudah diputuskan');
    await this.db.update(goodsSwaps).set({ status: 'REJECTED', decidedById: u.sub, decidedAt: new Date(), rejectReason: reason }).where(eq(goodsSwaps.id, id));
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'GoodsSwap', entityId: id, data: { number: swap.number, reason } });
    return { id, status: 'REJECTED' };
  }
}

@ApiTags('Retur')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('goods-swaps')
export class SwapsController {
  constructor(private readonly svc: SwapsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: SwapQueryDto) {
    return this.svc.list(u.tenantId, q.status);
  }
  @Post()
  @Roles('ADMIN', 'SALES', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSwapDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id/approve')
  @Roles('ADMIN', 'FINANCE')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(u, id);
  }
  @Post(':id/reject')
  @Roles('ADMIN', 'FINANCE')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectSwapDto) {
    return this.svc.reject(u, id, dto.reason);
  }
}
