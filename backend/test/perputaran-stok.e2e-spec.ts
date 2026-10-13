/**
 * Analisis perputaran stok (e2e): barang cepat, lambat, tidak bergerak, baru, dan habis padahal laku
 * dikenali dari mutasi stok nyata; hanya peran gudang/keuangan yang boleh melihat.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Perputaran stok (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let sales: string;
  let W: string;
  let customerId: string;
  const stamp = Date.now();
  const as = (t = token) => ({ Authorization: `Bearer ${t}` });
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const ids: Record<string, string> = {};

  const stock = async (sku: string, qty: string, daysAgo: number) => {
    ids[sku] = (await post('/api/products', { sku, name: `Barang ${sku}`, sellPrice: '10000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(todayJakarta(), -daysAgo), lines: [{ productId: ids[sku], qty, unitCost: '5000' }] }).expect(201);
  };
  const sell = async (sku: string, qty: string) => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId: W, lines: [{ productId: ids[sku], qty, price: '10000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so.id }).expect(201);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Perputaran', name: 'Pemilik', email: `pp-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'Sales', email: `pp-s-${stamp}@uji.id`, password: 'sales12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `pp-s-${stamp}@uji.id`, password: 'sales12345' }).expect(200)).body.accessToken;
    W = (await http.get('/api/warehouses').set(as())).body[0].id;
    customerId = (await post('/api/customers', { code: 'C-PP', name: 'Pelanggan', paymentTermDays: 30 }).expect(201)).body.id;
    await stock('PP-FAST', '20', 40);
    await stock('PP-SLOW', '100', 40);
    await stock('PP-DEAD', '10', 300);
    await stock('PP-NEW', '10', 0);
    await stock('PP-OUT', '5', 40);
    await sell('PP-FAST', '16'); // sisa 4 → 40 hari: 0,4/hari → cakupan 10 hari
    await sell('PP-SLOW', '1');
    await sell('PP-OUT', '5');
  });
  afterAll(() => app.close());

  it('mengelompokkan barang sesuai kecepatan keluarnya', async () => {
    const r = (await http.get('/api/inventory/movement-analysis').set(as()).expect(200)).body;
    expect(r.model).toBe('DAGANG');
    const cls = (sku: string) => r.items.find((i: { sku: string }) => i.sku === sku)?.cls;
    expect(cls('PP-FAST')).toBe('FAST');
    expect(cls('PP-SLOW')).toBe('SLOW');
    expect(cls('PP-DEAD')).toBe('DEAD');
    expect(cls('PP-NEW')).toBe('NEW');
    expect(cls('PP-OUT')).toBe('OUT');
    expect(r.summary.DEAD.count).toBe(1);
    expect(r.summary.DEAD.value).toBe(50000); // 10 × 5.000
    // yang perlu tindakan (habis padahal laku) paling atas
    expect(r.items[0].cls).toBe('OUT');
  });

  it('Sales tidak boleh melihat nilai & perputaran stok', async () => {
    await http.get('/api/inventory/movement-analysis').set(as(sales)).expect(403);
  });
});
