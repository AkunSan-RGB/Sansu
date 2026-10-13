/**
 * Operasi gudang: transfer antar gudang, stock opname, stok minimum, rekap stok semua gudang.
 */
import { inventoryLines, semiSet } from './inventory-accounts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, type Dec, money, ZERO } from '../../common/utils/money';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  products,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockMinimums,
  stockTransferLines,
  stockTransfers,
  users,
  warehouses,
} from '../../db/schema';
import { InventoryService } from './inventory.service';
import { StockService } from './stock.service';

// ---------- DTO ----------
export class TransferLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '24', description: 'Satuan dasar' }) @IsNumberString() qty: string;
}
export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromWarehouseId: string;
  @ApiProperty() @IsUUID() toWarehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
  @ApiPropertyOptional({
    enum: ['DIRECT', 'IN_TRANSIT'],
    description: 'DIRECT = langsung diterima; IN_TRANSIT = dikirim, diterima belakangan oleh gudang tujuan',
  })
  @IsOptional()
  @IsIn(['DIRECT', 'IN_TRANSIT'])
  mode?: 'DIRECT' | 'IN_TRANSIT';
  @ApiProperty({ type: [TransferLineDto] })
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  lines: TransferLineDto[];
}
export class ReceiveLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '24', description: 'Jumlah yang benar-benar diterima (satuan dasar)' })
  @IsNumberString()
  receivedQty: string;
}
export class ReceiveTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ type: [ReceiveLineDto], description: 'Kosong = semua diterima sesuai kiriman' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  @ArrayMaxSize(1000)
  lines?: ReceiveLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class CancelTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class CreateCountDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Hanya produk kategori ini' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class CountLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ nullable: true, description: 'Jumlah fisik (satuan dasar); null = belum dihitung' })
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  countedQty: string | null;
}
export class UpdateCountDto {
  @ApiProperty({ type: [CountLineDto] })
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  @ArrayMaxSize(20000)
  lines: CountLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
export class MinimumItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ nullable: true, description: 'null / 0 = hapus stok minimum' })
  @ValidateIf((_, v) => v !== null)
  @IsNumberString()
  minQty: string | null;
}
export class SaveMinimumsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [MinimumItemDto] })
  @ValidateNested({ each: true })
  @Type(() => MinimumItemDto)
  @ArrayMaxSize(20000)
  items: MinimumItemDto[];
}

