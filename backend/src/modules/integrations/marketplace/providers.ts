/**
 * Adapter API marketplace untuk sinkron pesanan otomatis.
 *
 * Setiap marketplace mewajibkan pendaftaran aplikasi partner/developer. Isi kuncinya di .env:
 *   Shopee Open Platform     : SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY  (SHOPEE_SANDBOX=true untuk uji)
 *   TikTok Shop (+Tokopedia) : TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SERVICE_ID
 *   Lazada Open Platform     : LAZADA_APP_KEY, LAZADA_APP_SECRET
 * Mode SIMULASI tidak butuh kunci — membuat pesanan contoh dari produk Anda untuk mencoba alurnya.
 *
 * Semua adapter mengubah pesanan menjadi bentuk yang sama (NormalizedOrder), lalu diproses oleh
 * alur impor marketplace yang sudah ada (pesanan → SO → faktur → stok & jurnal).
 */
import { createHmac } from 'crypto';

export type ProviderKey = 'SHOPEE' | 'TIKTOK' | 'LAZADA' | 'SIMULASI';

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Kedaluwarsa token akses */
  expiresAt?: Date;
  /** Data tambahan per marketplace (mis. shop_cipher TikTok) */
  extra?: Record<string, string>;
}
export interface ShopIdentity {
  shopId: string;
  shopName: string;
}
export interface NormalizedOrder {
  orderNo: string;
  /** Tanggal pesanan YYYY-MM-DD (WIB) */
  date: string;
  /** Status asli dari marketplace */
  status: string;
  /** Sudah dikirim / selesai → boleh dibukukan (stok keluar, faktur) */
  shipped: boolean;
  cancelled: boolean;
  lines: { sku: string; qty: string; price: string }[];
}

export interface ProviderContext {
  fetch: typeof fetch;
  now: () => Date;
  /** Untuk SIMULASI: daftar SKU & harga jual produk perusahaan */
  products?: () => Promise<{ sku: string; price: string }[]>;
}

export interface MarketplaceProvider {
  readonly key: ProviderKey;
  readonly label: string;
  /** Nama saluran di faktur & laporan */
  readonly channel: string;
  /** Variabel .env yang dibutuhkan */
  readonly envVars: string[];
  configured(): boolean;
  /** URL halaman izin toko di marketplace */
  authUrl(redirectUri: string, state: string): string;
  /** Tukar kode izin → token + identitas toko */
  exchange(params: Record<string, string>, redirectUri: string, ctx: ProviderContext): Promise<Tokens & ShopIdentity>;
  refresh(t: Tokens, shopId: string, ctx: ProviderContext): Promise<Tokens>;
  /** Pesanan yang diperbarui dalam rentang waktu */
  orders(t: Tokens, shopId: string, from: Date, to: Date, ctx: ProviderContext): Promise<NormalizedOrder[]>;
}

export const hmacHex = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');
/** Tanggal WIB dari detik unix */
export const wibDate = (unixSec: number) => new Date(unixSec * 1000 + 7 * 3600_000).toISOString().slice(0, 10);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const money2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Gabungkan baris dengan SKU sama; harga = rata-rata tertimbang */
export function mergeLines(lines: { sku: string; qty: number; price: number }[]) {
  const m = new Map<string, { qty: number; amount: number }>();
  for (const l of lines) {
    const sku = (l.sku ?? '').trim();
    if (!sku || !(l.qty > 0)) continue;
    const cur = m.get(sku) ?? { qty: 0, amount: 0 };
    cur.qty += l.qty;
    cur.amount += l.qty * l.price;
    m.set(sku, cur);
  }
  return [...m].map(([sku, v]) => ({ sku, qty: String(v.qty), price: money2(v.amount / v.qty) }));
}

