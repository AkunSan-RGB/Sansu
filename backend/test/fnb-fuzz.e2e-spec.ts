/**
 * Uji acak F&B: meja, pesanan terbuka, dapur, pisah bill, pesanan online, pencairan platform, PB1.
 * Setelah tiap langkah memeriksa: jurnal seimbang, stok tidak negatif, piutang platform (1-1140) = pesanan online belum cair
 * (total - komisi), persediaan buku besar = nilai stok, pesanan lunas tidak punya baris belum dibayar, tidak ada respons 5xx.
 * Ulangi satu benih: FUZZ_SEED=7 npx jest ... fnb-fuzz
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [11, 22, 33, 44];
const STEPS = Number(process.env.FUZZ_STEPS ?? 90);
const CHANNELS = ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'WEBSITE'];

describe('Uji acak F&B (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it.each(SEEDS)('benih %i: invarian meja, dapur, online, pencairan terjaga', async (seed) => {
    const rand = rng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const log: string[] = [];
    const stats = { ok: 0, rejected: 0 };
    const byLabel: Record<string, [number, number]> = {};
    const today = todayJakarta();
    const reg = await http.post('/api/auth/register').send({ companyName: `Kafe Fuzz ${seed}`, name: 'Pemilik', email: `ff-${seed}-${Date.now()}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201);
    const H = { Authorization: `Bearer ${reg.body.accessToken}` };
    const tenantId = (await http.get('/api/auth/me').set(H)).body.tenantId as string;
    const call = async (method: 'get' | 'post' | 'patch', url: string, body?: object, headers: object = H) => {
      const r = await (http as any)[method](`/api${url}`).set(headers).send(body);
      if (r.status >= 500) throw new Error(`ERROR SERVER ${r.status} ${method.toUpperCase()} ${url} ${JSON.stringify(body)}\n${JSON.stringify(r.body).slice(0, 400)}\nlangkah: ${log.slice(-6).join(' | ')}`);
      return r;
    };
    const tryPost = async (label: string, url: string, body: object = {}, headers: object = H) => {
      const r = await call('post', url, body, headers);
      log.push(`${label}:${r.status}`);
      r.status < 300 ? stats.ok++ : stats.rejected++;
      (byLabel[label] ??= [0, 0])[r.status < 300 ? 0 : 1]++;
      // eslint-disable-next-line no-console
      if (r.status >= 300 && process.env.FUZZ_WHY) console.log(label, r.status, JSON.stringify(r.body).slice(0, 140));
      return r;
    };
    const W = (await call('get', '/warehouses')).body[0].id as string;
    const mk = async (sku: string, body: object) => (await call('post', '/products', { sku, sellPrice: '0', ...body })).body.id as string;
    const kopi = await mk('BB-KOPI', { name: 'Biji Kopi', baseUom: 'GRAM' });
    const susu = await mk('BB-SUSU', { name: 'Susu', baseUom: 'ML' });
    const air = await mk('FB-AIR', { name: 'Air Mineral', baseUom: 'BOTOL', sellPrice: '6000' });
    const menus: { id: string; sku: string }[] = [];
    for (const [sku, price, k, s] of [['MN-A', 24000, 18, 150], ['MN-B', 20000, 18, 0], ['MN-C', 28000, 18, 200]] as const) {
      const id = await mk(sku, { name: `Menu ${sku}`, baseUom: 'PCS', sellPrice: String(price), madeToOrder: true });
      await call('post', '/production/boms', { name: `Resep ${sku}`, productId: id, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: String(k) }, ...(s ? [{ productId: susu, qty: String(s) }] : [])] });
      menus.push({ id, sku });
    }
    const sellable = [...menus.map((m) => m.id), air];
    const restock = () => call('post', '/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: kopi, qty: '1500', unitCost: '140' }, { productId: susu, qty: '6000', unitCost: '18' }, { productId: air, qty: '60', unitCost: '3000' }] });
    await restock();
    await call('post', '/accounting/journals', { date: today, description: 'Modal', lines: [{ accountId: (await call('get', '/accounting/accounts')).body.find((a: { code: string }) => a.code === '1-1100').id, debit: '500000000' }, { accountId: (await call('get', '/accounting/accounts')).body.find((a: { code: string }) => a.code === '3-1000').id, credit: '500000000' }] });
    const tables: string[] = [];
    for (let i = 1; i <= 4; i++) tables.push((await call('post', '/pos/tables', { warehouseId: W, code: `M${i}`, name: `Meja ${i}`, seats: 4 })).body.id);
    const key = (await call('post', '/pos/online/keys', { name: 'Uji', warehouseId: W })).body.key as string;
    let session = (await call('post', '/pos/sessions', { warehouseId: W, openingCash: '100000' })).body.id as string;
    let seq = 0;

    const q = async <T = any>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
    const glBalance = async (code: string) => Number((await q(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.tenant_id=$1 AND a.code=$2`, [tenantId, code]))[0].v);
    const check = async (when: string) => {
      const ctx = `[benih ${seed} · ${when}] ${log.slice(-5).join(' | ')}`;
      expect({ ctx, bad: await q(`SELECT j.number FROM journal_entries j JOIN journal_lines l ON l.journal_id=j.id WHERE j.tenant_id=$1 GROUP BY j.id, j.number HAVING SUM(l.debit)<>SUM(l.credit)`, [tenantId]) }).toEqual({ ctx, bad: [] });
      expect({ ctx, neg: await q(`SELECT product_id, qty FROM stock_balances WHERE tenant_id=$1 AND qty < 0`, [tenantId]) }).toEqual({ ctx, neg: [] });
      const platform = Number((await q(`SELECT COALESCE(SUM(total - platform_fee),0) AS v FROM pos_orders WHERE tenant_id=$1 AND channel IS NOT NULL AND settlement_id IS NULL`, [tenantId]))[0].v);
      expect({ ctx, platformGL: await glBalance('1-1140') }).toEqual({ ctx, platformGL: expect.closeTo(platform, 1) });
      const stockValue = Number((await q(`SELECT COALESCE(SUM(qty*avg_cost),0) AS v FROM stock_balances WHERE tenant_id=$1`, [tenantId]))[0].v);
      expect({ ctx, invGL: await glBalance('1-1400') }).toEqual({ ctx, invGL: expect.closeTo(stockValue, -1) });
      // satu meja hanya satu pesanan terbuka; pesanan lunas tidak menyisakan baris belum dibayar
      expect({ ctx, dupTables: await q(`SELECT table_id FROM pos_tabs WHERE tenant_id=$1 AND status='OPEN' AND table_id IS NOT NULL GROUP BY table_id HAVING COUNT(*)>1`, [tenantId]) }).toEqual({ ctx, dupTables: [] });
      expect({ ctx, leftovers: await q(`SELECT t.number FROM pos_tabs t JOIN pos_tab_lines l ON l.tab_id=t.id WHERE t.tenant_id=$1 AND t.status='PAID' AND l.status<>'VOID' AND l.paid_order_id IS NULL`, [tenantId]) }).toEqual({ ctx, leftovers: [] });
      // pencairan: jumlah pesanan & total seharusnya cocok dengan pesanan yang menunjuknya
      expect({ ctx, badSettle: await q(`SELECT s.number FROM pos_platform_settlements s WHERE s.tenant_id=$1 AND s.status='POSTED' AND (SELECT COUNT(*) FROM pos_orders o WHERE o.settlement_id=s.id) <> s.order_count`, [tenantId]) }).toEqual({ ctx, badSettle: [] });
    };

    const openTabs = async () => ((await call('get', '/pos/tabs?status=OPEN')).body as { id: string }[]);
    const detail = async (id: string) => (await call('get', `/pos/tabs/${id}`)).body as { id: string; lines: { id: string; status: string; paidOrderId: string | null }[] };
    const lineInput = () => ({ productId: pick(sellable), qty: String(int(1, 3)), ...(rand() < 0.3 ? { notes: 'tanpa gula' } : {}) });
    const ops: Record<string, () => Promise<void>> = {
      async openTab() {
        await tryPost('tab', '/pos/tabs', { warehouseId: W, ...(rand() < 0.75 ? { tableId: pick(tables), orderType: 'DINE_IN' } : { tableLabel: `Antre ${++seq}`, orderType: 'TAKEAWAY' }), lines: Array.from({ length: int(1, 3) }, lineInput) });
      },
      async addLines() {
        const t = await openTabs();
        if (t.length) await tryPost('tab-add', `/pos/tabs/${pick(t).id}/lines`, { lines: [lineInput()] });
      },
      async send() {
        const t = await openTabs();
        if (t.length) await tryPost('tab-send', `/pos/tabs/${pick(t).id}/send`);
      },
      async kitchen() {
        const k = (await call('get', `/pos/kitchen?warehouseId=${W}`)).body as { tickets: { items: { id: string; status: string }[] }[] };
        const items = k.tickets.flatMap((x) => x.items);
        if (!items.length) return;
        const it = pick(items);
        const next = it.status === 'NEW' ? 'PREPARING' : it.status === 'PREPARING' ? 'READY' : 'SERVED';
        await tryPost('kitchen', `/pos/kitchen/lines/${it.id}/status`, { status: rand() < 0.1 ? 'PREPARING' : next });
      },
      async voidLine() {
        const t = await openTabs();
        if (!t.length) return;
        const d = await detail(pick(t).id);
        const l = d.lines.filter((x) => x.status !== 'VOID' && !x.paidOrderId);
        if (l.length) await tryPost('tab-void', `/pos/tabs/${d.id}/lines/${pick(l).id}/void`, { reason: 'Pelanggan berubah pikiran' });
      },
      async pay() {
        const t = await openTabs();
        if (!t.length) return;
        const d = await detail(pick(t).id);
        const ready = d.lines.filter((x) => !x.paidOrderId && x.status !== 'VOID' && x.status !== 'DRAFT');
        if (!ready.length) return;
        const part = rand() < 0.4 ? { lineIds: [pick(ready).id] } : {};
        await tryPost('tab-pay', `/pos/tabs/${d.id}/pay`, { sessionId: session, ...part, payments: [{ method: 'CASH', amount: '2000000' }] });
      },
      async cancelTab() {
        const t = await openTabs();
        if (t.length && rand() < 0.5) await tryPost('tab-cancel', `/pos/tabs/${pick(t).id}/cancel`, { reason: 'Pelanggan pergi tanpa memesan' });
      },
      async online() {
        const ch = pick(CHANNELS);
        const ref = rand() < 0.15 && seq > 0 ? `R-${seed}-${int(1, seq)}` : `R-${seed}-${++seq}`; // kadang kirim ulang (idempoten)
        const r = await tryPost('online', '/online-orders', { channel: ch, externalRef: ref, customerName: 'Pelanggan', items: Array.from({ length: int(1, 2) }, () => ({ sku: pick(['MN-A', 'MN-B', 'MN-C', 'FB-AIR']), qty: String(int(1, 3)) })) }, { 'X-Api-Key': key });
        if (r.status === 201 || r.status === 200) {
          const id = r.body.tab?.id ?? r.body.id;
          if (id && !r.body.duplicate) {
            const d = await detail(id);
            if (rand() < 0.8) {
              for (const l of d.lines.filter((x) => x.status !== 'VOID')) for (const st of ['PREPARING', 'READY', 'SERVED']) await tryPost('kitchen', `/pos/kitchen/lines/${l.id}/status`, { status: st });
              await tryPost('online-done', `/pos/tabs/${id}/pay`, { sessionId: session });
            }
          }
        }
      },
      async settle() {
        const ch = pick(CHANNELS);
        const un = (await call('get', `/pos/online/unsettled?channel=${ch}`)).body as { items: { id: string; net: string }[] };
        if (!un.items.length) return;
        const chosen = un.items.slice(0, int(1, 3));
        const expected = chosen.reduce((a, i) => a + Number(i.net), 0);
        const diff = rand() < 0.3 ? int(-5, 5) * 100 : 0;
        await tryPost('settle', '/pos/online/settlements', { channel: ch, orderIds: chosen.map((i) => i.id), received: (expected + diff).toFixed(2), ...(diff ? { notes: 'Potongan promo platform' } : {}) });
      },
      async cancelSettle() {
        const l = (await call('get', '/pos/online/settlements')).body as { id: string; status: string }[];
        const posted = l.filter((s) => s.status === 'POSTED');
        if (posted.length && rand() < 0.5) await tryPost('settle-cancel', `/pos/online/settlements/${pick(posted).id}/cancel`);
      },
      async sale() {
        await tryPost('sale', '/pos/orders', { sessionId: session, lines: [{ productId: pick(sellable), qty: String(int(1, 2)) }], payments: [{ method: 'CASH', amount: '500000' }] });
      },
      async restock() {
        if (rand() < 0.5) await restock();
      },
    };
    const weighted: [string, number][] = [['openTab', 6], ['addLines', 4], ['send', 8], ['kitchen', 8], ['voidLine', 3], ['pay', 8], ['cancelTab', 2], ['online', 10], ['settle', 6], ['cancelSettle', 2], ['sale', 4], ['restock', 3]];
    const bag = weighted.flatMap(([k, w]) => Array(w).fill(k) as string[]);
    await check('awal');
    for (let i = 1; i <= STEPS; i++) {
      const name = pick(bag);
      await ops[name]();
      await check(`langkah ${i} (${name})`);
    }
    const tb = (await call('get', '/accounting/reports/trial-balance')).body;
    expect(tb.balanced).toBe(true);
    const health = (await call('get', '/accounting/health')).body as { checks: { key: string; status: string; message: string }[] };
    expect({ seed, healthErrors: health.checks.filter((c) => c.status === 'ERROR') }).toEqual({ seed, healthErrors: [] });
    expect(stats.ok).toBeGreaterThan(STEPS / 3);
    expect(byLabel['online']?.[0] ?? 0).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`benih ${seed}: ${stats.ok} operasi berhasil, ${stats.rejected} ditolak bisnis · ${Object.entries(byLabel).map(([k, [a, b]]) => `${k} ${a}/${a + b}`).join(' ')}`);
  }, 300_000);
});
