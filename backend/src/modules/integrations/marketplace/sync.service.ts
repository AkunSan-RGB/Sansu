import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { SubscriptionService } from '../../../common/billing/subscription.service';
import { appUrl } from '../../../common/mail/mail.service';
import { decrypt, encrypt } from '../../../common/utils/secret';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { marketplaceConnections, marketplaceOrders, products, users, warehouses } from '../../../db/schema';
import { IntegrationsService } from '../integrations.service';
import { PROVIDERS, type NormalizedOrder, type ProviderContext, type ProviderKey, type Tokens } from './providers';
import { KEYS } from './sync.shared';
import { StartConnectionDto, UpdateConnectionDto } from './sync.dto';
import { findOwned, patchById } from '../../../db/owned';
import { SyncRepository } from './sync.repository';

const DAY = 86_400_000;

type Conn = typeof marketplaceConnections.$inferSelect;

interface SyncResult {
  fetched: number;
  imported: { orderNo: string; invoice: string; total: string }[];
  skipped: { orderNo: string; reason: string }[];
  waiting: number;
  cancelledAfterImport: string[];
  from: string;
  to: string;
}

const redirectUri = (p: ProviderKey) => `${appUrl()}/api/integrations/marketplace/oauth/${p.toLowerCase()}/callback`;

