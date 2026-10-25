import { BadRequestException, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DEFAULT_PLATFORM_COMMISSIONS, ONLINE_CHANNEL_LABELS, ONLINE_CHANNELS, type OnlineChannel } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { onlineApiKeys, posPlatformSettlements } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { CommissionsDto, CreateApiKeyDto, CreateSettlementDto } from './pos-online.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { insertOne, patchById } from '../../db/owned';
import { PosOnlineRepository } from './pos-online.repository';

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

@Injectable()
export class OnlineKeysService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly refs: ReferenceRepository,
    private readonly repo: PosOnlineRepository,
  ) {}

  list(tenantId: string) {
    return this.repo.listOnlineApiKeysByCreatedAt(this.db, tenantId);
  }

  /** Kunci hanya ditampilkan sekali saat dibuat; yang tersimpan hanya hash-nya */
  async create(user: AuthUser, dto: CreateApiKeyDto) {
    assertWarehouseAccess(user, dto.warehouseId);
    const wh = await this.refs.warehouse(this.db, user.tenantId, dto.warehouseId);
    if (!wh || !wh.isActive) throw new BadRequestException('Outlet tidak ditemukan atau nonaktif');
    const key = `snk_${randomBytes(24).toString('base64url')}`;
    const [row] = await this.repo.insertOnlineApiKeys(this.db, user.tenantId, dto.name, key, wh.id, user.sub);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'OnlineApiKey', entityId: row.id, data: { name: row.name, prefix: row.keyPrefix } });
    return { ...row, key, warning: 'Simpan kunci ini sekarang. Kunci tidak bisa ditampilkan lagi.' };
  }

  async revoke(user: AuthUser, id: string) {
    const [row] = await this.repo.updateOnlineApiKeysByIdAndRevokedAtAndName(this.db, id, user.tenantId);
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
    private readonly repo: PosOnlineRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser & { onlineWarehouseId?: string } }>();
    const raw = req.headers['x-api-key'];
    if (!raw || typeof raw !== 'string' || raw.length < 20 || raw.length > 120) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    const [k] = await this.repo.findOnlineApiKeysByKeyHash(this.db, raw);
    if (!k || k.revokedAt) throw new UnauthorizedException('Kunci API tidak ada atau tidak valid');
    if (!(await this.apps.isEnabled(k.tenantId, ['pos']))) throw new HttpException('Aplikasi Kasir belum diaktifkan di perusahaan ini', HttpStatus.FORBIDDEN);
    if ((await this.subs.state(k.tenantId)).readOnly) throw new HttpException('Langganan perusahaan tidak aktif', HttpStatus.PAYMENT_REQUIRED);
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) await patchById(this.db, onlineApiKeys, k.id, { lastUsedAt: new Date() });
    req.user = { sub: k.createdById, tenantId: k.tenantId, role: 'CASHIER', email: `kunci-api:${k.keyPrefix}`, emailVerified: true, warehouseIds: [k.warehouseId], onlineWarehouseId: k.warehouseId };
    return true;
  }
}

@Injectable()
export class PlatformSettlementsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly repo: PosOnlineRepository,
  ) {}

  /** Pesanan online yang sudah dibayar platform (piutang) tetapi dananya belum dicairkan */
  async unsettled(tenantId: string, channel?: OnlineChannel) {
    const rows = await this.repo.listPosOrdersBySettlementIdAndChannelAndDate(this.db, tenantId, channel);
    const items = rows.map((o) => ({ id: o.id, number: o.number, date: o.date, channel: o.channel!, externalRef: o.externalRef, total: o.total, platformFee: o.platformFee, net: D(o.total).minus(o.platformFee).toFixed(2) }));
    return { items, totals: { count: items.length, total: items.reduce<Dec>((a, i) => a.plus(i.total), ZERO).toFixed(2), fee: items.reduce<Dec>((a, i) => a.plus(i.platformFee), ZERO).toFixed(2), net: items.reduce<Dec>((a, i) => a.plus(i.net), ZERO).toFixed(2) } };
  }

  list(tenantId: string) {
    return this.repo.listPosPlatformSettlementsByDateAndNumber(this.db, tenantId);
  }

  async create(user: AuthUser, dto: CreateSettlementDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(dto.orderIds)];
      if (ids.length !== dto.orderIds.length) throw new BadRequestException('Pesanan yang sama dipilih lebih dari sekali');
      // kunci pesanan agar tidak dicairkan dua kali oleh permintaan bersamaan
      await this.repo.queryPosOrder(tx, ids, user.tenantId);
      const orders = await this.repo.listPosOrdersById(tx, user.tenantId, ids);
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
      const row = await insertOne(tx, posPlatformSettlements, { tenantId: user.tenantId, number, channel: dto.channel, date, bankAccountId: bank.id, orderCount: orders.length, expected: expected.toFixed(2), received: received.toFixed(2), difference: diff.toFixed(2), notes: dto.notes?.trim() || null, createdById: user.sub });
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
      await patchById(tx, posPlatformSettlements, row.id, { journalId: journal.id });
      await this.repo.updatePosOrdersById(tx, row.id, ids);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PlatformSettlement', entityId: row.id, data: { number, channel: dto.channel, orders: orders.length, expected: expected.toFixed(2), received: received.toFixed(2) } });
      return { ...row, journalId: journal.id, journalNumber: journal.number };
    });
  }

  /** Batalkan pencairan yang salah input: jurnal dibalik, pesanan kembali belum dicairkan */
  async cancel(user: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const lock = await this.repo.queryPosPlatformSettlement(tx, id, user.tenantId);
      if (!lock.rows.length) throw new NotFoundException('Pencairan tidak ditemukan');
      const [row] = await this.repo.findPosPlatformSettlementsById(tx, id);
      if (row.status === 'CANCELLED') throw new BadRequestException('Pencairan sudah dibatalkan');
      if (row.journalId) await this.posting.reverse(tx, user.tenantId, row.journalId, toDocDate(undefined) < row.date ? row.date : toDocDate(undefined), user.sub, true);
      await this.repo.updatePosOrdersBySettlementId(tx, id);
      await patchById(tx, posPlatformSettlements, id, { status: 'CANCELLED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'PlatformSettlement', entityId: id, data: { number: row.number } });
      return { ok: true };
    });
  }
}
