/**
 * Kontrol persediaan (e2e): rekonsiliasi nilai stok vs buku besar dan opname siklus (barang bernilai tinggi).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol persediaan: rekonsiliasi & opname siklus (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let W: string; let P: string; let P2: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string) => http.get(u).set(as(owner));
  const post = (u: string, b: object = {}) => http.post(u).set(as(owner)).send(b);
  const put = (u: string, b: object = {}) => http.put(u).set(as(owner)).send(b);
  const keys = async () => ((await get('/api/inventory-controls').expect(200)).body.items as { key: string }[]).map((i) => i.key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Rekon Stok', name: 'P', email: `rks-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'RK-1', name: 'Barang Mahal', baseUom: 'PCS', sellPrice: '200000' }).expect(201)).body.id;
    P2 = (await post('/api/products', { sku: 'RK-2', name: 'Barang Murah', baseUom: 'PCS', sellPrice: '2000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(day, -90), lines: [{ productId: P, qty: '100', unitCost: '100000' }, { productId: P2, qty: '10', unitCost: '1000' }] }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('stok awal terjurnal: nilai stok = buku besar; barang mahal ditandai opname siklus', async () => {
    const k = await keys();
    expect(k).not.toContain('STOCK_GL_DIFF');
    const items = (await get('/api/inventory-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    const cyc = items.find((i) => i.key === 'COUNT_CYCLE')!;
    expect(cyc.refs.some((r) => r.includes('RK-1'))).toBe(true);
    expect(cyc.refs.some((r) => r.includes('RK-2'))).toBe(false);
  });

  it('opname barang mahal menghilangkan tanda siklus', async () => {
    const c = (await post('/api/inventory/counts', { warehouseId: W, date: day }).expect(201)).body;
    await put(`/api/inventory/counts/${c.id}`, { lines: [{ productId: P, countedQty: '100' }, { productId: P2, countedQty: '10' }] }).expect(200);
    await post(`/api/inventory/counts/${c.id}/post`).expect(201);
    expect(await keys()).not.toContain('COUNT_CYCLE');
  });

  it('jurnal manual ke akun persediaan membuat selisih terdeteksi', async () => {
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string; systemKey?: string }[];
    const inv = accs.find((a) => a.systemKey === 'INVENTORY' || a.code === '1-1400')!;
    const cash = accs.find((a) => a.code === '1-1100')!;
    await post('/api/accounting/journals', { date: day, description: 'Koreksi uji', controlOverrideReason: 'Uji selisih', lines: [{ accountId: inv.id, debit: '2000000' }, { accountId: cash.id, credit: '2000000' }] }).expect(201);
    expect(await keys()).toContain('STOCK_GL_DIFF');
  });
});
