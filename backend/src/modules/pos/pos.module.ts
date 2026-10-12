import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { POS_PAYMENT_METHODS, type PosPaymentMethod } from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { outputVatRate, taxProfileOf } from '../../common/settings.service';
import { nowAt, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { customers, posOrderLines, posOrders, posPayments, posSessions, products, stockBalances, tenants, warehouses } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';
import { buildLines } from '../master-data/products/line-builder';
import { documentTotals, inclusiveTotals } from '../sales/pricing';

// ---------- DTO ----------
export class OpenSessionDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: 'Akun kas laci; kosong = Kas' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Rekening QRIS/debit/transfer; kosong = Bank' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiProperty({ example: '500000', description: 'Modal awal di laci' }) @IsNumberString() openingCash: string;
}

export class CloseSessionDto {
  @ApiProperty({ example: '2350000', description: 'Uang tunai dihitung di laci' }) @IsNumberString() countedCash: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

export class PosLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional({ description: 'Kosong = harga jual master' }) @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discountPct?: string;
}

export class PosPaymentDto {
  @ApiProperty({ enum: POS_PAYMENT_METHODS }) @IsIn(POS_PAYMENT_METHODS) method: PosPaymentMethod;
  @ApiProperty({ example: '100000', description: 'Uang diterima (tunai boleh lebih, kembalian dihitung)' }) @IsNumberString() amount: string;
}

export class CreatePosOrderDto {
  @ApiProperty() @IsUUID() sessionId: string;
  @ApiPropertyOptional({ description: 'Pelanggan terdaftar (opsional)' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiProperty({ type: [PosLineDto] }) @ValidateNested({ each: true }) @Type(() => PosLineDto) @ArrayMinSize(1) lines: PosLineDto[];
  @ApiProperty({ type: [PosPaymentDto] }) @ValidateNested({ each: true }) @Type(() => PosPaymentDto) @ArrayMinSize(1) payments: PosPaymentDto[];
}

export class PosProductQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ description: 'Nama / SKU / barcode' }) @IsOptional() @IsString() q?: string;
}