const q4 = (v: string | number) => D(v).toFixed(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WarehouseOpsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly inventory: InventoryService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  private async warehouse(db: Db | Tx, tenantId: string, id: string) {
    const [w] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
    if (!w) throw new BadRequestException('Gudang tidak ditemukan');
    return w;
  }

  /** Filter gudang sesuai hak akses pengguna */
  private scope(u: AuthUser, col: PgColumn, requested?: string) {
    if (requested && !UUID.test(requested)) throw new BadRequestException('Gudang tidak valid');
    const allowed = allowedWarehouses(u);
    if (requested) {
      assertWarehouseAccess(u, requested);
      return eq(col, requested);
    }
    return allowed ? inArray(col, allowed) : undefined;
  }

  // ===================== Transfer =====================
  async listTransfers(u: AuthUser, warehouseId?: string) {
    const allowed = allowedWarehouses(u);
    if (warehouseId && !UUID.test(warehouseId)) throw new BadRequestException('Gudang tidak valid');
    if (warehouseId) assertWarehouseAccess(u, warehouseId);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.number, t.date, t.notes, t.total_value AS "totalValue", t.created_at AS "createdAt",
             t.status, t.received_date AS "receivedDate",
             t.from_warehouse_id AS "fromWarehouseId", fw.code AS "fromCode", fw.name AS "fromName",
             t.to_warehouse_id AS "toWarehouseId", tw.code AS "toCode", tw.name AS "toName",
             (SELECT COUNT(*) FROM stock_transfer_lines l WHERE l.transfer_id = t.id)::int AS lines,
             u.name AS "createdBy"
      FROM stock_transfers t
      JOIN warehouses fw ON fw.id = t.from_warehouse_id
      JOIN warehouses tw ON tw.id = t.to_warehouse_id
      LEFT JOIN users u ON u.id = t.created_by_id
      WHERE t.tenant_id = ${u.tenantId}
        ${warehouseId ? sql`AND (t.from_warehouse_id = ${warehouseId} OR t.to_warehouse_id = ${warehouseId})` : sql``}
        ${allowed ? sql`AND (t.from_warehouse_id = ANY(${`{${allowed.join(',')}}`}::uuid[]) OR t.to_warehouse_id = ANY(${`{${allowed.join(',')}}`}::uuid[]))` : sql``}
      ORDER BY (t.status = 'IN_TRANSIT') DESC, t.date DESC, t.number DESC
      LIMIT 500`);
    return rows.rows;
  }

  async getTransfer(u: AuthUser, id: string) {
    const [t] = await this.db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, u.tenantId)));
    if (!t) throw new NotFoundException('Transfer tidak ditemukan');
    const allowed = allowedWarehouses(u);
    if (allowed && !allowed.includes(t.fromWarehouseId) && !allowed.includes(t.toWarehouseId))
      throw new NotFoundException('Transfer tidak ditemukan');
    const [from, to] = await Promise.all([
      this.warehouse(this.db, u.tenantId, t.fromWarehouseId),
      this.warehouse(this.db, u.tenantId, t.toWarehouseId),
    ]);
    const lines = await this.db
      .select({
        productId: stockTransferLines.productId,
        sku: products.sku,
        name: products.name,
        baseUom: products.baseUom,
        qty: stockTransferLines.qty,
        unitCost: stockTransferLines.unitCost,
        receivedQty: stockTransferLines.receivedQty,
      })
      .from(stockTransferLines)
      .innerJoin(products, eq(products.id, stockTransferLines.productId))
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(asc(products.sku));
    const [by] = t.createdById
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, t.createdById))
      : [];
    const [rb] = t.receivedById
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, t.receivedById))
      : [];
    return {
      ...t,
      from: { id: from.id, code: from.code, name: from.name, address: from.address },
      to: { id: to.id, code: to.code, name: to.name, address: to.address },
      createdBy: by?.name ?? null,
      receivedBy: rb?.name ?? null,
      lines,
    };
  }

  /**
   * Transfer antar gudang.
   * - DIRECT: stok keluar dari asal (HPP rata-rata asal) & langsung masuk ke tujuan dengan HPP yang sama — tanpa jurnal (akun persediaan sama).
   * - IN_TRANSIT: stok keluar dari asal; nilainya pindah ke akun "Persediaan dalam Perjalanan" sampai gudang tujuan menerima.
   */
  async createTransfer(u: AuthUser, dto: CreateTransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId)
      throw new BadRequestException('Gudang asal dan tujuan harus berbeda');
    const date = toDocDate(dto.date);
    const transit = dto.mode === 'IN_TRANSIT';
    // gabungkan baris produk yang sama
    const merged = new Map<string, ReturnType<typeof D>>();
    for (const l of dto.lines) {
      const q = D(l.qty);
      if (!q.isPositive()) throw new BadRequestException('Jumlah transfer harus lebih dari nol');
      merged.set(l.productId, (merged.get(l.productId) ?? ZERO).plus(q));
    }
    return this.db.transaction(async (tx) => {
      const from = await this.warehouse(tx, u.tenantId, dto.fromWarehouseId);
      const to = await this.warehouse(tx, u.tenantId, dto.toWarehouseId);
      assertWarehouseAccess(u, from.id);
      if (!to.isActive) throw new BadRequestException(`Gudang tujuan ${to.name} nonaktif`);
      const ids = [...merged.keys()];
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, u.tenantId), inArray(products.id, ids)));
      if (found.length !== ids.length) throw new BadRequestException('Ada produk yang tidak ditemukan');

      const id = randomUUID();
      const number = await this.seq.next(tx, u.tenantId, 'STOCK_TRANSFER', date);
      await tx.insert(stockTransfers).values({
        id,
        tenantId: u.tenantId,
        number,
        date,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        notes: dto.notes ?? null,
        createdById: u.sub,
        status: transit ? 'IN_TRANSIT' : 'RECEIVED',
        ...(transit ? {} : { receivedDate: date, receivedAt: new Date(), receivedById: u.sub }),
      });
      let total = ZERO;
      const sentItems: { productId: string; value: Dec }[] = [];
      for (const [productId, qty] of merged) {
        const out = await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId,
          warehouseId: from.id,
          type: 'TRANSFER_OUT',
          qty: qty.negated(),
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: number,
          date,
        });
        total = total.plus(out.value);
        sentItems.push({ productId, value: out.value });
        if (transit) {
          await tx
            .insert(stockTransferLines)
            .values({ transferId: id, productId, qty: qty.toFixed(4), unitCost: out.unitCost.toFixed(4), writedownUnit: out.writedownUnit.toFixed(4) });
          continue;
        }
        await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId,
          warehouseId: to.id,
          type: 'TRANSFER_IN',
          qty,
          unitCost: out.unitCost,
          writedownUnit: out.writedownUnit,
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: number,
          date,
          skipAccessCheck: true,
        });
        await tx
          .insert(stockTransferLines)
          .values({
            transferId: id,
            productId,
            qty: qty.toFixed(4),
            unitCost: out.unitCost.toFixed(4),
            writedownUnit: out.writedownUnit.toFixed(4),
            receivedQty: qty.toFixed(4),
          });
      }
      await tx
        .update(stockTransfers)
        .set({ totalValue: total.toFixed(2) })
        .where(eq(stockTransfers.id, id));
      if (transit && total.gt(0)) {
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Kirim barang ${number}: ${from.name} → ${to.name}`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: number,
          createdById: u.sub,
          lines: [{ key: SYS.INVENTORY_TRANSIT, debit: total }, ...inventoryLines(sentItems, await semiSet(tx, u.tenantId, sentItems.map((x) => x.productId)), 'credit')],
        });
      }
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CREATE',
        entity: 'StockTransfer',
        entityId: id,
        data: { number, mode: transit ? 'IN_TRANSIT' : 'DIRECT', from: from.code, to: to.code, lines: dto.lines },
      });
      return { id, number, totalValue: total.toFixed(2), status: transit ? 'IN_TRANSIT' : 'RECEIVED' };
    });
  }

  /** Lock transfer dalam perjalanan */
  private async lockTransit(tx: Tx, u: AuthUser, id: string) {
    const r = await tx.execute<{ id: string }>(
      sql`SELECT id FROM stock_transfers WHERE id = ${id} AND tenant_id = ${u.tenantId} FOR UPDATE`,
    );
    if (!r.rows.length) throw new NotFoundException('Transfer tidak ditemukan');
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
    if (t.status !== 'IN_TRANSIT')
      throw new BadRequestException(
        t.status === 'RECEIVED' ? 'Barang transfer ini sudah diterima' : 'Transfer ini sudah dibatalkan',
      );
    const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
    return { t, lines };
  }

  /**
   * Gudang tujuan menerima barang. Barang masuk dengan HPP saat dikirim.
   * Kekurangan (rusak/hilang di jalan) dibebankan ke Selisih Persediaan.
   */
  async receiveTransfer(u: AuthUser, id: string, dto: ReceiveTransferDto) {
    return this.db.transaction(async (tx) => {
      const { t, lines } = await this.lockTransit(tx, u, id);
      assertWarehouseAccess(u, t.toWarehouseId);
      const to = await this.warehouse(tx, u.tenantId, t.toWarehouseId);
      const date = toDocDate(dto.date);
      if (date < t.date) throw new BadRequestException('Tanggal terima tidak boleh sebelum tanggal kirim');
      const given = new Map<string, ReturnType<typeof D>>();
      for (const l of dto.lines ?? []) {
        if (!lines.some((x) => x.productId === l.productId))
          throw new BadRequestException('Produk tidak ada di transfer ini');
        given.set(l.productId, D(l.receivedQty));
      }
      let received = ZERO;
      let shortage = ZERO;
      const recItems: { productId: string; value: Dec }[] = [];
      const short: string[] = [];
      for (const l of lines) {
        const sent = D(l.qty);
        const rq = given.get(l.productId) ?? sent;
        if (rq.isNegative()) throw new BadRequestException('Jumlah diterima tidak boleh negatif');
        if (rq.gt(sent)) throw new BadRequestException('Jumlah diterima tidak boleh melebihi jumlah yang dikirim');
        const lineValue = money(sent.times(l.unitCost));
        const recValue = rq.eq(sent) ? lineValue : money(rq.times(l.unitCost));
        if (rq.gt(0)) {
          await this.stock.move(tx, {
            tenantId: u.tenantId,
            productId: l.productId,
            warehouseId: to.id,
            type: 'TRANSFER_IN',
            qty: rq,
            unitCost: l.unitCost,
            writedownUnit: l.writedownUnit,
            refType: 'STOCK_TRANSFER',
            refId: id,
            refNumber: t.number,
            date,
            skipAccessCheck: true,
          });
        }
        if (rq.lt(sent)) short.push(l.productId);
        received = received.plus(recValue);
        recItems.push({ productId: l.productId, value: recValue });
        shortage = shortage.plus(lineValue.minus(recValue));
        await tx
          .update(stockTransferLines)
          .set({ receivedQty: rq.toFixed(4) })
          .where(eq(stockTransferLines.id, l.id));
      }
      // selisih pembulatan antar baris → ikut ke kekurangan agar akun transit kembali nol
      const total = D(t.totalValue);
      shortage = total.minus(received);
      if (total.gt(0)) {
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Terima barang ${t.number} di ${to.name}${short.length ? ' (ada kekurangan)' : ''}`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: t.number,
          createdById: u.sub,
          lines: [
            ...inventoryLines(recItems, await semiSet(tx, u.tenantId, recItems.map((x) => x.productId)), 'debit'),
            {
              key: SYS.INVENTORY_ADJ,
              debit: shortage,
              memo: shortage.gt(0) ? 'Kekurangan barang transfer' : undefined,
            },
            { key: SYS.INVENTORY_TRANSIT, credit: total },
          ],
        });
      }
      await tx
        .update(stockTransfers)
        .set({
          status: 'RECEIVED',
          receivedDate: date,
          receivedAt: new Date(),
          receivedById: u.sub,
          receiveNotes: dto.notes ?? null,
        })
        .where(eq(stockTransfers.id, id));
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'RECEIVE',
        entity: 'StockTransfer',
        entityId: id,
        data: { number: t.number, date, shortage: shortage.toFixed(2), lines: dto.lines ?? 'ALL' },
      });
      return {
        ok: true,
        receivedValue: received.toFixed(2),
        shortageValue: shortage.toFixed(2),
        shortItems: short.length,
      };
    });
  }

  /** Batalkan kiriman yang belum diterima: barang kembali ke gudang asal */
  async cancelTransfer(u: AuthUser, id: string, dto: CancelTransferDto) {
    return this.db.transaction(async (tx) => {
      const { t, lines } = await this.lockTransit(tx, u, id);
      assertWarehouseAccess(u, t.fromWarehouseId);
      const date = toDocDate(dto.date);
      if (date < t.date) throw new BadRequestException('Tanggal batal tidak boleh sebelum tanggal kirim');
      for (const l of lines) {
        await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId: l.productId,
          warehouseId: t.fromWarehouseId,
          type: 'TRANSFER_IN',
          qty: l.qty,
          unitCost: l.unitCost,
          writedownUnit: l.writedownUnit,
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: t.number,
          date,
        });
        await tx.update(stockTransferLines).set({ receivedQty: '0' }).where(eq(stockTransferLines.id, l.id));
      }
      const total = D(t.totalValue);
      // nilai per barang dari biaya kirim; selisih pembulatan terhadap total ditambahkan ke barang pertama
      const backItems = lines.map((l) => ({ productId: l.productId, value: money(D(l.qty).times(l.unitCost)) }));
      if (backItems.length) backItems[0].value = backItems[0].value.plus(total.minus(backItems.reduce((a, x) => a.plus(x.value), ZERO)));
      if (total.gt(0)) {
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Batal kirim ${t.number} — barang kembali ke gudang asal`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: t.number,
          createdById: u.sub,
          lines: [...inventoryLines(backItems, await semiSet(tx, u.tenantId, backItems.map((x) => x.productId)), 'debit'), { key: SYS.INVENTORY_TRANSIT, credit: total }],
        });
      }
      await tx
        .update(stockTransfers)
        .set({
          status: 'CANCELLED',
          receivedDate: date,
          receivedAt: new Date(),
          receivedById: u.sub,
          receiveNotes: dto.notes ?? 'Dibatalkan',
        })
        .where(eq(stockTransfers.id, id));
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CANCEL',
        entity: 'StockTransfer',
        entityId: id,
        data: { number: t.number, date },
      });
      return { ok: true };
    });
  }

  // ===================== Stock opname =====================
  async listCounts(u: AuthUser, warehouseId?: string) {
    return this.db
      .select({
        id: stockCounts.id,
        number: stockCounts.number,
        date: stockCounts.date,
        status: stockCounts.status,
        category: stockCounts.category,
        notes: stockCounts.notes,
        adjustmentNumber: stockCounts.adjustmentNumber,
        warehouseId: stockCounts.warehouseId,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        lines: sql<number>`(SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = ${stockCounts.id})::int`,
        counted: sql<number>`(SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = ${stockCounts.id} AND l.counted_qty IS NOT NULL)::int`,
        createdAt: stockCounts.createdAt,
      })
      .from(stockCounts)
      .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
      .where(and(eq(stockCounts.tenantId, u.tenantId), this.scope(u, stockCounts.warehouseId, warehouseId)))
      .orderBy(desc(stockCounts.createdAt))
      .limit(300);
  }

  /** Buat lembar hitung: semua produk aktif (atau yang masih punya stok) beserta stok sistem saat ini */
  async createCount(u: AuthUser, dto: CreateCountDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const wh = await this.warehouse(tx, u.tenantId, dto.warehouseId);
      const [open] = await tx
        .select({ number: stockCounts.number })
        .from(stockCounts)
        .where(
          and(
            eq(stockCounts.tenantId, u.tenantId),
            eq(stockCounts.warehouseId, wh.id),
            eq(stockCounts.status, 'DRAFT'),
          ),
        );
      if (open) throw new BadRequestException(`Masih ada stock opname ${open.number} yang belum selesai di gudang ini`);
      const rows = await tx
        .select({ id: products.id, qty: sql<string>`COALESCE(${stockBalances.qty}, 0)` })
        .from(products)
        .leftJoin(stockBalances, and(eq(stockBalances.productId, products.id), eq(stockBalances.warehouseId, wh.id)))
        .where(
          and(
            eq(products.tenantId, u.tenantId),
            or(eq(products.isActive, true), sql`COALESCE(${stockBalances.qty}, 0) <> 0`),
            dto.category ? eq(products.category, dto.category) : undefined,
          ),
        );
      if (!rows.length) throw new BadRequestException('Tidak ada produk untuk dihitung');
      const id = randomUUID();
      const number = await this.seq.next(tx, u.tenantId, 'STOCK_COUNT', date);
      await tx
        .insert(stockCounts)
        .values({
          id,
          tenantId: u.tenantId,
          number,
          date,
          warehouseId: wh.id,
          category: dto.category ?? null,
          notes: dto.notes ?? null,
          createdById: u.sub,
        });
      for (let i = 0; i < rows.length; i += 1000) {
        await tx
          .insert(stockCountLines)
          .values(rows.slice(i, i + 1000).map((r) => ({ countId: id, productId: r.id, systemQty: q4(r.qty) })));
      }
      return { id, number, lines: rows.length };
    });
  }

  /** `lock`: kunci baris opname (di dalam transaksi) supaya dua permintaan serentak tidak membukukan selisih dua kali */
  private async ownCount(u: AuthUser, id: string, db: Db | Tx = this.db, lock = false) {
    const q = db
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.id, id), eq(stockCounts.tenantId, u.tenantId)));
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Stock opname tidak ditemukan');
    assertWarehouseAccess(u, c.warehouseId);
    return c;
  }

  async getCount(u: AuthUser, id: string) {
    const c = await this.ownCount(u, id);
    const wh = await this.warehouse(this.db, u.tenantId, c.warehouseId);
    const lines = await this.db
      .select({
        productId: stockCountLines.productId,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        systemQty: stockCountLines.systemQty,
        currentQty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        avgCost: sql<string>`COALESCE(${stockBalances.avgCost}, 0)`,
        countedQty: stockCountLines.countedQty,
        postedSystemQty: stockCountLines.postedSystemQty,
        difference: stockCountLines.difference,
      })
      .from(stockCountLines)
      .innerJoin(products, eq(products.id, stockCountLines.productId))
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, stockCountLines.productId), eq(stockBalances.warehouseId, c.warehouseId)),
      )
      .where(eq(stockCountLines.countId, id))
      .orderBy(asc(products.category), asc(products.sku));
    return { ...c, warehouse: { id: wh.id, code: wh.code, name: wh.name }, lines };
  }

  async updateCount(u: AuthUser, id: string, dto: UpdateCountDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT') throw new BadRequestException('Stock opname ini sudah selesai');
      for (const l of dto.lines) {
        if (l.countedQty !== null && D(l.countedQty).isNegative())
          throw new BadRequestException('Jumlah fisik tidak boleh negatif');
        await tx
          .update(stockCountLines)
          .set({ countedQty: l.countedQty === null ? null : q4(l.countedQty) })
          .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.productId, l.productId)));
      }
      if (dto.notes !== undefined) await tx.update(stockCounts).set({ notes: dto.notes }).where(eq(stockCounts.id, id));
      return { ok: true };
    });
  }

  /** Bukukan selisih: jumlah fisik dibandingkan stok sistem SAAT DIPOSTING → penyesuaian stok + jurnal */
  async postCount(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT') throw new BadRequestException('Stock opname ini sudah selesai');
      const lines = await tx
        .select({
          productId: stockCountLines.productId,
          countedQty: stockCountLines.countedQty,
          qty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
          avgCost: sql<string>`COALESCE(${stockBalances.avgCost}, 0)`,
        })
        .from(stockCountLines)
        .leftJoin(
          stockBalances,
          and(eq(stockBalances.productId, stockCountLines.productId), eq(stockBalances.warehouseId, c.warehouseId)),
        )
        .where(and(eq(stockCountLines.countId, id), isNotNull(stockCountLines.countedQty)));
      if (!lines.length) throw new BadRequestException('Belum ada produk yang diisi jumlah fisiknya');
      const adj: { productId: string; qty: string; unitCost?: string }[] = [];
      for (const l of lines) {
        const diff = D(l.countedQty!).minus(l.qty);
        await tx
          .update(stockCountLines)
          .set({ postedSystemQty: q4(l.qty), difference: diff.toFixed(4) })
          .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.productId, l.productId)));
        if (!diff.isZero())
          adj.push({
            productId: l.productId,
            qty: diff.toFixed(4),
            unitCost: diff.isPositive() ? D(l.avgCost).toFixed(4) : undefined,
          });
      }
      let adjustmentNumber: string | null = null;
      let valueIn = '0.00';
      let valueOut = '0.00';
      if (adj.length) {
        const r = await this.inventory.adjust(
          u,
          {
            warehouseId: c.warehouseId,
            date: c.date,
            reason: 'STOCK_OPNAME',
            notes: `Stock opname ${c.number}`,
            lines: adj,
          },
          tx,
        );
        adjustmentNumber = r.number;
        valueIn = r.valueIn;
        valueOut = r.valueOut;
      }
      await tx
        .update(stockCounts)
        .set({ status: 'POSTED', postedAt: new Date(), adjustmentNumber })
        .where(eq(stockCounts.id, id));
      return { ok: true, counted: lines.length, adjusted: adj.length, adjustmentNumber, valueIn, valueOut };
    });
  }

  async cancelCount(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT')
        throw new BadRequestException('Hanya stock opname yang belum selesai yang bisa dibatalkan');
      await tx.update(stockCounts).set({ status: 'CANCELLED' }).where(eq(stockCounts.id, id));
      return { ok: true };
    });
  }

  // ===================== Stok minimum =====================
  async minimums(u: AuthUser, warehouseId: string) {
    assertWarehouseAccess(u, warehouseId);
    await this.warehouse(this.db, u.tenantId, warehouseId);
    return this.db
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        qty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        minQty: stockMinimums.minQty,
      })
      .from(products)
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, products.id), eq(stockBalances.warehouseId, warehouseId)),
      )
      .leftJoin(
        stockMinimums,
        and(eq(stockMinimums.productId, products.id), eq(stockMinimums.warehouseId, warehouseId)),
      )
      .where(and(eq(products.tenantId, u.tenantId), eq(products.isActive, true)))
      .orderBy(asc(products.sku));
  }

  async saveMinimums(u: AuthUser, dto: SaveMinimumsDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    await this.warehouse(this.db, u.tenantId, dto.warehouseId);
    const ids = [...new Set(dto.items.map((i) => i.productId))];
    if (!ids.length) return { saved: 0 };
    const found = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, u.tenantId), inArray(products.id, ids)));
    if (found.length !== ids.length) throw new BadRequestException('Ada produk yang tidak ditemukan');
    await this.db.transaction(async (tx) => {
      for (const i of dto.items) {
        if (i.minQty === null || D(i.minQty).lte(0)) {
          await tx
            .delete(stockMinimums)
            .where(and(eq(stockMinimums.productId, i.productId), eq(stockMinimums.warehouseId, dto.warehouseId)));
        } else {
          await tx
            .insert(stockMinimums)
            .values({
              tenantId: u.tenantId,
              productId: i.productId,
              warehouseId: dto.warehouseId,
              minQty: q4(i.minQty),
            })
            .onConflictDoUpdate({
              target: [stockMinimums.productId, stockMinimums.warehouseId],
              set: { minQty: q4(i.minQty) },
            });
        }
      }
    });
    return { saved: dto.items.length };
  }

  /** Produk yang stoknya di bawah minimum (semua gudang yang boleh diakses) */
  async lowStock(u: AuthUser, warehouseId?: string) {
    const rows = await this.db
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        baseUom: products.baseUom,
        warehouseId: warehouses.id,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        qty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        minQty: stockMinimums.minQty,
      })
      .from(stockMinimums)
      .innerJoin(products, eq(products.id, stockMinimums.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockMinimums.warehouseId))
      .leftJoin(
        stockBalances,
        and(
          eq(stockBalances.productId, stockMinimums.productId),
          eq(stockBalances.warehouseId, stockMinimums.warehouseId),
        ),
      )
      .where(
        and(
          eq(stockMinimums.tenantId, u.tenantId),
          eq(products.isActive, true),
          eq(warehouses.isActive, true),
          sql`COALESCE(${stockBalances.qty}, 0) < ${stockMinimums.minQty}`,
          this.scope(u, stockMinimums.warehouseId, warehouseId),
        ),
      )
      .orderBy(asc(warehouses.code), asc(products.sku));
    return rows.map((r) => ({ ...r, shortage: D(r.minQty).minus(r.qty).toFixed(4) }));
  }

  // ===================== Rekap semua gudang =====================
  async matrix(u: AuthUser, opts: { includeZero?: boolean; category?: string }) {
    const allowed = allowedWarehouses(u);
    const whs = await this.db
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, u.tenantId), allowed ? inArray(warehouses.id, allowed) : undefined))
      .orderBy(asc(warehouses.code));
    const ids = whs.map((w) => w.id);
    const bal = ids.length
      ? await this.db
          .select({
            productId: stockBalances.productId,
            warehouseId: stockBalances.warehouseId,
            qty: stockBalances.qty,
            avgCost: stockBalances.avgCost,
          })
          .from(stockBalances)
          .where(and(eq(stockBalances.tenantId, u.tenantId), inArray(stockBalances.warehouseId, ids)))
      : [];
    const mins = ids.length
      ? await this.db
          .select({
            productId: stockMinimums.productId,
            warehouseId: stockMinimums.warehouseId,
            minQty: stockMinimums.minQty,
          })
          .from(stockMinimums)
          .where(and(eq(stockMinimums.tenantId, u.tenantId), inArray(stockMinimums.warehouseId, ids)))
      : [];
    const prods = await this.db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        isActive: products.isActive,
      })
      .from(products)
      .where(and(eq(products.tenantId, u.tenantId), opts.category ? eq(products.category, opts.category) : undefined))
      .orderBy(asc(products.sku));
    const byProd = new Map<
      string,
      {
        qty: Record<string, string>;
        value: ReturnType<typeof D>;
        total: ReturnType<typeof D>;
        min: Record<string, string>;
      }
    >();
    const get = (id: string) => {
      let r = byProd.get(id);
      if (!r) byProd.set(id, (r = { qty: {}, value: ZERO, total: ZERO, min: {} }));
      return r;
    };
    for (const b of bal) {
      const r = get(b.productId);
      r.qty[b.warehouseId] = D(b.qty).toFixed(4);
      r.total = r.total.plus(b.qty);
      r.value = r.value.plus(D(b.qty).times(b.avgCost));
    }
    for (const m of mins) get(m.productId).min[m.warehouseId] = D(m.minQty).toFixed(4);
    const rows = prods
      .map((p) => {
        const r = byProd.get(p.id);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          baseUom: p.baseUom,
          isActive: p.isActive,
          qty: r?.qty ?? {},
          min: r?.min ?? {},
          totalQty: (r?.total ?? ZERO).toFixed(4),
          value: (r?.value ?? ZERO).toFixed(2),
        };
      })
      .filter((r) => (opts.includeZero ? r.isActive || !D(r.totalQty).isZero() : !D(r.totalQty).isZero()));
    const totals = {
      value: rows.reduce((s, r) => s.plus(r.value), ZERO).toFixed(2),
      byWarehouse: Object.fromEntries(
        ids.map((id) => [
          id,
          bal
            .filter((b) => b.warehouseId === id)
            .reduce((s, b) => s.plus(D(b.qty).times(b.avgCost)), ZERO)
            .toFixed(2),
        ]),
      ),
    };
    return { warehouses: whs, rows, totals };
  }
}

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory')
export class WarehouseOpsController {
  constructor(private readonly svc: WarehouseOpsService) {}

