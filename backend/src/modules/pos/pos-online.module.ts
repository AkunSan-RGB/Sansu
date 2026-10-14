/**
 * Pesanan online (pesan-antar) untuk kafe/restoran:
 *  - Pesanan dari GoFood/GrabFood/ShopeeFood/website dicatat sebagai pesanan terbuka berkanal (manual oleh kasir, atau diterima otomatis
 *    lewat kunci API dari aplikasi pihak ketiga/integrator). Langsung masuk antrean dapur.
 *  - Saat selesai, penjualan dijurnal sebagai piutang platform (penjualan − komisi) dan komisi menjadi beban; stok/HPP/pajak seperti biasa.
 *  - Pencairan: dana dari platform dicocokkan dengan sekumpulan pesanan; selisih dicatat ke akun komisi dengan alasan.
 * SANSU tidak memanggil API resmi platform (itu butuh kemitraan dan kredensial dari platform); endpoint penerima pesanan disediakan agar
 * integrator atau aplikasi pesanan Anda bisa mengirim pesanan ke sini.
 */
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_PLATFORM_COMMISSIONS, ONLINE_CHANNEL_LABELS, ONLINE_CHANNELS, type OnlineChannel } from '@sansu/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppsService } from '../../common/apps/apps.service';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { onlineApiKeys, posOrders, posPlatformSettlements, warehouses } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { AccountingModule } from '../accounting/accounting.module';
import { PosTabsModule, PosTabsService } from './pos-tabs.module';

const hash = (k: string) => createHash('sha256').update(k).digest('hex');

// ---------- DTO ----------
export class CreateApiKeyDto {
  @ApiProperty({ example: 'Aplikasi pesanan GoFood' }) @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiProperty({ description: 'Outlet tujuan pesanan yang masuk lewat kunci ini' }) @IsUUID() warehouseId: string;
}
export class CommissionsDto {
  @ApiProperty({ example: { GOFOOD: 20, GRABFOOD: 20 }, description: 'Komisi (% dari harga menu sebelum pajak) per kanal, 0–50' })
  @IsObject()
  commissions: Record<string, number>;
}
export class InboundItemDto {
  @ApiProperty({ example: 'MN-KOPSU' }) @IsString() @MinLength(1) @MaxLength(40) sku: string;
  @ApiProperty({ example: '2' }) @IsNumberString() qty: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
export class InboundOrderDto {
  @ApiProperty({ enum: ONLINE_CHANNELS }) @IsIn(ONLINE_CHANNELS) channel: OnlineChannel;
  @ApiProperty({ example: 'GF-123456', description: 'Nomor pesanan di platform; mengirim ulang nomor yang sama tidak membuat pesanan ganda' }) @IsString() @MinLength(1) @MaxLength(60) externalRef: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @ApiProperty({ type: [InboundItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InboundItemDto) items: InboundItemDto[];
}
export class UnsettledQueryDto {
  @ApiPropertyOptional({ enum: ONLINE_CHANNELS }) @IsOptional() @IsIn(ONLINE_CHANNELS) channel?: OnlineChannel;
}
export class CreateSettlementDto {
  @ApiProperty({ enum: ONLINE_CHANNELS }) @IsIn(ONLINE_CHANNELS) channel: OnlineChannel;
  @ApiPropertyOptional({ example: '2026-10-14' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Rekening bank penerima; kosong = Bank' }) @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) orderIds: string[];
  @ApiProperty({ example: '1250000', description: 'Dana yang benar-benar masuk dari platform' }) @IsNumberString() received: string;
  @ApiPropertyOptional({ description: 'Wajib (min. 5 karakter) bila dana yang masuk berbeda dari seharusnya' }) @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

// ---------- Pengaturan komisi ----------
@Injectable()
export class OnlineSettingsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async commissions(tenantId: string): Promise<Record<OnlineChannel, number>> {
    const s = await this.settings.section(this.db, tenantId, 'platforms', { commissions: {} as Record<string, number> });
    return Object.fromEntries(ONLINE_CHANNELS.map((c) => [c, Number.isFinite(Number(s.commissions?.[c])) ? Number(s.commissions[c]) : DEFAULT_PLATFORM_COMMISSIONS[c]])) as Record<OnlineChannel, number>;
  }

  async saveCommissions(user: AuthUser, dto: CommissionsDto) {
    const patch: Record<string, number> = {};
    for (const [k, v] of Object.entries(dto.commissions)) {
      if (!(ONLINE_CHANNELS as readonly string[]).includes(k)) throw new BadRequestException(`Kanal tidak dikenal: ${k}`);
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 50) throw new BadRequestException(`Komisi ${ONLINE_CHANNEL_LABELS[k as OnlineChannel]} harus 0–50 persen`);
      patch[k] = Math.round(n * 100) / 100;
    }
    const before = await this.commissions(user.tenantId);
    const merged = { ...before, ...patch };
    await this.settings.saveSection(this.db, user.tenantId, 'platforms', { commissions: {} as Record<string, number> }, { commissions: merged });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'PlatformCommissions', entityId: user.tenantId, data: { before, after: merged } });
    return merged;
  }
}

// ---------- Kunci API ----------
@Injectable()
export class OnlineKeysService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db
      .select({ id: onlineApiKeys.id, name: onlineApiKeys.name, keyPrefix: onlineApiKeys.keyPrefix, warehouseId: onlineApiKeys.warehouseId, createdAt: onlineApiKeys.createdAt, lastUsedAt: onlineApiKeys.lastUsedAt, revokedAt: onlineApiKeys.revokedAt })
      .from(onlineApiKeys)
      .where(eq(onlineApiKeys.tenantId, tenantId))
      .orderBy(desc(onlineApiKeys.createdAt));
  }

