/**
 * Kontrol persediaan (e2e): Pemilik diberi tahu saat penyesuaian/selisih opname besar, selisih opname besar butuh persetujuan,
 * penghitung ≠ pemosting, opname buta, transfer menggantung, halaman temuan Kontrol persediaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol persediaan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let adm: string; let fin: string; let wh: string;
  let W: string; let W2: string; let P: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `kps-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `kps-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Stok 2', name: 'P', email: `kps-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    adm = await login('ADMIN', 'adm');
    fin = await login('FINANCE', 'fin');
    wh = await login('WAREHOUSE', 'wh');
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 999001, type: 'private' } } });
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    W2 = (await post(owner, '/api/warehouses', { code: 'GD2', name: 'Gudang Dua' }).expect(201)).body.id;
    P = (await post(owner, '/api/products', { sku: 'KPS-1', name: 'Barang Stok', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(day, -3), lines: [{ productId: P, qty: '1000', unitCost: '10000' }] }).expect(201);
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('penyesuaian stok keluar bernilai besar oleh Gudang: Pemilik diberi tahu dan muncul di Kontrol persediaan', async () => {
    const before = tg.outbox.length;
    await post(wh, '/api/inventory/adjustments', { warehouseId: W, reason: 'DAMAGED', date: day, notes: 'Banjir gudang', lines: [{ productId: P, qty: '-600' }] }).expect(201); // Rp6 juta
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '999001');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Penyesuaian stok keluar');
    const items = (await get(owner, '/api/inventory-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'ADJ_OUT_LARGE')).toBe(true);
  });

  it('selisih opname besar: Keuangan menunggu persetujuan; penghitung ≠ pemosting; opname buta', async () => {
    await put(owner, '/api/approvals/policy', { stockAdjustment: 1_000_000, stockCountSod: true, blindCount: true }).expect(200);
    const c = (await post(wh, '/api/inventory/counts', { warehouseId: W, date: day }).expect(201)).body;
    // opname buta: penghitung (Gudang) tidak melihat stok sistem; Keuangan melihat
    const seen = (await get(wh, `/api/inventory/counts/${c.id}`).expect(200)).body;
    expect(seen.blindCount).toBe(true);
    expect(Number(seen.lines[0].systemQty)).toBe(0);
    expect(Number((await get(fin, `/api/inventory/counts/${c.id}`).expect(200)).body.lines[0].systemQty)).toBe(400);
    await put(wh, `/api/inventory/counts/${c.id}`, { lines: [{ productId: P, countedQty: '300' }] }).expect(200); // kurang 100 = Rp1 juta
    // Keuangan memposting selisih bernilai besar → butuh persetujuan
    const r = await post(fin, `/api/inventory/counts/${c.id}/post`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    expect((await get(owner, `/api/inventory/counts/${c.id}`).expect(200)).body.status).toBe('POSTED');
    // pemisahan penghitung dan pemosting: Admin yang mengisi tidak boleh memposting sendiri
    const c2 = (await post(adm, '/api/inventory/counts', { warehouseId: W, date: day }).expect(201)).body;
    await put(adm, `/api/inventory/counts/${c2.id}`, { lines: [{ productId: P, countedQty: '300' }] }).expect(200);
    expect((await post(adm, `/api/inventory/counts/${c2.id}/post`)).status).toBe(403);
    await put(owner, '/api/approvals/policy', { stockAdjustment: 0, stockCountSod: false, blindCount: false }).expect(200);
    await post(fin, `/api/inventory/counts/${c2.id}/post`).expect(201);
  });

  it('transfer yang menggantung di perjalanan menjadi temuan dan tugas Gudang', async () => {
    await post(owner, '/api/inventory/transfers', { fromWarehouseId: W, toWarehouseId: W2, mode: 'IN_TRANSIT', date: addDays(day, -5), lines: [{ productId: P, qty: '5' }] }).expect(201);
    const items = (await get(owner, '/api/inventory-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'TRANSFER_STUCK')).toBe(true);
    const tasks = (await get(wh, '/api/tasks/mine').expect(200)).body as { key: string }[];
    expect(tasks.some((t) => t.key === 'transfer-stuck')).toBe(true);
  });
});
