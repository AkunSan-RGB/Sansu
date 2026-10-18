/**
 * Alur kerja lanjutan: kasus dibuka otomatis dari dokumen & stok minimum, dokumen turunan tertaut otomatis,
 * tahap boleh diperketat (tidak dilonggarkan), gerbang di dokumen berisiko, serta peringatan kredit.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Alur kerja lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const reg = async (model: string, tag: string) => {
    const r = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `wfl-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body;
    return r.accessToken as string;
  };
  let seq = 0;
  const user = async (owner: string, role: string, name: string) => {
    const tag = `${name}${++seq}`;
    await http.post('/api/users').set(as(owner)).send({ name, email: `wfl-${tag}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `wfl-${tag}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const call = (t: string) => ({
    get: (url: string) => http.get(url).set(as(t)),
    post: (url: string, body: object = {}) => http.post(url).set(as(t)).send(body),
    put: (url: string, body: object = {}) => http.put(url).set(as(t)).send(body),
    patch: (url: string, body: object = {}) => http.patch(url).set(as(t)).send(body),
  });
  type Case = { id: string; pipeline: string; stage: string; status: string; title: string; autoOpened: boolean };
  const cases = async (t: string) => (await call(t).get('/api/workflow/cases').expect(200)).body as Case[];

  it('pesanan baru membuka kasus otomatis; faktur dan lunas menyusul tanpa ditautkan manual', async () => {
    const owner = await reg('DAGANG', 'auto');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'A1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const cust = (await call(owner).post('/api/customers', { code: 'C1', name: 'Pelanggan' }).expect(201)).body.id;
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '100', unitCost: '5000' }] }).expect(201);
    await cases(owner); // titik awal ("since") ditetapkan

    const so = (await call(owner).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '2' }] }).expect(201)).body;
    const found = (await cases(owner)).find((c) => c.pipeline === 'DAGANG_PENJUALAN');
    expect(found).toMatchObject({ autoOpened: true, stage: 'PESANAN' });

    await call(owner).post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await call(owner).post('/api/invoices', { salesOrderId: so.id, date: today }).expect(201)).body;
    const k = (await cases(owner)).find((c) => c.id === found!.id)!;
    expect(k.stage).toBe('DITAGIH'); // faktur tertaut otomatis, tahap maju sendiri
    const detail = (await call(owner).get(`/api/workflow/cases/${k.id}`).expect(200)).body;
    expect(detail.links.map((l: { type: string }) => l.type)).toEqual(expect.arrayContaining(['SALES_ORDER', 'INVOICE']));
    const total = (await call(owner).get(`/api/invoices/${inv.id}`).expect(200)).body.total;
    await call(owner).post('/api/payments', { invoiceId: inv.id, amount: total, method: 'TRANSFER' }).expect(201);
    expect((await cases(owner)).find((c) => c.id === k.id)).toMatchObject({ stage: 'LUNAS', status: 'DONE' });
    // dokumen yang sama tidak membuka kasus kedua
    expect((await cases(owner)).filter((c) => c.pipeline === 'DAGANG_PENJUALAN')).toHaveLength(1);
    // lencana di dokumen
    const badge = (await call(owner).get(`/api/workflow/by-doc?type=INVOICE&id=${inv.id}`).expect(200)).body;
    expect(badge).toMatchObject({ caseId: k.id, stage: 'LUNAS' });
    // mematikan buka-otomatis menghentikan kasus baru
    await call(owner).put('/api/workflow/settings', { autoOpen: false }).expect(200);
    await call(owner).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '1' }] }).expect(201);
    expect((await cases(owner)).filter((c) => c.pipeline === 'DAGANG_PENJUALAN')).toHaveLength(1);
  });

  it('stok di bawah minimum membuka kasus restok; pulih sebelum dikerjakan menutupnya', async () => {
    const owner = await reg('RITEL', 'restok');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'R1', name: 'Sabun', baseUom: 'PCS', sellPrice: '5000' }).expect(201)).body.id;
    await call(owner).put('/api/inventory/minimums', { warehouseId: wh, items: [{ productId: prod, minQty: '10' }] }).expect(200);
    await cases(owner);
    const open = (await cases(owner)).find((c) => c.pipeline === 'RITEL_RESTOK');
    expect(open).toMatchObject({ autoOpened: true, status: 'ACTIVE' });
    expect(open!.title).toMatch(/R1/);
    await cases(owner);
    expect((await cases(owner)).filter((c) => c.pipeline === 'RITEL_RESTOK' && c.status === 'ACTIVE')).toHaveLength(1); // tidak ganda
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '50', unitCost: '3000' }] }).expect(201);
    expect((await cases(owner)).find((c) => c.id === open!.id)).toMatchObject({ status: 'CANCELLED' });
  });

  it('pengaturan: hanya memperketat; ditolak bila melonggarkan; hanya Admin; tercatat', async () => {
    const owner = await reg('DAGANG', 'atur');
    const sales = await user(owner, 'SALES', 'sales');
    const fin = await user(owner, 'FINANCE', 'fin');
    const defaults = (await call(owner).get('/api/workflow/settings').expect(200)).body;
    expect(defaults.settings).toMatchObject({ autoOpen: true, enforce: false });
    expect(defaults.defaults.length).toBeGreaterThan(0);
    // peran non-admin tidak boleh mengubah
    expect((await call(sales).put('/api/workflow/settings', { enforce: true })).status).toBe(403);
    expect((await call(fin).put('/api/workflow/settings', { enforce: true })).status).toBe(403);
    // melonggarkan ditolak: tambah peran di luar bawaan, hilangkan catatan wajib, longgarkan batas hari
    const pipe = defaults.defaults.find((p: { key: string }) => p.key === 'DAGANG_PENJUALAN');
    const stage = pipe.stages.find((s: { roles: string[]; next: string[]; terminal?: string }) => !s.terminal && s.roles.length && !s.roles.includes('HR'));
    const bad = await call(owner).put('/api/workflow/settings', { overrides: { DAGANG_PENJUALAN: { [stage.key]: { roles: [...stage.roles, 'HR'] } } } });
    expect(bad.status).toBe(400);
    const withSla = pipe.stages.find((x: { slaDays?: number }) => x.slaDays);
    const looser = await call(owner).put('/api/workflow/settings', { overrides: { DAGANG_PENJUALAN: { [withSla.key]: { slaDays: withSla.slaDays + 5 } } } });
    expect(looser.status).toBe(400);
    expect((await call(owner).put('/api/workflow/settings', { overrides: { DAGANG_PENJUALAN: { [withSla.key]: { slaDays: null } } } })).status).toBe(400);
    const bad2 = await call(owner).put('/api/workflow/settings', { overrides: { ALUR_TAK_ADA: { X: { requireNote: true } } } });
    expect(bad2.status).toBe(400);
    // memperketat: catatan wajib + pemeriksa berbeda + nama tahap
    const ok = await call(owner).put('/api/workflow/settings', { overrides: { DAGANG_PENJUALAN: { [stage.key]: { requireNote: true, sod: true, label: 'Tahap khusus kami' } } } }).expect(200);
    const eff = (await call(owner).get('/api/workflow/pipelines').expect(200)).body.find((p: { key: string }) => p.key === 'DAGANG_PENJUALAN');
    expect(eff.stages.find((s: { key: string }) => s.key === stage.key)).toMatchObject({ requireNote: true, sod: true, label: 'Tahap khusus kami' });
    expect(ok.body.settings.overrides.DAGANG_PENJUALAN[stage.key]).toMatchObject({ requireNote: true });
    // definisi bawaan tidak berubah
    expect((await call(owner).get('/api/workflow/settings').expect(200)).body.defaults.find((p: { key: string }) => p.key === 'DAGANG_PENJUALAN').stages.find((s: { key: string }) => s.key === stage.key).label).not.toBe('Tahap khusus kami');
  });

  it('alur wajib: produksi tidak bisa dimulai sebelum bahan siap', async () => {
    const owner = await reg('MANUFAKTUR', 'gerbang');
    const wh1 = await user(owner, 'WAREHOUSE', 'gudang');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const kain = (await call(owner).post('/api/products', { sku: 'KN', name: 'Kain', baseUom: 'M', sellPrice: '0' }).expect(201)).body.id;
    const baju = (await call(owner).post('/api/products', { sku: 'BJ', name: 'Baju', baseUom: 'PCS', sellPrice: '90000' }).expect(201)).body.id;
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: kain, qty: '100', unitCost: '10000' }] }).expect(201);
    const bom = (await call(owner).post('/api/production/boms', { name: 'Baju', productId: baju, outputQty: '10', laborCost: '100000', overheadCost: '50000', lines: [{ productId: kain, qty: '15' }] }).expect(201)).body;
    await cases(owner);
    const o = (await call(owner).post('/api/production/orders', { bomId: bom.id, warehouseId: wh, batches: '1', date: today }).expect(201)).body;
    const k = (await cases(owner)).find((c) => c.pipeline === 'MFG_PRODUKSI')!;
    expect(k).toMatchObject({ autoOpened: true, stage: 'PERMINTAAN' });
    // sebelum "alur wajib" menyala, perilaku lama tidak berubah; setelah menyala, produksi menunggu bahan siap
    await call(owner).put('/api/workflow/settings', { enforce: true }).expect(200);
    const blocked = await call(owner).post(`/api/production/orders/${o.id}/start`, { date: today });
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/alur kerja/i);
    await call(wh1).post(`/api/workflow/cases/${k.id}/advance`, { to: 'MATERIAL_SIAP', note: 'Kain 100 meter tersedia di rak' }).expect(201);
    await call(owner).post(`/api/production/orders/${o.id}/start`, { date: today }).expect(201);
    expect((await call(owner).get(`/api/workflow/cases/${k.id}`).expect(200)).body.stage).toBe('PRODUKSI'); // maju otomatis dari status produksi
    // dokumen tanpa kasus tidak dihalangi
    const o2 = (await call(owner).post('/api/production/orders', { bomId: bom.id, warehouseId: wh, batches: '1', date: today }).expect(201)).body;
    await call(owner).put('/api/workflow/settings', { autoOpen: false }).expect(200);
    await call(owner).post(`/api/production/orders/${o2.id}/start`, { date: today }).expect(201);
  });

  it('peringatan kredit: piutang pelanggan di atas batas kredit muncul pada kasus yang berjalan', async () => {
    const owner = await reg('DAGANG', 'kredit');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'K1', name: 'Barang', baseUom: 'PCS', sellPrice: '100000' }).expect(201)).body.id;
    const cust = (await call(owner).post('/api/customers', { code: 'C9', name: 'Toko Kredit', creditLimit: '1000000' }).expect(201)).body.id;
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '50', unitCost: '5000' }] }).expect(201);
    await cases(owner);
    const so = (await call(owner).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '2' }] }).expect(201)).body;
    await call(owner).post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await call(owner).post('/api/invoices', { salesOrderId: so.id, date: today }).expect(201);
    await call(owner).patch(`/api/customers/${cust}`, { creditLimit: '50000' }).expect(200);
    await cases(owner);
    const alerts = (await call(owner).get('/api/workflow/alerts').expect(200)).body as { kind: string }[];
    expect(alerts.map((a) => a.kind)).toContain('KREDIT');
  });

  it('jenis usaha lain tidak melihat alur baru (FMCG kanvas, F&B online hanya untuk jenisnya)', async () => {
    const fmcg = await reg('FMCG', 'fmcg');
    const fnb = await reg('FNB', 'fnb');
    const f = (await call(fmcg).get('/api/workflow/pipelines').expect(200)).body.map((p: { key: string }) => p.key);
    const n = (await call(fnb).get('/api/workflow/pipelines').expect(200)).body.map((p: { key: string }) => p.key);
    expect(f).toEqual(expect.arrayContaining(['FMCG_KANVAS', 'FMCG_RETUR']));
    expect(f).not.toContain('FNB_ONLINE');
    expect(n).toContain('FNB_ONLINE');
    expect(n).not.toContain('FMCG_KANVAS');
  });
});