  /** Kunci hanya ditampilkan sekali saat dibuat; yang tersimpan hanya hash-nya */
  async create(user: AuthUser, dto: CreateApiKeyDto) {
    assertWarehouseAccess(user, dto.warehouseId);
    const [wh] = await this.db.select().from(warehouses).where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
    if (!wh || !wh.isActive) throw new BadRequestException('Outlet tidak ditemukan atau nonaktif');
    const key = `snk_${randomBytes(24).toString('base64url')}`;
    const [row] = await this.db
      .insert(onlineApiKeys)
      .values({ tenantId: user.tenantId, name: dto.name.trim(), keyHash: hash(key), keyPrefix: key.slice(0, 8), warehouseId: wh.id, createdById: user.sub })
      .returning({ id: onlineApiKeys.id, name: onlineApiKeys.name, keyPrefix: onlineApiKeys.keyPrefix });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'OnlineApiKey', entityId: row.id, data: { name: row.name, prefix: row.keyPrefix } });
    return { ...row, key, warning: 'Simpan kunci ini sekarang. Kunci tidak bisa ditampilkan lagi.' };
  }

  async revoke(user: AuthUser, id: string) {
    const [row] = await this.db
      .update(onlineApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(onlineApiKeys.id, id), eq(onlineApiKeys.tenantId, user.tenantId), isNull(onlineApiKeys.revokedAt)))
      .returning({ id: onlineApiKeys.id, name: onlineApiKeys.name });
    if (!row) throw new NotFoundException('Kunci tidak ditemukan atau sudah dicabut');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'REVOKE', entity: 'OnlineApiKey', entityId: id, data: { name: row.name } });
    return { ok: true };
  }
}

/** Menyahkan kunci API di header X-Api-Key menjadi pengguna sistem perusahaan itu (sebelum penyaringan perusahaan database berjalan) */
@Injectable()
export class OnlineKeyGuard implements CanActivate {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly apps: AppsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser & { onlineWarehouseId?: string } }>();
    const raw = req.headers['x-api-key'];
    if (!raw || typeof raw !== 'string' || raw.length < 20 || raw.length > 120) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    const [k] = await this.db.select().from(onlineApiKeys).where(eq(onlineApiKeys.keyHash, hash(raw)));
    if (!k || k.revokedAt) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    if (!(await this.apps.isEnabled(k.tenantId, ['pos']))) throw new HttpException('Aplikasi Kasir belum diaktifkan di perusahaan ini', HttpStatus.FORBIDDEN);
    if ((await this.subs.state(k.tenantId)).readOnly) throw new HttpException('Langganan perusahaan tidak aktif', HttpStatus.PAYMENT_REQUIRED);
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await this.db.update(onlineApiKeys).set({ lastUsedAt: new Date() }).where(eq(onlineApiKeys.id, k.id));
    req.user = { sub: k.createdById, tenantId: k.tenantId, role: 'CASHIER', email: `kunci-api:${k.keyPrefix}`, emailVerified: true, warehouseIds: [k.warehouseId], onlineWarehouseId: k.warehouseId };
    return true;
  }
}