async function getJson<T>(ctx: ProviderContext, url: string, init?: RequestInit): Promise<T> {
  const res = await ctx.fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Jawaban marketplace tidak bisa dibaca (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return body as T;
}

// =====================================================================
//  Shopee Open Platform v2
// =====================================================================
export interface ShopeeOrder {
  order_sn: string;
  order_status: string;
  create_time: number;
  item_list?: { item_sku?: string; model_sku?: string; model_quantity_purchased?: number; model_discounted_price?: number; model_original_price?: number }[];
}
const SHOPEE_SHIPPED = new Set(['SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED']);

export class ShopeeProvider implements MarketplaceProvider {
  readonly key = 'SHOPEE' as const;
  readonly label = 'Shopee';
  readonly channel = 'Shopee';
  readonly envVars = ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY'];
  configured() {
    return !!(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
  }
  host() {
    return process.env.SHOPEE_SANDBOX === 'true' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com';
  }
  /** base string: partner_id + path + timestamp [+ access_token + shop_id], HMAC-SHA256 dengan partner_key (hex) */
  sign(path: string, ts: number, accessToken = '', shopId = '') {
    return hmacHex(process.env.SHOPEE_PARTNER_KEY!, `${process.env.SHOPEE_PARTNER_ID}${path}${ts}${accessToken}${shopId}`);
  }
  private publicUrl(path: string, ts: number) {
    return `${this.host()}${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${ts}&sign=${this.sign(path, ts)}`;
  }

  authUrl(redirectUri: string, state: string) {
    const path = '/api/v2/shop/auth_partner';
    const ts = sec(new Date());
    // Shopee tidak meneruskan parameter state → disisipkan di URL kembali
    const redirect = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
    return `${this.publicUrl(path, ts)}&redirect=${encodeURIComponent(redirect)}`;
  }

  private async token(path: string, body: Record<string, unknown>, ctx: ProviderContext): Promise<Tokens> {
    const j = await getJson<{ access_token?: string; refresh_token?: string; expire_in?: number; error?: string; message?: string }>(ctx, this.publicUrl(path, sec(ctx.now())), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, partner_id: Number(process.env.SHOPEE_PARTNER_ID) }),
    });
    if (!j.access_token) throw new Error(`Shopee: ${j.message || j.error || 'gagal mengambil token — sambungkan ulang toko'}`);
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(ctx.now().getTime() + (j.expire_in ?? 14_400) * 1000) };
  }

  async exchange(params: Record<string, string>, _redirect: string, ctx: ProviderContext) {
    if (!params.code || !params.shop_id) throw new Error('Shopee tidak mengirim kode izin / shop_id');
    const t = await this.token('/api/v2/auth/token/get', { code: params.code, shop_id: Number(params.shop_id) }, ctx);
    let shopName = `Toko Shopee ${params.shop_id}`;
    try {
      const info = await this.call<{ shop_name?: string }>(t, params.shop_id, '/api/v2/shop/get_shop_info', {}, ctx);
      if (info.shop_name) shopName = info.shop_name;
    } catch {
      /* nama toko opsional */
    }
    return { ...t, shopId: String(params.shop_id), shopName };
  }

  async refresh(t: Tokens, shopId: string, ctx: ProviderContext) {
    const n = await this.token('/api/v2/auth/access_token/get', { refresh_token: t.refreshToken, shop_id: Number(shopId) }, ctx);
    return { ...n, refreshToken: n.refreshToken ?? t.refreshToken };
  }

  /** Panggilan API toko (GET bertanda tangan) */
  async call<T>(t: Tokens, shopId: string, path: string, q: Record<string, string>, ctx: ProviderContext): Promise<T> {
    const ts = sec(ctx.now());
    const qs = new URLSearchParams({ partner_id: String(process.env.SHOPEE_PARTNER_ID), timestamp: String(ts), access_token: t.accessToken, shop_id: shopId, sign: this.sign(path, ts, t.accessToken, shopId), ...q });
    const j = await getJson<{ error?: string; message?: string; response?: T }>(ctx, `${this.host()}${path}?${qs}`);
    if (j.error) throw new Error(`Shopee ${path}: ${j.message || j.error}`);
    return (j.response ?? {}) as T;
  }

  async orders(t: Tokens, shopId: string, from: Date, to: Date, ctx: ProviderContext) {
    const out: NormalizedOrder[] = [];
    // Shopee membatasi rentang waktu 15 hari per permintaan
    for (let a = from.getTime(); a < to.getTime(); a += 15 * 86_400_000) {
      const b = Math.min(to.getTime(), a + 15 * 86_400_000 - 1000);
      let cursor = '';
      for (let page = 0; page < 100; page++) {
        const list = await this.call<{ order_list?: { order_sn: string }[]; more?: boolean; next_cursor?: string }>(
          t,
          shopId,
          '/api/v2/order/get_order_list',
          { time_range_field: 'update_time', time_from: String(Math.floor(a / 1000)), time_to: String(Math.floor(b / 1000)), page_size: '100', cursor },
          ctx,
        );
        const sns = (list.order_list ?? []).map((o) => o.order_sn);
        for (let i = 0; i < sns.length; i += 50) {
          const det = await this.call<{ order_list?: ShopeeOrder[] }>(
            t,
            shopId,
            '/api/v2/order/get_order_detail',
            { order_sn_list: sns.slice(i, i + 50).join(','), response_optional_fields: 'item_list,order_status,create_time' },
            ctx,
          );
          out.push(...(det.order_list ?? []).map((o) => this.normalize(o)));
        }
        if (!list.more || !list.next_cursor) break;
        cursor = list.next_cursor;
      }
    }
    return out;
  }

  normalize(o: ShopeeOrder): NormalizedOrder {
    return {
      orderNo: o.order_sn,
      date: wibDate(o.create_time),
      status: o.order_status,
      shipped: SHOPEE_SHIPPED.has(o.order_status),
      cancelled: o.order_status === 'CANCELLED' || o.order_status === 'IN_CANCEL',
      lines: mergeLines(
        (o.item_list ?? []).map((i) => ({
          sku: i.model_sku || i.item_sku || '',
          qty: Number(i.model_quantity_purchased ?? 0),
          price: Number(i.model_discounted_price ?? i.model_original_price ?? 0),
        })),
      ),
    };
  }
}

