/**
 * Pesanan online / pesan-antar (e2e): kunci API penerima pesanan, idempotensi, antrean dapur, bayar oleh platform (piutang platform + komisi),
 * pencairan dana (selisih beralasan, batal), isolasi antar perusahaan, dan larangan retur kasir untuk pesanan online.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Order = { id: string; total: string; subtotal: string; taxAmount: string; platformFee: string; channel: string | null; externalRef: string | null; payments: { method: string; amount: string }[] };

describe('Pesanan online (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  let W: string;
  let kopi: string;
  let menu: string;
  let session: string;
  let key: string;
  let keyId: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const inbound = (b: object, k = key) => http.post('/api/online-orders').set({ 'X-Api-Key': k }).send(b);
  const bal = async (code: string) => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const stock = async (p: string) => Number((await get(owner, `/api/inventory/balances?productId=${p}&warehouseId=${W}`).expect(200)).body[0]?.qty ?? 0);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Online', name: 'Pemilik', email: `on-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    await post(owner, '/api/users', { name: 'Kasir', email: `on-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    cashier = await login(`on-k-${stamp}@uji.id`, 'kasir12345');
    const mk = async (sku: string, body: object) => (await post(owner, '/api/products', { sku, sellPrice: '0', ...body }).expect(201)).body.id as string;
    kopi = await mk('BB-KOPI', { name: 'Biji Kopi', baseUom: 'GR' });
    const susu = await mk('BB-SUSU', { name: 'Susu', baseUom: 'ML' });
    menu = await mk('MN-KOPSU', { name: 'Kopi Susu', baseUom: 'PCS', sellPrice: '24000', madeToOrder: true });
    await post(owner, '/api/production/boms', { name: 'Resep Kopi Susu', productId: menu, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: '18' }, { productId: susu, qty: '150' }] }).expect(201);
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: kopi, qty: '1000', unitCost: '140' }, { productId: susu, qty: '3000', unitCost: '18' }] }).expect(201);
    session = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('komisi platform: bawaan 20%, admin bisa mengubah, nilai tidak sah ditolak, kasir hanya membaca', async () => {
    expect((await get(cashier, '/api/pos/online/settings').expect(200)).body.commissions).toMatchObject({ GOFOOD: 20, GRABFOOD: 20, WEBSITE: 0 });
    await http.patch('/api/pos/online/settings').set(as(owner)).send({ commissions: { GOFOOD: 18 } }).expect(200);
    expect((await get(owner, '/api/pos/online/settings').expect(200)).body.commissions).toMatchObject({ GOFOOD: 18, GRABFOOD: 20 });
    await http.patch('/api/pos/online/settings').set(as(owner)).send({ commissions: { GOFOOD: 60 } }).expect(400);
    await http.patch('/api/pos/online/settings').set(as(owner)).send({ commissions: { TOKOPEDIA: 5 } }).expect(400);
    await http.patch('/api/pos/online/settings').set(as(cashier)).send({ commissions: { GOFOOD: 1 } }).expect(403);
  });

  it('kunci API: hanya admin yang membuat; kunci tampil sekali; tanpa kunci atau kunci salah ditolak', async () => {
    await post(cashier, '/api/pos/online/keys', { name: 'X', warehouseId: W }).expect(403);
    const k = (await post(owner, '/api/pos/online/keys', { name: 'Aplikasi GoFood', warehouseId: W }).expect(201)).body;
    key = k.key;
    keyId = k.id;
    expect(key).toMatch(/^snk_/);
    const list = (await get(owner, '/api/pos/online/keys').expect(200)).body as Record<string, unknown>[];
    expect(JSON.stringify(list)).not.toContain(key); // hanya awalan, bukan kunci
    expect(list.find((x) => x.id === keyId)).toMatchObject({ name: 'Aplikasi GoFood', keyPrefix: key.slice(0, 8), revokedAt: null });
    await http.post('/api/online-orders').send({}).expect(401);
    await inbound({ channel: 'GOFOOD', externalRef: 'X', items: [{ sku: 'MN-KOPSU', qty: '1' }] }, 'snk_salah-salah-salah-salah-salah').expect(401);
  });

  let tabId: string;
  it('pesanan masuk lewat API: langsung ke dapur; kiriman ulang tidak menggandakan; SKU tak dikenal dan stok kurang ditolak utuh', async () => {
    await inbound({ channel: 'GOFOOD', externalRef: 'GF-0', items: [{ sku: 'TIDAK-ADA', qty: '1' }] }).expect(400);
    await inbound({ channel: 'GOFOOD', externalRef: 'GF-0', items: [{ sku: 'MN-KOPSU', qty: '100' }] }).expect(400); // 100 × 150 ml > 3000
    await inbound({ channel: 'GOFOOD', externalRef: 'GF-0', items: [{ sku: 'MN-KOPSU', qty: '0' }] }).expect(400);
    await inbound({ channel: 'TOKOPEDIA', externalRef: 'GF-0', items: [{ sku: 'MN-KOPSU', qty: '1' }] }).expect(400);
    expect((await get(owner, '/api/pos/tabs?status=OPEN').expect(200)).body).toHaveLength(0); // penolakan tidak meninggalkan pesanan

    const r = (await inbound({ channel: 'GOFOOD', externalRef: 'GF-1', customerName: 'Budi', items: [{ sku: 'mn-kopsu', qty: '2', notes: 'Kurang manis' }] }).expect(201)).body;
    expect(r.duplicate).toBe(false);
    expect((r.lines as { sku: string; qty: string; status: string }[]).map((l) => ({ ...l, qty: Number(l.qty) }))).toEqual([{ sku: 'MN-KOPSU', qty: 2, status: 'NEW' }]);
    tabId = r.id;
    const again = (await inbound({ channel: 'GOFOOD', externalRef: 'GF-1', items: [{ sku: 'MN-KOPSU', qty: '5' }] }).expect(201)).body;
    expect(again).toMatchObject({ duplicate: true, id: tabId });
    expect((await get(owner, '/api/pos/tabs?status=OPEN').expect(200)).body).toHaveLength(1);

    const k = (await get(owner, `/api/pos/kitchen?warehouseId=${W}`).expect(200)).body as { tickets: { number: string; tableLabel: string; channel: string; items: { notes: string }[] }[] };
    expect(k.tickets[0]).toMatchObject({ number: r.number, tableLabel: 'GoFood GF-1', channel: 'GOFOOD' });
    expect(k.tickets[0].items[0].notes).toBe('Kurang manis');
    const st = (await http.get('/api/online-orders/GOFOOD/GF-1').set({ 'X-Api-Key': key }).expect(200)).body;
    expect(st).toMatchObject({ number: r.number, status: 'OPEN' });
    await http.get('/api/online-orders/GOFOOD/TIDAK-ADA').set({ 'X-Api-Key': key }).expect(404);
    expect(await stock(kopi)).toBe(1000); // stok baru berkurang saat dibayar
  });

  let order: Order;
  it('selesai: dibayar platform otomatis; piutang platform, komisi, pajak, dan HPP tercatat; pesanan online tidak dibayar sebagian', async () => {
    const k = (await get(owner, `/api/pos/kitchen?warehouseId=${W}`).expect(200)).body as { tickets: { items: { id: string }[] }[] };
    await post(owner, `/api/pos/kitchen/lines/${k.tickets[0].items[0].id}/status`, { status: 'SERVED' }).expect(201);
    const recv0 = await bal('1-1140');
    const fee0 = await bal('6-2460');
    const sales0 = await bal('4-1000');
    const pb0 = await bal('2-1210');
    const bank0 = await bal('1-1200');
    order = (await post(cashier, `/api/pos/tabs/${tabId}/pay`, { sessionId: session }).expect(201)).body as Order;
    expect(order.channel).toBe('GOFOOD');
    expect(order.externalRef).toBe('GF-1');
    expect(Number(order.subtotal)).toBe(48000);
    expect(Number(order.taxAmount)).toBe(4800); // PB1 10%
    expect(Number(order.platformFee)).toBeCloseTo(8640, 2); // 18% × 48.000
    expect(order.payments).toEqual([expect.objectContaining({ method: 'PLATFORM' })]);
    expect(Number(order.payments[0].amount)).toBe(52800);
    expect(await bal('1-1140')).toBeCloseTo(recv0 + 52800 - 8640, 2);
    expect(await bal('6-2460')).toBeCloseTo(fee0 + 8640, 2);
    expect(await bal('4-1000')).toBeCloseTo(sales0 + 48000, 2);
    expect(await bal('2-1210')).toBeCloseTo(pb0 + 4800, 2);
    expect(await bal('1-1200')).toBeCloseTo(bank0, 2); // belum ada uang masuk ke bank
    expect(await stock(kopi)).toBe(1000 - 2 * 18);
    expect((await get(owner, `/api/pos/tabs/${tabId}`).expect(200)).body.status).toBe('PAID');
    await http.get('/api/online-orders/GOFOOD/GF-1').set({ 'X-Api-Key': key }).expect(200);
    // sesi kasir: pesanan platform tidak menambah uang laci
    const cur = (await get(cashier, '/api/pos/sessions/current').expect(200)).body;
    expect(Number(cur.summary.expectedCash)).toBeCloseTo(100000, 2);
    expect(Number(cur.summary.byMethod.PLATFORM)).toBeCloseTo(52800, 2);
  });

  it('larangan: metode platform di kasir biasa, retur kasir untuk pesanan online', async () => {
    await post(cashier, '/api/pos/orders', { sessionId: session, lines: [{ productId: menu, qty: '1' }], payments: [{ method: 'PLATFORM', amount: '100000' }] }).expect(400);
    const r = await post(owner, `/api/pos/orders/${order.id}/return`, { all: true, reason: 'pelanggan komplain via platform' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('Pesanan online');
  });

  it('pesanan online dicatat manual oleh kasir; nomor ganda, tanpa nomor, atau dengan meja ditolak; pesanan online tidak dibayar per baris', async () => {
    const mkTab = (b: object) => post(cashier, '/api/pos/tabs', { warehouseId: W, ...b });
    await mkTab({ channel: 'GRABFOOD' }).expect(400); // nomor pesanan platform wajib
    await mkTab({ externalRef: 'GR-7' }).expect(400); // nomor tanpa kanal
    const t = (await mkTab({ channel: 'GRABFOOD', externalRef: 'GR-7', lines: [{ productId: menu, qty: '1' }, { productId: menu, qty: '1' }] }).expect(201)).body;
    expect(t).toMatchObject({ orderType: 'DELIVERY', channel: 'GRABFOOD', externalRef: 'GR-7', tableLabel: 'GrabFood GR-7' });
    await mkTab({ channel: 'GRABFOOD', externalRef: 'GR-7' }).expect(400); // sudah tercatat
    await post(cashier, `/api/pos/tabs/${t.id}/send`).expect(201);
    await post(cashier, `/api/pos/tabs/${t.id}/pay`, { sessionId: session, lineIds: [t.lines[0].id] }).expect(400);
    await post(cashier, `/api/pos/tabs/${t.id}/pay`, { sessionId: session }).expect(201);
  });

  let orderIds: string[];
  it('pencairan: daftar belum cair, dana cocok melunasi piutang dan masuk bank; tidak bisa dicairkan dua kali', async () => {
    const u = (await get(owner, '/api/pos/online/unsettled').expect(200)).body as { items: { id: string; net: string; channel: string }[]; totals: { net: string } };
    expect(u.items).toHaveLength(2);
    orderIds = u.items.filter((i) => i.channel === 'GOFOOD').map((i) => i.id);
    expect(orderIds).toEqual([order.id]);
    const net = Number(u.items.find((i) => i.id === order.id)!.net);
    expect(net).toBeCloseTo(52800 - 8640, 2);
    // kanal campur ditolak
    await post(owner, '/api/pos/online/settlements', { channel: 'GOFOOD', orderIds: u.items.map((i) => i.id), received: '1000' }).expect(400);
    const recv0 = await bal('1-1140');
    const bank0 = await bal('1-1200');
    const s = (await post(owner, '/api/pos/online/settlements', { channel: 'GOFOOD', orderIds, received: String(net) }).expect(201)).body;
    expect(Number(s.difference)).toBe(0);
    expect(await bal('1-1200')).toBeCloseTo(bank0 + net, 2);
    expect(await bal('1-1140')).toBeCloseTo(recv0 - net, 2);
    await post(owner, '/api/pos/online/settlements', { channel: 'GOFOOD', orderIds, received: String(net) }).expect(400); // sudah dicairkan
    expect(((await get(owner, '/api/pos/online/unsettled?channel=GOFOOD').expect(200)).body as { items: unknown[] }).items).toHaveLength(0);
  });

  it('pencairan dengan selisih wajib beralasan; selisih masuk akun komisi; pencairan bisa dibatalkan', async () => {
    const u = (await get(owner, '/api/pos/online/unsettled?channel=GRABFOOD').expect(200)).body as { items: { id: string; net: string }[] };
    const ids = u.items.map((i) => i.id);
    const net = Number(u.items[0].net);
    await post(owner, '/api/pos/online/settlements', { channel: 'GRABFOOD', orderIds: ids, received: String(net - 2000) }).expect(400); // alasan wajib
    const fee0 = await bal('6-2460');
    const recv0 = await bal('1-1140');
    const bank0 = await bal('1-1200');
    const s = (await post(owner, '/api/pos/online/settlements', { channel: 'GRABFOOD', orderIds: ids, received: String(net - 2000), notes: 'Potongan promo platform' }).expect(201)).body;
    expect(Number(s.difference)).toBe(-2000);
    expect(await bal('6-2460')).toBeCloseTo(fee0 + 2000, 2);
    expect(await bal('1-1140')).toBeCloseTo(recv0 - net, 2);
    expect(await bal('1-1200')).toBeCloseTo(bank0 + net - 2000, 2);
    // batal: semua kembali
    await post(owner, `/api/pos/online/settlements/${s.id}/cancel`).expect(201);
    expect(await bal('6-2460')).toBeCloseTo(fee0, 2);
    expect(await bal('1-1140')).toBeCloseTo(recv0, 2);
    expect(await bal('1-1200')).toBeCloseTo(bank0, 2);
    expect(((await get(owner, '/api/pos/online/unsettled?channel=GRABFOOD').expect(200)).body as { items: unknown[] }).items).toHaveLength(1);
    await post(owner, `/api/pos/online/settlements/${s.id}/cancel`).expect(400);
    const list = (await get(owner, '/api/pos/online/settlements').expect(200)).body as { status: string }[];
    expect(list.map((x) => x.status).sort()).toEqual(['CANCELLED', 'POSTED']);
  });

  it('kunci dicabut: pesanan baru ditolak; kunci perusahaan lain tidak melihat pesanan perusahaan ini', async () => {
    const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'P', email: `on2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken as string;
    const wh2 = (await get(other, '/api/warehouses').expect(200)).body[0].id;
    await post(other, '/api/apps/pos/install').expect(201);
    const k2 = (await post(other, '/api/pos/online/keys', { name: 'Kunci lain', warehouseId: wh2 }).expect(201)).body.key as string;
    await http.get('/api/online-orders/GOFOOD/GF-1').set({ 'X-Api-Key': k2 }).expect(404); // pesanan milik perusahaan pertama
    await post(owner, `/api/pos/online/keys/${keyId}/revoke`).expect(201);
    await inbound({ channel: 'GOFOOD', externalRef: 'GF-9', items: [{ sku: 'MN-KOPSU', qty: '1' }] }).expect(401);
    await post(owner, `/api/pos/online/keys/${keyId}/revoke`).expect(404);
  });

  it('jenis usaha selain F&B tidak bisa mencatat pesanan online', async () => {
    const dag = (await http.post('/api/auth/register').send({ companyName: 'PT Dagang', name: 'P', email: `on3-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    await post(dag, '/api/apps/pos/install').expect(201);
    const wh = (await get(dag, '/api/warehouses').expect(200)).body[0].id;
    await post(dag, '/api/pos/tabs', { warehouseId: wh, channel: 'GOFOOD', externalRef: 'GF-1' }).expect(400);
  });
});