// ---------- Pencairan platform ----------
@Injectable()
export class PlatformSettlementsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  /** Pesanan online yang sudah dibayar platform (piutang) tetapi dananya belum dicairkan */
  async unsettled(tenantId: string, channel?: OnlineChannel) {
    const rows = await this.db
      .select()
      .from(posOrders)
      .where(and(eq(posOrders.tenantId, tenantId), isNull(posOrders.settlementId), channel ? eq(posOrders.channel, channel) : sql`${posOrders.channel} IS NOT NULL`))
      .orderBy(posOrders.date, posOrders.number)
      .limit(1000);
    const items = rows.map((o) => ({ id: o.id, number: o.number, date: o.date, channel: o.channel!, externalRef: o.externalRef, total: o.total, platformFee: o.platformFee, net: D(o.total).minus(o.platformFee).toFixed(2) }));
    return { items, totals: { count: items.length, total: items.reduce<Dec>((a, i) => a.plus(i.total), ZERO).toFixed(2), fee: items.reduce<Dec>((a, i) => a.plus(i.platformFee), ZERO).toFixed(2), net: items.reduce<Dec>((a, i) => a.plus(i.net), ZERO).toFixed(2) } };
  }

  list(tenantId: string) {
    return this.db.select().from(posPlatformSettlements).where(eq(posPlatformSettlements.tenantId, tenantId)).orderBy(desc(posPlatformSettlements.date), desc(posPlatformSettlements.number)).limit(200);
  }

  async create(user: AuthUser, dto: CreateSettlementDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(dto.orderIds)];
      if (ids.length !== dto.orderIds.length) throw new BadRequestException('Pesanan yang sama dipilih lebih dari sekali');
      // kunci pesanan agar tidak dicairkan dua kali oleh permintaan bersamaan
      await tx.execute(sql`SELECT id FROM pos_orders WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND tenant_id = ${user.tenantId} FOR UPDATE`);
      const orders = await tx.select().from(posOrders).where(and(eq(posOrders.tenantId, user.tenantId), inArray(posOrders.id, ids)));
      if (orders.length !== ids.length) throw new BadRequestException('Ada pesanan yang tidak ditemukan');
      if (orders.some((o) => o.channel !== dto.channel)) throw new BadRequestException(`Semua pesanan harus dari kanal ${ONLINE_CHANNEL_LABELS[dto.channel]}`);
      const done = orders.find((o) => o.settlementId);
      if (done) throw new BadRequestException(`Pesanan ${done.number} sudah dicairkan`);
      if (orders.some((o) => o.date > date)) throw new BadRequestException('Tanggal pencairan tidak boleh sebelum tanggal pesanan');
      const expected = orders.reduce<Dec>((a, o) => a.plus(D(o.total).minus(o.platformFee)), ZERO);
      const received = money(dto.received);
      if (received.lte(0)) throw new BadRequestException('Dana yang masuk harus lebih dari nol');
      const diff = received.minus(expected);
      if (!diff.isZero() && (dto.notes?.trim().length ?? 0) < 5) throw new BadRequestException(`Dana yang masuk berbeda ${diff.abs().toFixed(0)} dari seharusnya (${expected.toFixed(0)}). Jelaskan alasannya pada catatan (minimal 5 karakter).`);
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.bankAccountId, 'BANK');
      const number = await this.seq.next(tx, user.tenantId, 'PLATFORM_SETTLEMENT', date);
      const [row] = await tx
        .insert(posPlatformSettlements)
        .values({ tenantId: user.tenantId, number, channel: dto.channel, date, bankAccountId: bank.id, orderCount: orders.length, expected: expected.toFixed(2), received: received.toFixed(2), difference: diff.toFixed(2), notes: dto.notes?.trim() || null, createdById: user.sub })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pencairan ${ONLINE_CHANNEL_LABELS[dto.channel]} ${number} (${orders.length} pesanan)`,
        sourceType: 'PLATFORM_SETTLEMENT',
        sourceId: row.id,
        createdById: user.sub,
        lines: [
          { accountId: bank.id, debit: received },
          { key: SYS.PLATFORM_RECEIVABLE, credit: expected },
          // selisih: kurang dari seharusnya = tambahan potongan (beban), lebih = pengurang beban
          { key: SYS.PLATFORM_FEE, debit: diff.isNegative() ? diff.abs() : 0, credit: diff.isPositive() ? diff : 0 },
        ],
      });
      await tx.update(posPlatformSettlements).set({ journalId: journal.id }).where(eq(posPlatformSettlements.id, row.id));
      await tx.update(posOrders).set({ settlementId: row.id }).where(inArray(posOrders.id, ids));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PlatformSettlement', entityId: row.id, data: { number, channel: dto.channel, orders: orders.length, expected: expected.toFixed(2), received: received.toFixed(2) } });
      return { ...row, journalId: journal.id, journalNumber: journal.number };
    });
  }

  /** Batalkan pencairan yang salah input: jurnal dibalik, pesanan kembali belum dicairkan */
  async cancel(user: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute(sql`SELECT id FROM pos_platform_settlements WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!lock.rows.length) throw new NotFoundException('Pencairan tidak ditemukan');
      const [row] = await tx.select().from(posPlatformSettlements).where(eq(posPlatformSettlements.id, id));
      if (row.status === 'CANCELLED') throw new BadRequestException('Pencairan sudah dibatalkan');
      if (row.journalId) await this.posting.reverse(tx, user.tenantId, row.journalId, toDocDate(undefined) < row.date ? row.date : toDocDate(undefined), user.sub, true);
      await tx.update(posOrders).set({ settlementId: null }).where(eq(posOrders.settlementId, id));
      await tx.update(posPlatformSettlements).set({ status: 'CANCELLED' }).where(eq(posPlatformSettlements.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'PlatformSettlement', entityId: id, data: { number: row.number } });
      return { ok: true };
    });
  }
}