// =====================================================================
//  TikTok Shop Open API (versi 202309) — juga melayani toko Tokopedia
// =====================================================================
export interface TiktokOrder {
  id: string;
  status: string;
  create_time: number;
  line_items?: { seller_sku?: string; sku_id?: string; sale_price?: string; original_price?: string; quantity?: number }[];
}
const TIKTOK_SHIPPED = new Set(['AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED']);

export class TiktokProvider implements MarketplaceProvider {
  readonly key = 'TIKTOK' as const;
  readonly label = 'TikTok Shop / Tokopedia';
  readonly channel = 'TikTok Shop';
  readonly envVars = ['TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET', 'TIKTOK_SERVICE_ID'];
  readonly api = 'https://open-api.tiktokglobalshop.com';
  configured() {
    return !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_SERVICE_ID);
  }

  /**
   * sign = HMAC-SHA256(app_secret, app_secret + path + (param urut key+value, tanpa sign & access_token) + body + app_secret), hex
   */
  sign(path: string, params: Record<string, string>, body = '') {
    const secret = process.env.TIKTOK_APP_SECRET!;
    const base = Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'access_token')
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
    return hmacHex(secret, `${secret}${path}${base}${body}${secret}`);
  }

  authUrl(_redirect: string, state: string) {
    return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(process.env.TIKTOK_SERVICE_ID!)}&state=${encodeURIComponent(state)}`;
  }

  private async token(grant: 'authorized_code' | 'refresh_token', value: string, ctx: ProviderContext): Promise<Tokens & { sellerName?: string }> {
    const q = new URLSearchParams({ app_key: process.env.TIKTOK_APP_KEY!, app_secret: process.env.TIKTOK_APP_SECRET!, grant_type: grant, ...(grant === 'authorized_code' ? { auth_code: value } : { refresh_token: value }) });
    const path = grant === 'authorized_code' ? '/api/v2/token/get' : '/api/v2/token/refresh';
    const j = await getJson<{ code?: number; message?: string; data?: { access_token: string; access_token_expire_in: number; refresh_token: string; seller_name?: string } }>(ctx, `https://auth.tiktok-shops.com${path}?${q}`);
    if (!j.data?.access_token) throw new Error(`TikTok Shop: ${j.message || 'gagal mengambil token — sambungkan ulang toko'}`);
    return { accessToken: j.data.access_token, refreshToken: j.data.refresh_token, expiresAt: new Date(j.data.access_token_expire_in * 1000), sellerName: j.data.seller_name };
  }

  async call<T>(t: Tokens, method: 'GET' | 'POST', path: string, q: Record<string, string>, body: unknown, ctx: ProviderContext): Promise<T> {
    const params: Record<string, string> = { app_key: process.env.TIKTOK_APP_KEY!, timestamp: String(sec(ctx.now())), ...q };
    const raw = body === undefined ? '' : JSON.stringify(body);
    params.sign = this.sign(path, params, raw);
    const j = await getJson<{ code: number; message?: string; data?: T }>(ctx, `${this.api}${path}?${new URLSearchParams(params)}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-tts-access-token': t.accessToken },
      body: method === 'POST' ? raw : undefined,
    });
    if (j.code !== 0) throw new Error(`TikTok Shop ${path}: ${j.message || j.code}`);
    return (j.data ?? {}) as T;
  }

  async exchange(params: Record<string, string>, _redirect: string, ctx: ProviderContext) {
    const code = params.code || params.auth_code;
    if (!code) throw new Error('TikTok Shop tidak mengirim kode izin');
    const t = await this.token('authorized_code', code, ctx);
    const shops = await this.call<{ shops?: { id: string; name: string; cipher: string; region?: string }[] }>(t, 'GET', '/authorization/202309/shops', {}, undefined, ctx);
    const shop = shops.shops?.find((s) => !s.region || s.region === 'ID') ?? shops.shops?.[0];
    if (!shop) throw new Error('Tidak ada toko yang diizinkan di akun TikTok Shop ini');
    return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, extra: { cipher: shop.cipher }, shopId: shop.id, shopName: shop.name || t.sellerName || 'Toko TikTok' };
  }

  async refresh(t: Tokens, _shopId: string, ctx: ProviderContext) {
    const n = await this.token('refresh_token', t.refreshToken ?? '', ctx);
    return { accessToken: n.accessToken, refreshToken: n.refreshToken, expiresAt: n.expiresAt, extra: t.extra };
  }

  async orders(t: Tokens, _shopId: string, from: Date, to: Date, ctx: ProviderContext) {
    const out: NormalizedOrder[] = [];
    let pageToken = '';
    for (let page = 0; page < 200; page++) {
      const q: Record<string, string> = { shop_cipher: t.extra?.cipher ?? '', page_size: '50', sort_field: 'update_time', sort_order: 'ASC' };
      if (pageToken) q.page_token = pageToken;
      const d = await this.call<{ orders?: TiktokOrder[]; next_page_token?: string }>(t, 'POST', '/order/202309/orders/search', q, { update_time_ge: sec(from), update_time_lt: sec(to) }, ctx);
      out.push(...(d.orders ?? []).map((o) => this.normalize(o)));
      if (!d.next_page_token) break;
      pageToken = d.next_page_token;
    }
    return out;
  }

  normalize(o: TiktokOrder): NormalizedOrder {
    return {
      orderNo: o.id,
      date: wibDate(o.create_time),
      status: o.status,
      shipped: TIKTOK_SHIPPED.has(o.status),
      cancelled: o.status === 'CANCELLED',
      // satu line_item = satu unit (quantity dipakai bila ada)
      lines: mergeLines((o.line_items ?? []).map((l) => ({ sku: l.seller_sku || l.sku_id || '', qty: l.quantity ?? 1, price: Number(l.sale_price ?? l.original_price ?? 0) }))),
    };
  }
}

// =====================================================================
//  Lazada Open Platform
// =====================================================================
export interface LazadaOrder {
  order_id: number | string;
  order_number?: number | string;
  created_at: string;
  statuses?: string[];
}
export interface LazadaItem {
  sku?: string;
  seller_sku?: string;
  item_price?: number | string;
  paid_price?: number | string;
  status?: string;
}
const LAZADA_SHIPPED = new Set(['shipped', 'delivered', 'confirmed', 'ready_to_ship_pending']);

export class LazadaProvider implements MarketplaceProvider {
  readonly key = 'LAZADA' as const;
  readonly label = 'Lazada';
  readonly channel = 'Lazada';
  readonly envVars = ['LAZADA_APP_KEY', 'LAZADA_APP_SECRET'];
  readonly api = 'https://api.lazada.co.id/rest';
  readonly auth = 'https://auth.lazada.com/rest';
  configured() {
    return !!(process.env.LAZADA_APP_KEY && process.env.LAZADA_APP_SECRET);
  }

  /** sign = HEX_UPPER(HMAC-SHA256(app_secret, api_path + urutan key+value semua parameter)) */
  sign(path: string, params: Record<string, string>) {
    const base = Object.keys(params)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
    return hmacHex(process.env.LAZADA_APP_SECRET!, `${path}${base}`).toUpperCase();
  }

  authUrl(redirectUri: string, state: string) {
    const q = new URLSearchParams({ response_type: 'code', force_auth: 'true', redirect_uri: redirectUri, client_id: process.env.LAZADA_APP_KEY!, state });
    return `https://auth.lazada.com/oauth/authorize?${q}`;
  }

  async call<T>(host: string, path: string, q: Record<string, string>, ctx: ProviderContext, accessToken?: string): Promise<T> {
    const params: Record<string, string> = { app_key: process.env.LAZADA_APP_KEY!, timestamp: String(ctx.now().getTime()), sign_method: 'sha256', ...q };
    if (accessToken) params.access_token = accessToken;
    params.sign = this.sign(path, params);
    const j = await getJson<{ code: string; message?: string; data?: T } & Record<string, unknown>>(ctx, `${host}${path}?${new URLSearchParams(params)}`);
    if (j.code !== '0') throw new Error(`Lazada ${path}: ${j.message || j.code}`);
    return (j.data ?? j) as T;
  }

  private toTokens(j: { access_token?: string; refresh_token?: string; expires_in?: number }, ctx: ProviderContext): Tokens {
    if (!j.access_token) throw new Error('Lazada: gagal mengambil token — sambungkan ulang toko');
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(ctx.now().getTime() + (j.expires_in ?? 0) * 1000) };
  }

  async exchange(params: Record<string, string>, _redirect: string, ctx: ProviderContext) {
    if (!params.code) throw new Error('Lazada tidak mengirim kode izin');
    const j = await this.call<{ access_token?: string; refresh_token?: string; expires_in?: number; account?: string; country_user_info?: { seller_id?: string; short_code?: string }[] }>(this.auth, '/auth/token/create', { code: params.code }, ctx);
    const t = this.toTokens(j, ctx);
    let shopId = j.country_user_info?.[0]?.seller_id ?? j.account ?? 'lazada';
    let shopName = j.account ?? 'Toko Lazada';
    try {
      const s = await this.call<{ name?: string; seller_id?: number | string }>(this.api, '/seller/get', {}, ctx, t.accessToken);
      if (s.name) shopName = s.name;
      if (s.seller_id) shopId = String(s.seller_id);
    } catch {
      /* opsional */
    }
    return { ...t, shopId: String(shopId), shopName };
  }

  async refresh(t: Tokens, _shopId: string, ctx: ProviderContext) {
    const j = await this.call<{ access_token?: string; refresh_token?: string; expires_in?: number }>(this.auth, '/auth/token/refresh', { refresh_token: t.refreshToken ?? '' }, ctx);
    return this.toTokens(j, ctx);
  }

  async orders(t: Tokens, _shopId: string, from: Date, to: Date, ctx: ProviderContext) {
    const out: NormalizedOrder[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const d = await this.call<{ orders?: LazadaOrder[]; count?: number }>(
        this.api,
        '/orders/get',
        { update_after: from.toISOString(), update_before: to.toISOString(), sort_by: 'updated_at', sort_direction: 'ASC', offset: String(offset), limit: '100' },
        ctx,
        t.accessToken,
      );
      const orders = d.orders ?? [];
      for (let i = 0; i < orders.length; i += 50) {
        const chunk = orders.slice(i, i + 50);
        const items = await this.call<{ order_id: number | string; order_items: LazadaItem[] }[]>(
          this.api,
          '/orders/items/get',
          { order_ids: `[${chunk.map((o) => o.order_id).join(',')}]` },
          ctx,
          t.accessToken,
        );
        const byId = new Map((Array.isArray(items) ? items : []).map((x) => [String(x.order_id), x.order_items]));
        for (const o of chunk) out.push(this.normalize(o, byId.get(String(o.order_id)) ?? []));
      }
      if (orders.length < 100) break;
    }
    return out;
  }

  normalize(o: LazadaOrder, items: LazadaItem[]): NormalizedOrder {
    const statuses = (o.statuses ?? []).map((s) => s.toLowerCase());
    const live = items.filter((i) => !['canceled', 'cancelled', 'returned'].includes(String(i.status ?? '').toLowerCase()));
    const createdAt = new Date(o.created_at.replace(' ', 'T'));
    return {
      orderNo: String(o.order_number ?? o.order_id),
      date: Number.isNaN(createdAt.getTime()) ? o.created_at.slice(0, 10) : wibDate(sec(createdAt)),
      status: statuses.join(','),
      shipped: statuses.some((s) => LAZADA_SHIPPED.has(s)),
      cancelled: statuses.length > 0 && statuses.every((s) => s === 'canceled' || s === 'cancelled'),
      // satu baris item = satu unit
      lines: mergeLines(live.map((i) => ({ sku: i.seller_sku || i.sku || '', qty: 1, price: Number(i.item_price ?? i.paid_price ?? 0) }))),
    };
  }
}