// ---------- Service ----------
@Injectable()
export class PosService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  /** Produk untuk layar kasir: harga, satuan, barcode, dan stok di gudang sesi */
  async products(tenantId: string, q: PosProductQueryDto) {
    const term = q.q?.trim();
    const rows = await this.db.query.products.findMany({
      where: and(
        eq(products.tenantId, tenantId),
        eq(products.isActive, true),
        term ? or(ilike(products.name, `%${term}%`), ilike(products.sku, `%${term}%`), eq(products.barcode, term)) : undefined,
      ),
      with: { uoms: true },
      orderBy: products.name,
      limit: 200,
    });
    const stock = q.warehouseId
      ? await this.db
          .select({ productId: stockBalances.productId, qty: stockBalances.qty })
          .from(stockBalances)
          .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, q.warehouseId)))
      : [];
    const byId = new Map(stock.map((s) => [s.productId, s.qty]));
    return rows.map((p) => ({ ...p, stock: byId.get(p.id) ?? '0' }));
  }

  /** Sesi terbuka milik kasir yang sedang login */
  async current(user: AuthUser) {
    const s = await this.db.query.posSessions.findFirst({
      where: and(eq(posSessions.tenantId, user.tenantId), eq(posSessions.userId, user.sub), eq(posSessions.status, 'OPEN')),
      with: {
        warehouse: { columns: { id: true, code: true, name: true } },
        cashAccount: { columns: { id: true, code: true, name: true } },
        bankAccount: { columns: { id: true, code: true, name: true } },
      },
    });
    return s ? { ...s, summary: await this.summary(this.db, s.id, s.openingCash) } : null;
  }

  async open(user: AuthUser, dto: OpenSessionDto) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ number: posSessions.number })
        .from(posSessions)
        .where(and(eq(posSessions.userId, user.sub), eq(posSessions.status, 'OPEN')));
      if (existing) throw new BadRequestException(`Anda masih punya sesi kasir terbuka (${existing.number})`);
      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang / toko tidak ditemukan');
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'CASH');
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.bankAccountId, 'BANK');
      const opening = money(dto.openingCash);
      if (opening.isNegative()) throw new BadRequestException('Modal awal tidak boleh negatif');
      const today = todayJakarta();
      const number = await this.seq.next(tx, user.tenantId, 'POS_SESSION', today);
      const [s] = await tx
        .insert(posSessions)
        .values({
          tenantId: user.tenantId,
          number,
          userId: user.sub,
          warehouseId: wh.id,
          cashAccountId: cash.id,
          bankAccountId: bank.id,
          openingCash: opening.toFixed(2),
          openedAt: nowAt(8),
        })
        .returning();
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'OPEN', entity: 'PosSession', entityId: s.id });
      return s;
    });
  }

  /**
   * Penjualan kasir — satu transaksi:
   *  stok keluar (HPP rata-rata) · jurnal Dr Kas/Bank | Cr Penjualan, Cr PPN Keluaran · Dr HPP | Cr Persediaan
   */
  async createOrder(user: AuthUser, dto: CreatePosOrderDto) {
    const result = await this.db.transaction(async (tx) => {
      const session = await this.lockSession(tx, user, dto.sessionId);
      const date = todayJakarta();
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      if (dto.customerId) {
        const [c] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, user.tenantId)));
        if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
      }
      const lines = await buildLines(tx, user.tenantId, dto.lines, 'sell');
      // Harga rak termasuk PPN → DPP & PPN dihitung mundur; non-PKP → tanpa PPN
      const inclusive = taxProfileOf(tenant.settings).posPricesIncludeVat;
      const rate = outputVatRate(tenant);
      const totals = inclusive ? inclusiveTotals(lines, rate) : documentTotals(lines, rate, taxProfileOf(tenant.settings).vatRounding);

      // Pembayaran: non-tunai tidak boleh lebih dari tagihan; kelebihan tunai = kembalian
      let nonCash: Dec = ZERO;
      let cashIn: Dec = ZERO;
      for (const p of dto.payments) {
        const amt = money(p.amount);
        if (amt.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');
        if (p.method === 'CASH') cashIn = cashIn.plus(amt);
        else nonCash = nonCash.plus(amt);
      }
      if (nonCash.gt(totals.total)) throw new BadRequestException('Pembayaran non-tunai melebihi total belanja');
      const tendered = cashIn.plus(nonCash);
      if (tendered.lt(totals.total)) {
        throw new BadRequestException(`Pembayaran kurang ${totals.total.minus(tendered).toFixed(0)}`);
      }
      const change = tendered.minus(totals.total);
      const cashNet = cashIn.minus(change);

      const number = await this.seq.next(tx, user.tenantId, 'POS_ORDER', date);
      const [order] = await tx
        .insert(posOrders)
        .values({
          tenantId: user.tenantId,
          sessionId: session.id,
          number,
          date,
          customerId: dto.customerId,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
          tendered: tendered.toFixed(2),
          change: change.toFixed(2),
          pricesIncludeVat: inclusive,
        })
        .returning();

      let cogs: Dec = ZERO;
      for (const l of lines) {
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.productId,
          warehouseId: session.warehouseId,
          type: 'SALE',
          qty: D(l.qty).times(l.uomFactor).negated(),
          refType: 'POS_ORDER',
          refId: order.id,
          refNumber: number,
          date,
        });
        cogs = cogs.plus(moved.value);
        await tx.insert(posOrderLines).values({
          orderId: order.id,
          productId: l.productId,
          uom: l.uom,
          uomFactor: l.uomFactor,
          qty: l.qty,
          price: l.price.toFixed(2),
          discountPct: l.discountPct.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          unitCost: moved.unitCost.toFixed(4),
        });
      }
      cogs = money(cogs);

      // Gabungkan pembayaran per metode (tunai bersih setelah kembalian)
      const byMethod = new Map<PosPaymentMethod, Dec>();
      for (const p of dto.payments) if (p.method !== 'CASH') byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).plus(money(p.amount)));
      if (cashNet.gt(0)) byMethod.set('CASH', cashNet);
      await tx.insert(posPayments).values([...byMethod].map(([method, amount]) => ({ orderId: order.id, method, amount: amount.toFixed(2) })));

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Penjualan kasir ${number}`,
        sourceType: 'POS',
        sourceId: order.id,
        createdById: user.sub,
        lines: [
          { accountId: session.cashAccountId, debit: cashNet },
          { accountId: session.bankAccountId, debit: nonCash },
          { key: SYS.SALES, credit: totals.subtotal },
          { key: SYS.VAT_OUT, credit: totals.taxAmount },
          { key: SYS.COGS, debit: cogs },
          { key: SYS.INVENTORY, credit: cogs },
        ],
      });
      await tx.update(posOrders).set({ cogsAmount: cogs.toFixed(2), journalId: journal.id }).where(eq(posOrders.id, order.id));
      return order.id;
    });
    return this.getOrder(user.tenantId, result);
  }

  async getOrder(tenantId: string, id: string) {
    const o = await this.db.query.posOrders.findFirst({
      where: and(eq(posOrders.id, id), eq(posOrders.tenantId, tenantId)),
      with: {
        lines: { with: { product: { columns: { sku: true, name: true } } } },
        payments: true,
        customer: { columns: { code: true, name: true } },
        session: { columns: { number: true }, with: { user: { columns: { name: true } }, warehouse: { columns: { name: true, address: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Transaksi kasir tidak ditemukan');
    return o;
  }

  listOrders(tenantId: string, sessionId?: string) {
    return this.db.query.posOrders.findMany({
      where: and(eq(posOrders.tenantId, tenantId), sessionId ? eq(posOrders.sessionId, sessionId) : undefined),
      with: { payments: true, customer: { columns: { name: true } } },
      orderBy: desc(posOrders.createdAt),
      limit: 300,
    });
  }

  async listSessions(tenantId: string) {
    const rows = await this.db.query.posSessions.findMany({
      where: eq(posSessions.tenantId, tenantId),
      with: { user: { columns: { name: true } }, warehouse: { columns: { name: true } } },
      orderBy: desc(posSessions.openedAt),
      limit: 200,
    });
    const totals = await this.db.execute<{ session_id: string; n: number; total: string }>(sql`
      SELECT session_id, COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total
      FROM pos_orders WHERE tenant_id = ${tenantId} GROUP BY session_id`);
    const byId = new Map(totals.rows.map((t) => [t.session_id, t]));
    return rows.map((r) => ({ ...r, orderCount: byId.get(r.id)?.n ?? 0, totalSales: D(byId.get(r.id)?.total).toFixed(2) }));
  }

  /**
   * Tutup kasir: bandingkan uang di laci dengan seharusnya.
   * Selisih dijurnal ke "Selisih Kas Kasir" (kurang = beban, lebih = mengurangi beban).
   */
  async close(user: AuthUser, id: string, dto: CloseSessionDto) {
    return this.db.transaction(async (tx) => {
      const s = await this.lockSession(tx, user, id, true);
      const sum = await this.summary(tx, s.id, s.openingCash);
      const counted = money(dto.countedCash);
      if (counted.isNegative()) throw new BadRequestException('Jumlah uang tidak boleh negatif');
      const expected = D(sum.expectedCash);
      const diff = counted.minus(expected);
      const date = todayJakarta();
      let closeJournalId: string | undefined;
      let journalNumber: string | undefined;
      if (!diff.isZero()) {
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description: `Selisih kas tutup kasir ${s.number} (${diff.isNegative() ? 'kurang' : 'lebih'})`,
          sourceType: 'POS_CLOSE',
          sourceId: s.id,
          createdById: user.sub,
          lines: diff.isNegative()
            ? [
                { key: SYS.CASH_DIFF, debit: diff.abs() },
                { accountId: s.cashAccountId, credit: diff.abs() },
              ]
            : [
                { accountId: s.cashAccountId, debit: diff },
                { key: SYS.CASH_DIFF, credit: diff },
              ],
        });
        closeJournalId = j.id;
        journalNumber = j.number;
      }
      const [closed] = await tx
        .update(posSessions)
        .set({
          status: 'CLOSED',
          closedAt: nowAt(21),
          expectedCash: expected.toFixed(2),
          countedCash: counted.toFixed(2),
          difference: diff.toFixed(2),
          notes: dto.notes,
          closeJournalId,
        })
        .where(eq(posSessions.id, s.id))
        .returning();
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CLOSE', entity: 'PosSession', entityId: s.id, data: { diff: diff.toFixed(2) } });
      return { ...closed, summary: sum, journalNumber };
    });
  }

  /** Ringkasan sesi: total per metode & uang tunai yang seharusnya ada di laci */
  private async summary(db: Db | Tx, sessionId: string, openingCash: string) {
    const res = await db.execute<{ method: PosPaymentMethod; amount: string }>(sql`
      SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
      FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
      WHERE o.session_id = ${sessionId} GROUP BY p.method`);
    const [agg] = (
      await db.execute<{ n: number; total: string }>(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total FROM pos_orders WHERE session_id = ${sessionId}`)
    ).rows;
    const byMethod = Object.fromEntries(POS_PAYMENT_METHODS.map((m) => [m, '0.00'])) as Record<PosPaymentMethod, string>;
    res.rows.forEach((r) => (byMethod[r.method] = D(r.amount).toFixed(2)));
    return {
      orderCount: agg.n,
      totalSales: D(agg.total).toFixed(2),
      byMethod,
      expectedCash: D(openingCash).plus(byMethod.CASH).toFixed(2),
    };
  }

  private async lockSession(tx: Tx, user: AuthUser, id: string, forClose = false) {
    const res = await tx.execute<{ id: string }>(sql`
      SELECT id FROM pos_sessions WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
    if (!res.rows.length) throw new NotFoundException('Sesi kasir tidak ditemukan');
    const [s] = await tx.select().from(posSessions).where(eq(posSessions.id, id));
    if (s.status !== 'OPEN') throw new BadRequestException(`Sesi ${s.number} sudah ditutup`);
    const manager = user.role === 'OWNER' || user.role === 'ADMIN' || user.role === 'FINANCE';
    if (s.userId !== user.sub && !(forClose && manager)) {
      throw new ForbiddenException('Sesi ini milik kasir lain');
    }
    return s;
  }
}

// ---------- Controller ----------
@ApiTags('Kasir (POS)')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('CASHIER', 'SALES', 'FINANCE')
@Controller('pos')
export class PosController {
  constructor(private readonly svc: PosService) {}

  @Get('products')
  products(@CurrentUser() u: AuthUser, @Query() q: PosProductQueryDto) {
    return this.svc.products(u.tenantId, q);
  }

  @Get('sessions/current')
  current(@CurrentUser() u: AuthUser) {
    return this.svc.current(u);
  }

  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.svc.listSessions(u.tenantId);
  }

  @Post('sessions')
  open(@CurrentUser() u: AuthUser, @Body() dto: OpenSessionDto) {
    return this.svc.open(u, dto);
  }

  @Post('sessions/:id/close')
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseSessionDto) {
    return this.svc.close(u, id, dto);
  }

  @Get('orders')
  orders(@CurrentUser() u: AuthUser, @Query('sessionId') sessionId?: string) {
    return this.svc.listOrders(u.tenantId, sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : undefined);
  }

  @Get('orders/:id')
  order(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOrder(u.tenantId, id);
  }

  @Post('orders')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePosOrderDto) {
    return this.svc.createOrder(u, dto);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