// ---------- Controller ----------
@ApiTags('Pesanan online')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('ADMIN', 'FINANCE')
@Controller('pos/online')
export class PosOnlineController {
  constructor(
    private readonly keys: OnlineKeysService,
    private readonly settings: OnlineSettingsService,
    private readonly settlements: PlatformSettlementsService,
  ) {}

  @Get('settings')
  @Roles('ADMIN', 'FINANCE', 'CASHIER', 'ACCOUNTANT')
  async getSettings(@CurrentUser() u: AuthUser) {
    return { commissions: await this.settings.commissions(u.tenantId) };
  }
  @Patch('settings')
  async saveSettings(@CurrentUser() u: AuthUser, @Body() dto: CommissionsDto) {
    return { commissions: await this.settings.saveCommissions(u, dto) };
  }

  @Get('keys')
  listKeys(@CurrentUser() u: AuthUser) {
    return this.keys.list(u.tenantId);
  }
  @Post('keys')
  @Roles('ADMIN')
  createKey(@CurrentUser() u: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(u, dto);
  }
  @Post('keys/:id/revoke')
  @Roles('ADMIN')
  revokeKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(u, id);
  }

  @Get('unsettled')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  unsettled(@CurrentUser() u: AuthUser, @Query() q: UnsettledQueryDto) {
    return this.settlements.unsettled(u.tenantId, q.channel);
  }
  @Get('settlements')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  listSettlements(@CurrentUser() u: AuthUser) {
    return this.settlements.list(u.tenantId);
  }
  @Post('settlements')
  createSettlement(@CurrentUser() u: AuthUser, @Body() dto: CreateSettlementDto) {
    return this.settlements.create(u, dto);
  }
  @Post('settlements/:id/cancel')
  cancelSettlement(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settlements.cancel(u, id);
  }
}

/** Penerima pesanan online dari luar: tanpa login, memakai kunci API (header X-Api-Key) */
@ApiTags('Pesanan online')
@Public()
@UseGuards(OnlineKeyGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('online-orders')
export class InboundOrdersController {
  constructor(private readonly tabs: PosTabsService) {}

  @Post()
  async receive(@CurrentUser() u: AuthUser & { onlineWarehouseId: string }, @Body() dto: InboundOrderDto) {
    const r = await this.tabs.receiveOnline(u, u.onlineWarehouseId, dto);
    return { duplicate: r.duplicate, id: r.tab.id, number: r.tab.number, status: r.tab.status, lines: r.tab.lines.map((l) => ({ sku: l.product.sku, qty: l.qty, status: l.status })) };
  }

  /** Cek status pesanan yang pernah dikirim: antre/dimasak/siap/disajikan/dibayar */
  @Get(':channel/:externalRef')
  async status(@CurrentUser() u: AuthUser & { onlineWarehouseId: string }, @Param('channel') channel: string, @Param('externalRef') externalRef: string) {
    if (!(ONLINE_CHANNELS as readonly string[]).includes(channel)) throw new BadRequestException('Kanal tidak dikenal');
    return this.tabs.onlineStatus(u, channel as OnlineChannel, externalRef);
  }
}

@Module({
  imports: [AccountingModule, PosTabsModule],
  controllers: [PosOnlineController, InboundOrdersController],
  providers: [OnlineSettingsService, OnlineKeysService, PlatformSettlementsService, OnlineKeyGuard],
})
export class PosOnlineModule {}