  @Get('transfers')
  transfers(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.svc.listTransfers(u, warehouseId || undefined);
  }
  @Get('transfers/:id')
  transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTransfer(u, id);
  }
  @Post('transfers')
  @Roles('ADMIN', 'WAREHOUSE')
  createTransfer(@CurrentUser() u: AuthUser, @Body() dto: CreateTransferDto) {
    return this.svc.createTransfer(u, dto);
  }

  @Post('transfers/:id/receive')
  @Roles('ADMIN', 'WAREHOUSE')
  receiveTransfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveTransferDto) {
    return this.svc.receiveTransfer(u, id, dto);
  }
  @Post('transfers/:id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancelTransfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto) {
    return this.svc.cancelTransfer(u, id, dto);
  }

  @Get('counts')
  counts(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.svc.listCounts(u, warehouseId || undefined);
  }
  @Get('counts/:id')
  count(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getCount(u, id);
  }
  @Post('counts')
  @Roles('ADMIN', 'WAREHOUSE')
  createCount(@CurrentUser() u: AuthUser, @Body() dto: CreateCountDto) {
    return this.svc.createCount(u, dto);
  }
  @Put('counts/:id')
  @Roles('ADMIN', 'WAREHOUSE')
  updateCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCountDto) {
    return this.svc.updateCount(u, id, dto);
  }
  @Post('counts/:id/post')
  @Roles('ADMIN', 'FINANCE')
  postCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.postCount(u, id);
  }
  @Post('counts/:id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancelCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelCount(u, id);
  }

  @Get('minimums')
  minimums(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.svc.minimums(u, warehouseId);
  }
  @Put('minimums')
  @Roles('ADMIN', 'WAREHOUSE', 'SALES')
  saveMinimums(@CurrentUser() u: AuthUser, @Body() dto: SaveMinimumsDto) {
    return this.svc.saveMinimums(u, dto);
  }
  @Get('low-stock')
  lowStock(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.svc.lowStock(u, warehouseId || undefined);
  }
  @Get('matrix')
  matrix(@CurrentUser() u: AuthUser, @Query('includeZero') includeZero?: string, @Query('category') category?: string) {
    return this.svc.matrix(u, { includeZero: includeZero === 'true', category: category || undefined });
  }
}
