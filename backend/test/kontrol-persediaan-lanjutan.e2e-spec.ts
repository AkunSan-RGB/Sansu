/**
 * Kontrol persediaan lanjutan (e2e): harga pokok stok masuk di atas rata-rata butuh persetujuan, penyesuaian masuk besar
 * diberitahukan ke Pemilik, pemecahan penyesuaian di bawah batas terdeteksi, pembuat transfer ≠ penerima,
 * selisih opname besar wajib beralasan, banner "belum aktif".
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol persediaan lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let wh: string; let wh2: string;
  let W: string; let W2: string; let P: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `kpl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `kpl-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Stok 3', name: 'P', email: `kpl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    wh = await login('WAREHOUSE', 'wh');
    wh2 = await login('WAREHOUSE', 'wh2');
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 999002, type: 'private' } } });
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    W2 = (await post(owner, '/api/warehouses', { code: 'GD2', name: 'Gudang Dua' }).expect(201)).body.id;
    P = (await post(owner, '/api/products', { sku: 'KPL-1', name: 'Barang Stok', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(day, -3), lines: [{ productId: P, qty: '1000', unitCost: '10000' }] }).expect(201);
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('belum ada pengaman: banner "belum aktif" lalu aktif setelah rekomendasi diterapkan', async () => {
    const r = (await get(owner, '/api/inventory-controls').expect(200)).body;
    expect(r.setup.active).toBe(false);
    await put(owner, '/api/approvals/policy', r.setup.recommended).expect(200);
    expect((await get(owner, '/api/inventory-controls').expect(200)).body.setup.active).toBe(true);
  });

  it('stok masuk dengan harga pokok jauh di atas rata-rata oleh Gudang menunggu persetujuan', async () => {
    const r = await post(wh, '/api/inventory/adjustments', { warehouseId: W, reason: 'OTHER', date: day, notes: 'Ketemu', lines: [{ productId: P, qty: '10', unitCost: '30000' }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    // harga wajar (≤ toleransi) langsung jalan
    await post(wh, '/api/inventory/adjustments', { warehouseId: W, reason: 'OTHER', date: day, notes: 'Ketemu', lines: [{ productId: P, qty: '10', unitCost: '10500' }] }).expect(201);
  });

  it('stok masuk besar oleh Gudang: Pemilik diberi tahu dan muncul di temuan', async () => {
    await put(owner, '/api/approvals/policy', { stockInCostTolerancePct: 0, stockAdjustment: 0 }).expect(200);
    const before = tg.outbox.length;
    await post(wh, '/api/inventory/adjustments', { warehouseId: W, reason: 'OTHER', date: day, notes: 'Ketemu banyak', lines: [{ productId: P, qty: '700', unitCost: '10000' }] }).expect(201);
    await wait();
    expect(tg.outbox.slice(before).filter((x) => x.chatId === '999002').length).toBe(1);
    const items = (await get(owner, '/api/inventory-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'ADJ_IN_LARGE')).toBe(true);
  });

  it('penyesuaian keluar dipecah-pecah di bawah batas terdeteksi', async () => {
    await put(owner, '/api/approvals/policy', { stockAdjustment: 3_000_000 }).expect(200);
    for (let i = 0; i < 2; i++) {
      await post(wh, '/api/inventory/adjustments', { warehouseId: W, reason: 'DAMAGED', date: day, notes: `Rusak ${i}`, lines: [{ productId: P, qty: '-200' }] }).expect(201); // Rp2 juta
    }
    const items = (await get(owner, '/api/inventory-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'ADJ_OUT_SPLIT')).toBe(true);
  });

  it('pembuat transfer tidak boleh menerimanya sendiri bila saklar menyala', async () => {
    await put(owner, '/api/approvals/policy', { transferSod: true }).expect(200);
    const t = (await post(wh, '/api/inventory/transfers', { fromWarehouseId: W, toWarehouseId: W2, mode: 'IN_TRANSIT', date: day, lines: [{ productId: P, qty: '5' }] }).expect(201)).body;
    await post(wh, `/api/inventory/transfers/${t.id}/receive`, {}).expect(403);
    await post(wh2, `/api/inventory/transfers/${t.id}/receive`, {}).expect(201);
  });

  it('selisih opname besar tanpa alasan ditolak; dengan catatan jalan', async () => {
    await put(owner, '/api/approvals/policy', { stockAdjustment: 0, stockCountSod: false, blindCount: false }).expect(200);
    const c = (await post(owner, '/api/inventory/counts', { warehouseId: W2, date: day }).expect(201)).body;
    const lines = (await get(owner, `/api/inventory/counts/${c.id}`).expect(200)).body.lines as { productId: string; systemQty: string }[];
    await put(owner, `/api/inventory/counts/${c.id}`, { lines: lines.map((l) => ({ productId: l.productId, countedQty: '0' })) }).expect(200);
    const sys = Number(lines.find((l) => l.productId === P)?.systemQty ?? 0);
    expect(sys * 10000).toBeLessThan(5_000_000); // transfer kecil → selisih kecil, tetap jalan
    await post(owner, `/api/inventory/counts/${c.id}/post`).expect(201);

    const c2 = (await post(owner, '/api/inventory/counts', { warehouseId: W, date: day }).expect(201)).body;
    await put(owner, `/api/inventory/counts/${c2.id}`, { lines: [{ productId: P, countedQty: '0' }] }).expect(200);
    await post(owner, `/api/inventory/counts/${c2.id}/post`).expect(400);
    await put(owner, `/api/inventory/counts/${c2.id}`, { notes: 'Barang hilang saat banjir', lines: [{ productId: P, countedQty: '0' }] }).expect(200);
    await post(owner, `/api/inventory/counts/${c2.id}/post`).expect(201);
  });
});