// =====================================================================
//  Simulasi — untuk mencoba alur tanpa akun partner
// =====================================================================
export class SimulationProvider implements MarketplaceProvider {
  readonly key = 'SIMULASI' as const;
  readonly label = 'Simulasi (uji coba)';
  readonly channel = 'Simulasi';
  readonly envVars: string[] = [];
  configured() {
    return true;
  }
  authUrl() {
    return '';
  }
  async exchange() {
    return { accessToken: 'simulasi', shopId: 'SIM-001', shopName: 'Toko Simulasi' };
  }
  async refresh(t: Tokens) {
    return t;
  }
  /** 1–3 pesanan baru per sinkron, memakai 1–3 produk acak (deterministik per jam) */
  async orders(_t: Tokens, _shopId: string, _from: Date, to: Date, ctx: ProviderContext) {
    const prods = ((await ctx.products?.()) ?? []).filter((p) => Number(p.price) > 0);
    if (!prods.length) return [];
    // satu jam = satu rangkaian pesanan: dua sinkron berurutan tidak menghasilkan pesanan berbeda hanya karena menit berganti
    const seed = Math.floor(to.getTime() / 3_600_000);
    let x = seed;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const n = 1 + Math.floor(rnd() * 3);
    return Array.from({ length: n }, (_, i): NormalizedOrder => {
      const k = 1 + Math.floor(rnd() * Math.min(3, prods.length));
      const lines = Array.from({ length: k }, () => {
        const p = prods[Math.floor(rnd() * prods.length)];
        return { sku: p.sku, qty: 1 + Math.floor(rnd() * 3), price: Math.round(Number(p.price) * 1.11) };
      });
      return { orderNo: `SIM${seed}${i}`, date: wibDate(sec(to)), status: 'COMPLETED', shipped: true, cancelled: false, lines: mergeLines(lines) };
    });
  }
}

export const PROVIDERS: Record<ProviderKey, MarketplaceProvider> = {
  SHOPEE: new ShopeeProvider(),
  TIKTOK: new TiktokProvider(),
  LAZADA: new LazadaProvider(),
  SIMULASI: new SimulationProvider(),
};
