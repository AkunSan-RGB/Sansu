/**
 * Meja, pesanan terbuka, dan layar dapur untuk kafe/restoran.
 *  - Meja: daftar meja per outlet; satu meja hanya punya satu pesanan terbuka.
 *  - Pesanan terbuka (tab): menu dipesan dan dikirim ke dapur dulu, dibayar belakangan (bisa sebagian: pisah bill). Stok, HPP, pajak,
 *    dan jurnal baru terjadi saat dibayar, lewat transaksi kasir yang sama seperti penjualan biasa.
 *  - Dapur: antrean menu (baru → dimasak → siap → disajikan). Barang yang bukan menu (air kemasan) langsung dianggap disajikan.
 *  - Kontrol: pembatalan menu yang sudah mulai dimasak atau disajikan hanya oleh supervisor dengan alasan, dan tercatat.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { POS_ORDER_TYPES, type PosOrderType } from '@sansu/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { todayJakarta } from '../../common/utils/dates';
import { D, Dec, qty4, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { posSessions, posTabLines, posTables, posTabs, products, stockBalances, type PosTabLineStatus, warehouses } from '../../db/schema';
import { CreatePosOrderDto, PosModule, PosPaymentDto, PosService } from './pos.module';
import { componentNeeds, recipesFor } from './recipe-issue';

const SUPERVISORS = ['OWNER', 'ADMIN', 'FINANCE'];
const isSupervisor = (u: AuthUser) => SUPERVISORS.includes(u.role);
const KITCHEN_FLOW: Record<string, number> = { NEW: 1, PREPARING: 2, READY: 3, SERVED: 4 };

// ---------- DTO ----------
export class CreateTableDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ example: 'M05' }) @IsString() @MinLength(1) @MaxLength(20) code: string;
  @ApiProperty({ example: 'Meja 5' }) @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiPropertyOptional({ example: 4 }) @IsOptional() @IsInt() @Min(1) @Max(200) seats?: number;
}
export class UpdateTableDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) seats?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class TabLineInputDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ example: 'Tanpa gula, es sedikit' }) @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
export class CreateTabDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional({ example: 'Meja 5', description: 'Label bebas bila tanpa meja (nama pemesan, nomor antrean)' }) @IsOptional() @IsString() @MaxLength(40) tableLabel?: string;
  @ApiPropertyOptional({ enum: POS_ORDER_TYPES }) @IsOptional() @IsIn(POS_ORDER_TYPES) orderType?: PosOrderType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) guestName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @ApiPropertyOptional({ type: [TabLineInputDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabLineInputDto) lines?: TabLineInputDto[];
}
export class AddTabLinesDto {
  @ApiProperty({ type: [TabLineInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TabLineInputDto) lines: TabLineInputDto[];
}
export class VoidTabLineDto {
  @ApiPropertyOptional({ description: 'Wajib (min. 5 karakter) untuk menu yang sudah dikirim ke dapur' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class CancelTabDto {
  @ApiProperty({ description: 'Alasan (min. 5 karakter)' }) @IsString() @MinLength(5) @MaxLength(200) reason: string;
}
export class MoveTabDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) tableLabel?: string;
}
export class PayTabDto {
  @ApiProperty() @IsUUID() sessionId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ type: [String], description: 'Baris yang dibayar sekarang (pisah bill); kosong = semua yang belum dibayar' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  lineIds?: string[];
  @ApiProperty({ type: [PosPaymentDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PosPaymentDto) payments: PosPaymentDto[];
}
export class KitchenStatusDto {
  @ApiProperty({ enum: ['PREPARING', 'READY', 'SERVED'] }) @IsIn(['PREPARING', 'READY', 'SERVED']) status: 'PREPARING' | 'READY' | 'SERVED';
}
export class TabQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'PAID', 'CANCELLED'] }) @IsOptional() @IsIn(['OPEN', 'PAID', 'CANCELLED']) status?: 'OPEN' | 'PAID' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
export class WarehouseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}

const MAX_QTY = D(9999);

@Injectable()
export class PosTabsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pos: PosService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ================= Meja =================
  async listTables(user: AuthUser, q: WarehouseQueryDto) {
    if (q.warehouseId) assertWarehouseAccess(user, q.warehouseId);
    const allowed = allowedWarehouses(user);
    const rows = await this.db.execute<{
      id: string; warehouse_id: string; warehouse_code: string; code: string; name: string; seats: number | null; is_active: boolean;
      tab_id: string | null; tab_number: string | null; tab_since: string | null; items: number | null; amount: string | null;
    }>(sql`
      SELECT t.id, t.warehouse_id, w.code AS warehouse_code, t.code, t.name, t.seats, t.is_active,
             b.id AS tab_id, b.number AS tab_number, b.created_at::text AS tab_since,
             (SELECT COUNT(*)::int FROM pos_tab_lines l WHERE l.tab_id = b.id AND l.status <> 'VOID' AND l.paid_order_id IS NULL) AS items,
             (SELECT COALESCE(SUM(l.qty * p.sell_price), 0)::text FROM pos_tab_lines l JOIN products p ON p.id = l.product_id
                WHERE l.tab_id = b.id AND l.status <> 'VOID' AND l.paid_order_id IS NULL) AS amount
      FROM pos_tables t
      JOIN warehouses w ON w.id = t.warehouse_id
      LEFT JOIN pos_tabs b ON b.table_id = t.id AND b.status = 'OPEN'
      WHERE t.tenant_id = ${user.tenantId}
        ${q.warehouseId ? sql`AND t.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND t.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY w.code, t.code`);
    return rows.rows.map((r) => ({
      id: r.id,
      warehouseId: r.warehouse_id,
      warehouseCode: r.warehouse_code,
      code: r.code,
      name: r.name,
      seats: r.seats,
      isActive: r.is_active,
      openTab: r.tab_id ? { id: r.tab_id, number: r.tab_number, since: r.tab_since, items: r.items ?? 0, amount: D(r.amount ?? 0).toFixed(2) } : null,
    }));
  }

  async createTable(user: AuthUser, dto: CreateTableDto) {
    assertWarehouseAccess(user, dto.warehouseId);
    const [wh] = await this.db.select().from(warehouses).where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
    if (!wh) throw new BadRequestException('Outlet tidak ditemukan');
    const code = dto.code.trim().toUpperCase();
    const [dup] = await this.db.select({ id: posTables.id }).from(posTables).where(and(eq(posTables.warehouseId, wh.id), eq(posTables.code, code)));
    if (dup) throw new BadRequestException(`Kode meja ${code} sudah dipakai di outlet ini`);
    const [row] = await this.db.insert(posTables).values({ tenantId: user.tenantId, warehouseId: wh.id, code, name: dto.name.trim(), seats: dto.seats ?? null }).returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PosTable', entityId: row.id, data: { code, name: row.name } });
    return row;
  }

  async updateTable(user: AuthUser, id: string, dto: UpdateTableDto) {
    const [t] = await this.db.select().from(posTables).where(and(eq(posTables.id, id), eq(posTables.tenantId, user.tenantId)));
    if (!t) throw new NotFoundException('Meja tidak ditemukan');
    assertWarehouseAccess(user, t.warehouseId);
    if (dto.isActive === false) {
      const [open] = await this.db.select({ n: posTabs.number }).from(posTabs).where(and(eq(posTabs.tableId, id), eq(posTabs.status, 'OPEN')));
      if (open) throw new BadRequestException(`Meja masih punya pesanan terbuka (${open.n}); selesaikan dulu`);
    }
    const [row] = await this.db
      .update(posTables)
      .set({ name: dto.name?.trim(), seats: dto.seats, isActive: dto.isActive })
      .where(eq(posTables.id, id))
      .returning();
    return row;
  }

  // ================= Pesanan terbuka =================
  /** Kunci pesanan terbuka; hanya bisa diubah selagi OPEN */
  private async lockTab(tx: Tx, user: AuthUser, id: string, opts: { allowClosed?: boolean } = {}) {
    const lock = await tx.execute<{ id: string }>(sql`SELECT id FROM pos_tabs WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
    if (!lock.rows.length) throw new NotFoundException('Pesanan tidak ditemukan');
    const [tab] = await tx.select().from(posTabs).where(eq(posTabs.id, id));
    assertWarehouseAccess(user, tab.warehouseId);
    if (!opts.allowClosed && tab.status !== 'OPEN') throw new BadRequestException(`Pesanan ${tab.number} sudah ${tab.status === 'PAID' ? 'dibayar' : 'dibatalkan'}`);
    return tab;
  }

  async get(user: AuthUser, id: string) {
    const tab = await this.db.query.posTabs.findFirst({
      where: and(eq(posTabs.id, id), eq(posTabs.tenantId, user.tenantId)),
      with: {
        lines: { with: { product: { columns: { sku: true, name: true, sellPrice: true, madeToOrder: true, baseUom: true } } }, orderBy: [asc(posTabLines.createdAt), asc(posTabLines.id)] },
        table: { columns: { code: true, name: true } },
        warehouse: { columns: { code: true, name: true } },
      },
    });
    if (!tab) throw new NotFoundException('Pesanan tidak ditemukan');
    assertWarehouseAccess(user, tab.warehouseId);
    const live = tab.lines.filter((l) => l.status !== 'VOID');
    const sum = (ls: typeof live) => ls.reduce<Dec>((a, l) => a.plus(D(l.qty).times(l.product.sellPrice)), ZERO);
    return {
      ...tab,
      /** Perkiraan sebelum pajak (harga menu × jumlah); nilai pasti dihitung saat dibayar */
      unpaidSubtotal: sum(live.filter((l) => !l.paidOrderId)).toFixed(2),
      paidSubtotal: sum(live.filter((l) => !!l.paidOrderId)).toFixed(2),
      draftCount: live.filter((l) => l.status === 'DRAFT').length,
    };
  }

  async list(user: AuthUser, q: TabQueryDto) {
    if (q.warehouseId) assertWarehouseAccess(user, q.warehouseId);
    const allowed = allowedWarehouses(user);
    const rows = await this.db.query.posTabs.findMany({
      where: and(
        eq(posTabs.tenantId, user.tenantId),
        eq(posTabs.status, q.status ?? 'OPEN'),
        q.warehouseId ? eq(posTabs.warehouseId, q.warehouseId) : allowed ? inArray(posTabs.warehouseId, allowed) : undefined,
      ),
      with: { lines: { with: { product: { columns: { name: true, sellPrice: true } } } }, table: { columns: { code: true, name: true } } },
      orderBy: [asc(posTabs.createdAt)],
      limit: 200,
    });
    return rows.map((t) => {
      const live = t.lines.filter((l) => l.status !== 'VOID' && !l.paidOrderId);
      return {
        id: t.id,
        number: t.number,
        status: t.status,
        warehouseId: t.warehouseId,
        tableLabel: t.tableLabel,
        orderType: t.orderType,
        guestName: t.guestName,
        createdAt: t.createdAt,
        items: live.length,
        unpaidSubtotal: live.reduce<Dec>((a, l) => a.plus(D(l.qty).times(l.product.sellPrice)), ZERO).toFixed(2),
        pending: live.filter((l) => ['DRAFT', 'NEW', 'PREPARING', 'READY'].includes(l.status)).length,
      };
    });
  }

  /** Produk yang boleh dipesan: aktif, milik perusahaan, bukan barang setengah jadi */
  private async checkProducts(tx: Tx, tenantId: string, lines: TabLineInputDto[]) {
    const ids = [...new Set(lines.map((l) => l.productId))];
    const found = await tx.select({ id: products.id, sku: products.sku, isActive: products.isActive, kind: products.inventoryKind }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
    const byId = new Map(found.map((p) => [p.id, p]));
    for (const l of lines) {
      const p = byId.get(l.productId);
      if (!p || !p.isActive) throw new BadRequestException('Ada menu yang tidak ditemukan atau sudah nonaktif');
      if (p.kind === 'SEMI') throw new BadRequestException(`${p.sku} adalah barang setengah jadi dan tidak dijual`);
      const q = D(l.qty);
      if (q.lte(0) || q.gt(MAX_QTY)) throw new BadRequestException(`Jumlah ${p.sku} harus lebih dari 0 dan paling banyak 9999`);
      if (!q.eq(qty4(q))) throw new BadRequestException(`Jumlah ${p.sku} maksimal 4 desimal`);
    }
  }

  private async insertLines(tx: Tx, tabId: string, lines: TabLineInputDto[]) {
    if (!lines.length) return;
    await tx.insert(posTabLines).values(lines.map((l) => ({ tabId, productId: l.productId, qty: qty4(l.qty).toFixed(4), notes: l.notes?.trim() || null })));
  }

  async create(user: AuthUser, dto: CreateTabDto) {
    assertWarehouseAccess(user, dto.warehouseId);
    const id = await this.db.transaction(async (tx) => {
      const [wh] = await tx.select().from(warehouses).where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh || !wh.isActive) throw new BadRequestException('Outlet tidak ditemukan atau nonaktif');
      const orderType: PosOrderType = dto.orderType ?? 'DINE_IN';
      let label = dto.tableLabel?.trim() || null;
      if (dto.tableId) {
        const [t] = await tx.select().from(posTables).where(and(eq(posTables.id, dto.tableId), eq(posTables.tenantId, user.tenantId)));
        if (!t || !t.isActive || t.warehouseId !== wh.id) throw new BadRequestException('Meja tidak ditemukan di outlet ini');
        label = t.name;
      } else if (orderType === 'DINE_IN' && !label) {
        throw new BadRequestException('Pilih meja atau isi nama pemesan untuk pesanan makan di tempat');
      }
      if (dto.lines?.length) await this.checkProducts(tx, user.tenantId, dto.lines);
      const number = await this.seq.next(tx, user.tenantId, 'POS_TAB', todayJakarta());
      let tab: typeof posTabs.$inferSelect;
      try {
        [tab] = await tx
          .insert(posTabs)
          .values({ tenantId: user.tenantId, number, warehouseId: wh.id, tableId: dto.tableId ?? null, tableLabel: label, orderType, guestName: dto.guestName?.trim() || null, notes: dto.notes?.trim() || null, createdById: user.sub })
          .returning();
      } catch (e) {
        if (String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === '23505') throw new BadRequestException('Meja ini sudah punya pesanan terbuka. Tambah menu ke pesanan itu atau bayar dulu.');
        throw e;
      }
      await this.insertLines(tx, tab.id, dto.lines ?? []);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PosTab', entityId: tab.id, data: { number, table: label, orderType } });
      return tab.id;
    });
    return this.get(user, id);
  }

  async addLines(user: AuthUser, id: string, dto: AddTabLinesDto) {
    await this.db.transaction(async (tx) => {
      await this.lockTab(tx, user, id);
      await this.checkProducts(tx, user.tenantId, dto.lines);
      await this.insertLines(tx, id, dto.lines);
    });
    return this.get(user, id);
  }

  /** Cek stok untuk menu yang akan dimasak: kebutuhan bahan (resep) atau stok barang, ditambah pesanan lain yang sudah dikirim tetapi belum dibayar */
  private async assertAvailable(tx: Tx, tenantId: string, warehouseId: string, sending: { productId: string; qty: Dec }[]) {
    const outstanding = await tx
      .select({ productId: posTabLines.productId, qty: posTabLines.qty })
      .from(posTabLines)
      .innerJoin(posTabs, eq(posTabs.id, posTabLines.tabId))
      .where(and(eq(posTabs.tenantId, tenantId), eq(posTabs.warehouseId, warehouseId), eq(posTabs.status, 'OPEN'), inArray(posTabLines.status, ['NEW', 'PREPARING', 'READY', 'SERVED']), sql`${posTabLines.paidOrderId} IS NULL`));
    const all = [...outstanding.map((o) => ({ productId: o.productId, qty: D(o.qty) })), ...sending];
    const prods = await tx.select({ id: products.id, sku: products.sku, madeToOrder: products.madeToOrder }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(all.map((a) => a.productId))])));
    const menu = prods.filter((p) => p.madeToOrder);
    const recipes = await recipesFor(tx, tenantId, menu);
    const need = new Map<string, Dec>();
    const add = (pid: string, q: Dec) => need.set(pid, (need.get(pid) ?? ZERO).plus(q));
    for (const a of all) {
      const rec = recipes.get(a.productId);
      if (rec) for (const n of componentNeeds(rec, a.qty)) add(n.productId, n.qty);
      else add(a.productId, a.qty);
    }
    if (!need.size) return;
    const bal = await tx
      .select({ productId: stockBalances.productId, qty: stockBalances.qty })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.productId, [...need.keys()])));
    const have = new Map(bal.map((b) => [b.productId, D(b.qty)]));
    const names = await tx.select({ id: products.id, sku: products.sku, name: products.name }).from(products).where(inArray(products.id, [...need.keys()]));
    for (const [pid, q] of need) {
      const h = have.get(pid) ?? ZERO;
      if (h.lt(q)) {
        const p = names.find((n) => n.id === pid);
        throw new BadRequestException(`Stok ${p?.sku} ${p?.name} tidak cukup untuk pesanan ini: tersedia ${h.toString()}, dibutuhkan ${q.toString()} (termasuk pesanan terbuka lain)`);
      }
    }
  }

  /** Kirim pesanan baru ke dapur: menu masuk antrean, barang biasa (mis. air kemasan) langsung dianggap disajikan */
  async send(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, user, id);
      const drafts = await tx.select().from(posTabLines).where(and(eq(posTabLines.tabId, id), eq(posTabLines.status, 'DRAFT')));
      if (!drafts.length) throw new BadRequestException('Tidak ada pesanan baru untuk dikirim');
      await this.assertAvailable(tx, user.tenantId, tab.warehouseId, drafts.map((d) => ({ productId: d.productId, qty: D(d.qty) })));
      const menuIds = new Set(
        (await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, [...new Set(drafts.map((d) => d.productId))]), eq(products.madeToOrder, true)))).map((p) => p.id),
      );
      const now = new Date();
      for (const d of drafts) {
        const kitchen = menuIds.has(d.productId);
        await tx
          .update(posTabLines)
          .set(kitchen ? { status: 'NEW', sentAt: now } : { status: 'SERVED', sentAt: now, servedAt: now })
          .where(eq(posTabLines.id, d.id));
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'SEND', entity: 'PosTab', entityId: id, data: { number: tab.number, lines: drafts.length } });
    });
    return this.get(user, id);
  }

  async voidLine(user: AuthUser, id: string, lineId: string, dto: VoidTabLineDto) {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, user, id);
      const [line] = await tx.select().from(posTabLines).where(and(eq(posTabLines.id, lineId), eq(posTabLines.tabId, id)));
      if (!line) throw new NotFoundException('Baris pesanan tidak ditemukan');
      if (line.status === 'VOID') throw new BadRequestException('Baris ini sudah dibatalkan');
      if (line.paidOrderId) throw new BadRequestException('Baris ini sudah dibayar. Koreksi lewat retur kasir pada transaksinya.');
      const reason = dto.reason?.trim() ?? '';
      if (line.status === 'DRAFT') {
        await tx.delete(posTabLines).where(eq(posTabLines.id, lineId)); // belum dikirim: dihapus begitu saja
        return;
      }
      if (reason.length < 5) throw new BadRequestException('Alasan pembatalan wajib diisi (minimal 5 karakter)');
      if (line.status !== 'NEW' && !isSupervisor(user)) {
        throw new ForbiddenException('Menu yang sudah dimasak atau disajikan hanya bisa dibatalkan oleh supervisor (Pemilik, Admin, atau Keuangan)');
      }
      await tx
        .update(posTabLines)
        .set({ status: 'VOID', voidReason: reason, voidedById: user.sub, voidedAt: new Date(), voidFromStatus: line.status })
        .where(eq(posTabLines.id, lineId));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'VOID', entity: 'PosTabLine', entityId: lineId, data: { tab: tab.number, from: line.status, reason } });
      await this.closeIfDone(tx, tab.id);
    });
    return this.get(user, id);
  }

  /** Tutup pesanan bila tidak ada lagi baris aktif yang belum dibayar: PAID bila ada yang dibayar, selain itu CANCELLED */
  private async closeIfDone(tx: Tx, tabId: string) {
    const lines = await tx.select().from(posTabLines).where(eq(posTabLines.tabId, tabId));
    const pending = lines.filter((l) => l.status !== 'VOID' && !l.paidOrderId);
    if (pending.length) return;
    const paid = lines.some((l) => !!l.paidOrderId);
    await tx
      .update(posTabs)
      .set({ status: paid ? 'PAID' : 'CANCELLED', closedAt: new Date(), ...(paid ? {} : { cancelReason: 'Semua menu dibatalkan' }) })
      .where(eq(posTabs.id, tabId));
  }

  async cancel(user: AuthUser, id: string, dto: CancelTabDto) {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, user, id);
      const reason = dto.reason.trim();
      if (reason.length < 5) throw new BadRequestException('Alasan pembatalan wajib diisi (minimal 5 karakter)');
      const lines = await tx.select().from(posTabLines).where(eq(posTabLines.tabId, id));
      if (lines.some((l) => !!l.paidOrderId)) throw new BadRequestException('Sebagian pesanan sudah dibayar; tidak bisa dibatalkan seluruhnya. Batalkan barisnya satu per satu atau retur transaksinya.');
      const live = lines.filter((l) => l.status !== 'VOID');
      if (live.some((l) => ['PREPARING', 'READY', 'SERVED'].includes(l.status)) && !isSupervisor(user)) {
        throw new ForbiddenException('Pesanan yang sudah mulai dimasak atau disajikan hanya bisa dibatalkan oleh supervisor');
      }
      const now = new Date();
      for (const l of live) {
        if (l.status === 'DRAFT') await tx.delete(posTabLines).where(eq(posTabLines.id, l.id));
        else await tx.update(posTabLines).set({ status: 'VOID', voidReason: reason, voidedById: user.sub, voidedAt: now, voidFromStatus: l.status }).where(eq(posTabLines.id, l.id));
      }
      await tx.update(posTabs).set({ status: 'CANCELLED', closedAt: now, cancelReason: reason, cancelledById: user.sub }).where(eq(posTabs.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'PosTab', entityId: id, data: { number: tab.number, reason, lines: live.length } });
    });
    return this.get(user, id);
  }

  async move(user: AuthUser, id: string, dto: MoveTabDto) {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, user, id);
      let tableId: string | null = null;
      let label = dto.tableLabel?.trim() || null;
      if (dto.tableId) {
        const [t] = await tx.select().from(posTables).where(and(eq(posTables.id, dto.tableId), eq(posTables.tenantId, user.tenantId)));
        if (!t || !t.isActive || t.warehouseId !== tab.warehouseId) throw new BadRequestException('Meja tidak ditemukan di outlet ini');
        const [busy] = await tx.select({ n: posTabs.number }).from(posTabs).where(and(eq(posTabs.tableId, t.id), eq(posTabs.status, 'OPEN')));
        if (busy && busy.n !== tab.number) throw new BadRequestException(`Meja ${t.name} sedang dipakai pesanan ${busy.n}`);
        tableId = t.id;
        label = t.name;
      } else if (!label) {
        throw new BadRequestException('Pilih meja tujuan atau isi labelnya');
      }
      await tx.update(posTabs).set({ tableId, tableLabel: label }).where(eq(posTabs.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'MOVE', entity: 'PosTab', entityId: id, data: { number: tab.number, to: label } });
    });
    return this.get(user, id);
  }

  // ================= Pembayaran (juga sebagian) =================
  async pay(user: AuthUser, id: string, dto: PayTabDto) {
    const orderId = await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, user, id);
      const [session] = await tx.select().from(posSessions).where(and(eq(posSessions.id, dto.sessionId), eq(posSessions.tenantId, user.tenantId)));
      if (!session) throw new NotFoundException('Sesi kasir tidak ditemukan');
      if (session.warehouseId !== tab.warehouseId) throw new BadRequestException('Sesi kasir ini berada di outlet lain dari pesanan');
      const lines = await tx.select().from(posTabLines).where(eq(posTabLines.tabId, id));
      const payable = lines.filter((l) => l.status !== 'VOID' && !l.paidOrderId);
      let picks = payable;
      if (dto.lineIds?.length) {
        const want = new Set(dto.lineIds);
        if (want.size !== dto.lineIds.length) throw new BadRequestException('Baris yang sama dipilih lebih dari sekali');
        picks = payable.filter((l) => want.has(l.id));
        if (picks.length !== want.size) throw new BadRequestException('Ada baris yang tidak ada, sudah dibayar, atau sudah dibatalkan');
      }
      if (!picks.length) throw new BadRequestException('Tidak ada pesanan yang perlu dibayar');
      if (picks.some((l) => l.status === 'DRAFT')) throw new BadRequestException('Ada menu yang belum dikirim ke dapur. Kirim dulu sebelum dibayar.');
      const order = await this.pos.createOrderTx(
        tx,
        user,
        {
          sessionId: dto.sessionId,
          customerId: dto.customerId,
          orderType: tab.orderType,
          tableLabel: tab.tableLabel ?? undefined,
          lines: picks.map((l) => ({ productId: l.productId, qty: D(l.qty).toString() })),
          payments: dto.payments,
        } as CreatePosOrderDto,
        { tabId: id },
      );
      await tx.update(posTabLines).set({ paidOrderId: order }).where(inArray(posTabLines.id, picks.map((l) => l.id)));
      await this.closeIfDone(tx, id);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'PAY', entity: 'PosTab', entityId: id, data: { number: tab.number, order, lines: picks.length } });
      return order;
    });
    return this.pos.getOrder(user.tenantId, orderId);
  }

  // ================= Dapur =================
  async setLineStatus(user: AuthUser, lineId: string, status: 'PREPARING' | 'READY' | 'SERVED') {
    await this.db.transaction(async (tx) => {
      const found = await tx.execute<{ tab_id: string }>(sql`
        SELECT l.tab_id FROM pos_tab_lines l JOIN pos_tabs t ON t.id = l.tab_id WHERE l.id = ${lineId} AND t.tenant_id = ${user.tenantId}`);
      if (!found.rows.length) throw new NotFoundException('Baris pesanan tidak ditemukan');
      await this.lockTab(tx, user, found.rows[0].tab_id, { allowClosed: true });
      const [line] = await tx.select().from(posTabLines).where(eq(posTabLines.id, lineId));
      if (!KITCHEN_FLOW[line.status]) throw new BadRequestException(line.status === 'VOID' ? 'Menu ini sudah dibatalkan' : 'Menu ini belum dikirim ke dapur');
      if (KITCHEN_FLOW[status] <= KITCHEN_FLOW[line.status]) throw new BadRequestException('Status hanya bisa maju: baru → dimasak → siap → disajikan');
      const now = new Date();
      await tx
        .update(posTabLines)
        .set({
          status,
          preparedAt: line.preparedAt ?? now,
          ...(status === 'READY' || status === 'SERVED' ? { readyAt: line.readyAt ?? now } : {}),
          ...(status === 'SERVED' ? { servedAt: now } : {}),
        })
        .where(eq(posTabLines.id, lineId));
    });
    return { ok: true, status };
  }

  /** Antrean dapur: menu yang belum disajikan, dikelompokkan per pesanan, yang paling lama di atas */
  async kitchen(user: AuthUser, q: WarehouseQueryDto) {
    if (q.warehouseId) assertWarehouseAccess(user, q.warehouseId);
    const allowed = allowedWarehouses(user);
    const rows = await this.db.execute<{
      line_id: string; tab_id: string; number: string; table_label: string | null; order_type: string; guest_name: string | null; warehouse_id: string;
      product: string; sku: string; qty: string; notes: string | null; status: PosTabLineStatus; sent_at: string; paid: boolean;
    }>(sql`
      SELECT l.id AS line_id, t.id AS tab_id, t.number, t.table_label, t.order_type, t.guest_name, t.warehouse_id,
             p.name AS product, p.sku, l.qty, l.notes, l.status, l.sent_at::text AS sent_at, (l.paid_order_id IS NOT NULL) AS paid
      FROM pos_tab_lines l
      JOIN pos_tabs t ON t.id = l.tab_id
      JOIN products p ON p.id = l.product_id
      WHERE t.tenant_id = ${user.tenantId} AND t.status IN ('OPEN', 'PAID') AND l.status IN ('NEW', 'PREPARING', 'READY')
        ${q.warehouseId ? sql`AND t.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND t.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY l.sent_at, l.id`);
    const now = Date.now();
    const tickets = new Map<string, { tabId: string; number: string; tableLabel: string | null; orderType: string; guestName: string | null; since: string; waitingMinutes: number; items: unknown[] }>();
    for (const r of rows.rows) {
      const t = tickets.get(r.tab_id) ?? { tabId: r.tab_id, number: r.number, tableLabel: r.table_label, orderType: r.order_type, guestName: r.guest_name, since: r.sent_at, waitingMinutes: Math.max(0, Math.round((now - Date.parse(r.sent_at)) / 60000)), items: [] };
      t.items.push({ id: r.line_id, product: r.product, sku: r.sku, qty: r.qty, notes: r.notes, status: r.status, paid: r.paid });
      tickets.set(r.tab_id, t);
    }
    const count = (s: PosTabLineStatus) => rows.rows.filter((r) => r.status === s).length;
    return { tickets: [...tickets.values()], summary: { NEW: count('NEW'), PREPARING: count('PREPARING'), READY: count('READY') } };
  }
}

