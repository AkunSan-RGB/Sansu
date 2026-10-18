/**
 * Kontrak harga pemasok: maker-checker, periode tidak tumpang tindih, PO di atas harga kontrak ditahan
 * (Admin/Pemilik boleh melewati dengan jejak audit), kontrak jauh di atas harga beli terakhir ditandai.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Kontrak harga pemasok (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const addYear = new Date(Date.parse(today) + 365 * 86400000).toISOString().slice(0, 10);
  let owner: string; let buyer: string; let fin: string; let acct: string;
  let sup: string; let prod: string; let wh: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Prinsipal', name: 'P', email: `kh-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `kh-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `kh-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    buyer = await mk('PURCHASING', 'beli');
    fin = await mk('FINANCE', 'fin');
    acct = await mk('ACCOUNTANT', 'akuntan');
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    prod = (await post('/api/products', { sku: 'KC1', name: 'Kecap 600ml', baseUom: 'BOTOL', sellPrice: '15000' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'PRN', name: 'Prinsipal Kecap' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const po = (price: string, t = owner, extra: object = {}) => post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '100', price, ...extra }] }, t);

  it('kontrak: dibuat Pembelian, baru berlaku setelah disetujui orang lain; periode tidak boleh tumpang tindih', async () => {
    expect((await post('/api/price-agreements', { supplierId: sup, productId: prod, price: '9000', validFrom: today, validTo: addYear }, fin)).status).toBe(403); // Keuangan tidak membuat kontrak
    expect((await post('/api/price-agreements', { supplierId: sup, productId: prod, price: '0', validFrom: today, validTo: addYear }, buyer)).status).toBe(400);
    expect((await post('/api/price-agreements', { supplierId: sup, productId: prod, price: '9000', validFrom: addYear, validTo: today }, buyer)).status).toBe(400);
    const a = (await post('/api/price-agreements', { supplierId: sup, productId: prod, price: '9000', validFrom: today, validTo: addYear }, buyer).expect(201)).body;
    expect(a.status).toBe('PENDING');
    // belum aktif → PO harga berapa pun lolos
    await po('12000').expect(201);
    expect((await post('/api/price-agreements', { supplierId: sup, productId: prod, price: '8000', validFrom: today, validTo: addYear }, buyer)).status).toBe(400); // tumpang tindih
    expect((await post(`/api/price-agreements/${a.id}/approve`, {}, buyer)).status).toBe(403); // peran tidak berhak
    expect((await post(`/api/price-agreements/${a.id}/approve`, {}, acct)).status).toBe(403);
    await post(`/api/price-agreements/${a.id}/approve`, {}, fin).expect(201);
    expect((await post(`/api/price-agreements/${a.id}/approve`, {}, fin)).status).toBe(400); // sudah diputuskan
  });

  it('PO di atas harga kontrak ditolak; di bawah/sama lolos; diskon dihitung; Admin/Pemilik melewati dengan audit', async () => {
    const over = await po('9500', buyer);
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toMatch(/kontrak harga/i);
    await po('9000', buyer).expect(201);
    await po('8500', buyer).expect(201);
    await po('10000', buyer, { discountPct: '10' }).expect(201); // 10.000 − 10% = 9.000
    // satuan lain: 1 dus = 12 botol → harga per dus dibagi 12
    expect((await po('120000', buyer, { uom: 'BOTOL' })).status).toBe(400);
    // Pemilik boleh melewati; tercatat
    await po('9500', owner).expect(201);
    const lookup = (await get(`/api/price-agreements/lookup?supplierId=${sup}&productId=${prod}`, buyer).expect(200)).body;
    expect(lookup.price).toBe('9000.00');
  });

  it('daftar menandai kontrak jauh di atas harga beli terakhir; kontrak bisa diakhiri', async () => {
    const sup2 = (await post('/api/suppliers', { code: 'P2', name: 'Pemasok Dua' }).expect(201)).body.id;
    const prod2 = (await post('/api/products', { sku: 'KC2', name: 'Saus', baseUom: 'BOTOL', sellPrice: '20000' }).expect(201)).body.id;
    await post('/api/purchase-orders', { supplierId: sup2, warehouseId: wh, lines: [{ productId: prod2, qty: '10', price: '5000' }] }).expect(201);
    const a = (await post('/api/price-agreements', { supplierId: sup2, productId: prod2, price: '8000', validFrom: today, validTo: addYear }, buyer).expect(201)).body;
    const row = (await get('/api/price-agreements', acct).expect(200)).body.find((r: { id: string }) => r.id === a.id);
    expect(row.suspicious).toBe(true);
    expect(row.overLastPct).toBeGreaterThan(20);
    expect((await post(`/api/price-agreements/${a.id}/end`, { reason: 'x' }, buyer)).status).toBe(400); // alasan terlalu pendek
    await post(`/api/price-agreements/${a.id}/end`, { reason: 'Kontrak dibatalkan prinsipal' }, buyer).expect(201);
    // setelah berakhir, kontrak baru untuk periode yang sama boleh
    await post('/api/price-agreements', { supplierId: sup2, productId: prod2, price: '5500', validFrom: today, validTo: addYear }, buyer).expect(201);
  });
});
