/**
 * Laporan pendukung Produksi (e2e): hasil dan biaya per perintah, pemakaian bahan vs resep, barang dalam proses,
 * dan pencocokan dengan buku besar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung produksi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}, t = owner) => http.post(u).set(as(t)).send(b);
  const rec = (r: Rep, key: string) => r.reconciliation.find((x) => x.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Konveksi Laporan', name: 'Pemilik', email: `lp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const mk = async (sku: string, body: object) => (await post('/api/products', { sku, sellPrice: '0', ...body }).expect(201)).body.id as string;
    const kain = await mk('KAIN', { name: 'Kain', baseUom: 'M' });
    const baju = await mk('BAJU', { name: 'Baju', baseUom: 'PCS', sellPrice: '150000' });
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: day, lines: [{ productId: kain, qty: '1000', unitCost: '10000' }] }).expect(201);
    const bom = (await post('/api/production/boms', { name: 'Baju', productId: baju, outputQty: '10', laborCost: '100000', overheadCost: '50000', lines: [{ productId: kain, qty: '15' }] }).expect(201)).body;
    // perintah 1: selesai dengan hasil 9 dari rencana 10
    const o1 = (await post('/api/production/orders', { bomId: bom.id, warehouseId: wh, batches: '1', date: day }).expect(201)).body;
    await post(`/api/production/orders/${o1.id}/start`, { date: day }).expect(201);
    await post(`/api/production/orders/${o1.id}/complete`, { date: day, outputQty: '9' }).expect(201);
    // perintah 2: berjalan (barang dalam proses)
    const o2 = (await post('/api/production/orders', { bomId: bom.id, warehouseId: wh, batches: '2', date: day }).expect(201)).body;
    await post(`/api/production/orders/${o2.id}/start`, { date: day }).expect(201);
  });
  afterAll(() => app.close());

  it('pencocokan buku besar cocok; rendemen, biaya, dan barang dalam proses sesuai', async () => {
    const r = (await get(`/api/accounting/support/mfg?from=${from}&to=${day}`).expect(200)).body as Rep;
    expect(r.reconciliation.map((x) => x.key)).toEqual(['mfg-start', 'mfg-done', 'mfg-wip', 'mfg-conversion']);
    for (const x of r.reconciliation.filter((y) => y.key !== 'mfg-conversion')) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 });
    // biaya konversi dibebankan 150.000 tetapi belum ada upah/overhead aktual dijurnal → selisih biaya produksi, bukan salah catat
    expect(rec(r, 'mfg-conversion')).toMatchObject({ ok: false, diff: 150_000 });
    expect(rec(r, 'mfg-start').left.value).toBe(150_000 + 300_000); // 15 m + 30 m × 10.000
    expect(rec(r, 'mfg-done').left.value).toBe(150_000 + 100_000 + 50_000);
    expect(rec(r, 'mfg-wip').left.value).toBe(300_000);
    const done = r.sections.find((s) => s.key === 'mfg-done')!.tables[0].rows;
    expect(done).toHaveLength(1);
    expect(done[0][6]).toBe(90); // rendemen 9 / 10
    expect(done[0][10]).toBe(300_000);
    const wip = r.sections.find((s) => s.key === 'mfg-wip')!.tables[0].rows;
    expect(wip).toHaveLength(1);
    expect(wip[0][4]).toBe(300_000);
    const usage = r.sections.find((s) => s.key === 'mfg-usage')!.tables[0].rows;
    expect(usage[0].slice(0, 5)).toEqual(['KAIN', 'Kain', 45, 45, 0]);
  });

  it('akses: peran gudang tidak boleh membuka laporan', async () => {
    await post('/api/users', { name: 'G', email: `lp-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    const g = (await http.post('/api/auth/login').send({ email: `lp-g-${stamp}@uji.id`, password: 'gudang12345' }).expect(200)).body.accessToken;
    await get(`/api/accounting/support/mfg?from=${from}&to=${day}`, g).expect(403);
  });
});