@ApiTags('Meja & dapur')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('CASHIER', 'SALES', 'FINANCE', 'ADMIN')
@Controller('pos')
export class PosTabsController {
  constructor(private readonly svc: PosTabsService) {}

  @Get('tables')
  tables(@CurrentUser() u: AuthUser, @Query() q: WarehouseQueryDto) {
    return this.svc.listTables(u, q);
  }
  @Post('tables')
  @Roles('ADMIN')
  createTable(@CurrentUser() u: AuthUser, @Body() dto: CreateTableDto) {
    return this.svc.createTable(u, dto);
  }
  @Patch('tables/:id')
  @Roles('ADMIN')
  updateTable(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.svc.updateTable(u, id, dto);
  }

  @Get('tabs')
  tabs(@CurrentUser() u: AuthUser, @Query() q: TabQueryDto) {
    return this.svc.list(u, q);
  }
  @Post('tabs')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTabDto) {
    return this.svc.create(u, dto);
  }
  @Get('tabs/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Post('tabs/:id/lines')
  addLines(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTabLinesDto) {
    return this.svc.addLines(u, id, dto);
  }
  @Post('tabs/:id/send')
  send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.send(u, id);
  }
  @Post('tabs/:id/lines/:lineId/void')
  voidLine(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: VoidTabLineDto) {
    return this.svc.voidLine(u, id, lineId, dto);
  }
  @Post('tabs/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTabDto) {
    return this.svc.cancel(u, id, dto);
  }
  @Patch('tabs/:id/move')
  move(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveTabDto) {
    return this.svc.move(u, id, dto);
  }
  @Post('tabs/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayTabDto) {
    return this.svc.pay(u, id, dto);
  }

  @Get('kitchen')
  kitchen(@CurrentUser() u: AuthUser, @Query() q: WarehouseQueryDto) {
    return this.svc.kitchen(u, q);
  }
  @Post('kitchen/lines/:lineId/status')
  status(@CurrentUser() u: AuthUser, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: KitchenStatusDto) {
    return this.svc.setLineStatus(u, lineId, dto.status);
  }
}

@Module({ imports: [PosModule], controllers: [PosTabsController], providers: [PosTabsService] })
export class PosTabsModule {}