@Injectable()
export class MarketplaceSyncService {
  private readonly logger = new Logger('Marketplace');
  private running = new Set<string>();
  /** dapat diganti saat pengujian */
  fetchFn: typeof fetch = (...a) => fetch(...a);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly integrations: IntegrationsService,
    private readonly subs: SubscriptionService,
    private readonly repo: SyncRepository,
  ) {}

  providers() {
    return KEYS.map((k) => ({ key: k, label: PROVIDERS[k].label, configured: PROVIDERS[k].configured(), envVars: PROVIDERS[k].envVars, redirectUri: k === 'SIMULASI' ? null : redirectUri(k) }));
  }

  list(tenantId: string) {
    return this.db
      .select({
        id: marketplaceConnections.id,
        provider: marketplaceConnections.provider,
        channel: marketplaceConnections.channel,
        shopId: marketplaceConnections.shopId,
        shopName: marketplaceConnections.shopName,
        warehouseId: marketplaceConnections.warehouseId,
        warehouseName: warehouses.name,
        pricesIncludeVat: marketplaceConnections.pricesIncludeVat,
        isActive: marketplaceConnections.isActive,
        tokenExpiresAt: marketplaceConnections.tokenExpiresAt,
        syncedUntil: marketplaceConnections.syncedUntil,
        lastSyncAt: marketplaceConnections.lastSyncAt,
        lastResult: marketplaceConnections.lastResult,
        lastError: marketplaceConnections.lastError,
        createdAt: marketplaceConnections.createdAt,
      })
      .from(marketplaceConnections)
      .innerJoin(warehouses, eq(warehouses.id, marketplaceConnections.warehouseId))
      .where(eq(marketplaceConnections.tenantId, tenantId))
      .orderBy(asc(marketplaceConnections.createdAt));
  }

  private async assertWarehouse(tenantId: string, id: string) {
    const [w] = await this.repo.findWarehousesById(this.db, id, tenantId);
    if (!w) throw new BadRequestException('Gudang tidak ditemukan');
  }

  /** Mulai menyambungkan toko: kembalikan URL izin marketplace (atau langsung tersambung untuk simulasi) */
  async start(u: AuthUser, dto: StartConnectionDto) {
    await this.assertWarehouse(u.tenantId, dto.warehouseId);
    const p = PROVIDERS[dto.provider];
    if (!p.configured()) throw new BadRequestException(`${p.label} belum diaktifkan di server. Isi ${p.envVars.join(', ')} di file .env (didapat setelah mendaftar sebagai partner ${p.label}).`);
    if (dto.provider === 'SIMULASI') {
      const shop = await p.exchange({}, '', this.ctx(u.tenantId));
      const conn = await this.save(u.tenantId, u.sub, 'SIMULASI', shop, dto.warehouseId, dto.pricesIncludeVat ?? true);
      return { connected: true, id: conn.id };
    }
    const state = await this.jwt.signAsync({ k: 'mp', t: u.tenantId, u: u.sub, p: dto.provider, w: dto.warehouseId, v: dto.pricesIncludeVat ?? true }, { expiresIn: '20m' });
    return { url: p.authUrl(redirectUri(dto.provider), state) };
  }

  /** Kembali dari halaman izin marketplace */
  async callback(providerSlug: string, query: Record<string, string>) {
    const key = providerSlug.toUpperCase() as ProviderKey;
    const p = PROVIDERS[key];
    if (!p || key === 'SIMULASI') throw new BadRequestException('Marketplace tidak dikenal');
    let st: { k: string; t: string; u: string; p: ProviderKey; w: string; v: boolean };
    try {
      st = await this.jwt.verifyAsync(query.state ?? '');
    } catch {
      throw new BadRequestException('Tautan izin sudah kedaluwarsa. Ulangi dari menu Integrasi.');
    }
    if (st.k !== 'mp' || st.p !== key) throw new BadRequestException('Parameter izin tidak cocok');
    const shop = await p.exchange(query, redirectUri(key), this.ctx(st.t));
    const conn = await this.save(st.t, st.u, key, shop, st.w, st.v);
    return conn;
  }

  private async save(tenantId: string, userId: string, provider: ProviderKey, shop: Tokens & { shopId: string; shopName: string }, warehouseId: string, pricesIncludeVat: boolean) {
    const p = PROVIDERS[provider];
    const others = await this.repo.listMarketplaceConnectionsByProvider(this.db, tenantId, provider);
    const channel = others.some((o) => o.shopId !== shop.shopId) ? `${p.channel} (${shop.shopName})`.slice(0, 40) : p.channel;
    const credentials = encrypt(JSON.stringify({ accessToken: shop.accessToken, refreshToken: shop.refreshToken, extra: shop.extra }));
    const [row] = await this.repo.insertMarketplaceConnections(this.db, tenantId, provider, channel, shop, credentials, warehouseId, pricesIncludeVat, userId);
    return row;
  }

  async update(u: AuthUser, id: string, dto: UpdateConnectionDto) {
    if (dto.warehouseId) await this.assertWarehouse(u.tenantId, dto.warehouseId);
    const [r] = await this.repo.updateMarketplaceConnectionsById(this.db, dto, id, u.tenantId);
    if (!r) throw new NotFoundException('Koneksi tidak ditemukan');
    return { ok: true };
  }

  async remove(u: AuthUser, id: string) {
    const [r] = await this.repo.deleteMarketplaceConnectionsById(this.db, id, u.tenantId);
    if (!r) throw new NotFoundException('Koneksi tidak ditemukan');
    return { ok: true };
  }

  private ctx(tenantId: string): ProviderContext {
    return {
      fetch: this.fetchFn,
      now: () => new Date(),
      products: async () => (await this.repo.listProductsByIsActive(this.db, tenantId)),
    };
  }

  async syncNow(u: AuthUser, id: string) {
    const c = await findOwned(this.db, marketplaceConnections, u.tenantId, id);
    if (!c) throw new NotFoundException('Koneksi tidak ditemukan');
    return this.syncOne(c, true);
  }

  /** Pengguna yang "menjalankan" impor: pembuat koneksi, atau pemilik aktif */
  private async actor(c: Conn): Promise<AuthUser> {
    const [u] = await this.repo.findUsersByIdAndIsActive(this.db, c.createdBy);
    const [o] = u ? [u] : await this.repo.findUsersByRoleAndIsActive(this.db, c.tenantId);
    if (!o) throw new Error('Tidak ada pengguna aktif untuk menjalankan impor');
    return { sub: o.id, tenantId: o.tenantId, role: o.role, email: o.email };
  }

  async syncOne(c: Conn, manual = false): Promise<SyncResult> {
    if (this.running.has(c.id)) throw new BadRequestException('Sinkron toko ini sedang berjalan');
    this.running.add(c.id);
    const p = PROVIDERS[c.provider as ProviderKey];
    const now = new Date();
    try {
      if (!p) throw new Error(`Marketplace ${c.provider} tidak dikenal`);
      if (!c.isActive && !manual) throw new Error('Koneksi dinonaktifkan');
      if ((await this.subs.state(c.tenantId)).readOnly) throw new Error('Langganan tidak aktif — sinkron dihentikan sementara');
      const ctx = this.ctx(c.tenantId);
      let tokens: Tokens = c.credentials ? { ...JSON.parse(decrypt(c.credentials)), expiresAt: c.tokenExpiresAt ?? undefined } : { accessToken: '' };
      if (tokens.refreshToken && c.tokenExpiresAt && c.tokenExpiresAt.getTime() < now.getTime() + 10 * 60_000) {
        tokens = await p.refresh(tokens, c.shopId, ctx);
        await patchById(this.db, marketplaceConnections, c.id, { credentials: encrypt(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, extra: tokens.extra })), tokenExpiresAt: tokens.expiresAt ?? null });
      }
      // ambil ulang 1 jam terakhir agar perubahan status yang terlambat tidak terlewat (duplikat otomatis dilewati)
      const from = new Date(Math.max((c.syncedUntil?.getTime() ?? now.getTime() - 7 * DAY) - 3600_000, now.getTime() - 30 * DAY));
      const orders = await p.orders(tokens, c.shopId, from, now, ctx);
      const res = await this.process(c, orders);
      const result: SyncResult = { ...res, fetched: orders.length, from: from.toISOString(), to: now.toISOString() };
      await patchById(this.db, marketplaceConnections, c.id, { syncedUntil: now, lastSyncAt: now, lastError: null, lastResult: { ...result, imported: result.imported.slice(0, 50), skipped: result.skipped.slice(0, 50), importedCount: result.imported.length, skippedCount: result.skipped.length } });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      await patchById(this.db, marketplaceConnections, c.id, { lastSyncAt: now, lastError: msg.slice(0, 500) });
      if (manual) throw new BadRequestException(msg);
      this.logger.warn(`Sinkron ${c.provider}/${c.shopName} gagal: ${msg}`);
      return { fetched: 0, imported: [], skipped: [], waiting: 0, cancelledAfterImport: [], from: '', to: '' };
    } finally {
      this.running.delete(c.id);
    }
  }

  /** Pesanan yang sudah dikirim → faktur; yang belum dikirim ditunggu; yang batal setelah diimpor dilaporkan */
  async process(c: Conn, orders: NormalizedOrder[]) {
    const known = new Set(
      orders.length
        ? (
            await this.repo.listMarketplaceOrdersByChannelAndOrderNo(this.db, c.tenantId, c.channel, orders)
          ).map((r) => r.orderNo)
        : [],
    );
    const ready = orders.filter((o) => o.shipped && !o.cancelled && !known.has(o.orderNo) && o.lines.length);
    const result = {
      imported: [] as SyncResult['imported'],
      skipped: [] as SyncResult['skipped'],
      waiting: orders.filter((o) => !o.shipped && !o.cancelled && !known.has(o.orderNo)).length,
      cancelledAfterImport: orders.filter((o) => o.cancelled && known.has(o.orderNo)).map((o) => o.orderNo),
    };
    if (!ready.length) return result;
    const actor = await this.actor(c);
    for (let i = 0; i < ready.length; i += 500) {
      const r = await this.integrations.importMarketplace(actor, {
        channel: c.channel,
        warehouseId: c.warehouseId,
        pricesIncludeVat: c.pricesIncludeVat,
        orders: ready.slice(i, i + 500).map((o) => ({ orderNo: o.orderNo, date: o.date, lines: o.lines })),
      });
      result.imported.push(...r.imported);
      result.skipped.push(...r.skipped);
    }
    return result;
  }

  /** Dipanggil penjadwal: semua koneksi aktif */
  async syncAll() {
    const conns = await this.repo.listMarketplaceConnectionsByIsActiveAndLastSyncAt(this.db);
    for (const c of conns) {
      if (!PROVIDERS[c.provider as ProviderKey]?.configured()) continue;
      if (c.provider === 'SIMULASI') continue; // simulasi hanya saat tombol ditekan
      await this.syncOne(c).catch(() => undefined);
    }
  }
}

@Injectable()
export class MarketplaceScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly svc: MarketplaceSyncService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const minutes = Math.max(5, Number(process.env.MARKETPLACE_SYNC_MINUTES ?? 15));
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void this.svc.syncAll().finally(() => (this.busy = false));
    }, minutes * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
