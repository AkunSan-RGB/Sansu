/**
 * Ambang kesimpulan laporan pendukung: bawaan, diubah per perusahaan, divalidasi, dibatasi peran, dan terisolasi antar perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Conclusion = { findings: { level: string; title: string }[] };

describe('Ambang laporan pendukung (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let other: string;
  let fin: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, b: object) => http.put('/api/settings/support-insights').set(as(t)).send(b);
  const margin = async (t: string) => {
    const r = (await get(t, `/api/accounting/support/sales?from=${from}&to=${day}`).expect(200)).body as { conclusion: Conclusion };
    return r.conclusion.findings.find((f) => f.title.startsWith('Penjualan neto'))!.level;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = async (name: string, tag: string) => (await http.post('/api/auth/register').send({ companyName: name, name: 'P', email: `ab-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    owner = await reg('PT Ambang A', 'a');
    other = await reg('PT Ambang B', 'b');
    await post(owner, '/api/users', { name: 'Fin', email: `ab-f-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `ab-f-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    // penjualan dengan margin 50% di kedua perusahaan
    for (const t of [owner, other]) {
      const wh = (await get(t, '/api/warehouses').expect(200)).body[0].id;
      const cus = (await post(t, '/api/customers', { code: 'C1', name: 'Pelanggan', paymentTermDays: 30 }).expect(201)).body.id;
      const prod = (await post(t, '/api/products', { sku: 'P1', name: 'Barang', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
      const po = (await post(t, '/api/purchase-orders/quick', { supplierId: (await post(t, '/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id, warehouseId: wh, receiveNow: true, lines: [{ productId: prod, qty: '100', price: '10000' }] }).expect(201)).body;
      await post(t, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'F-1' }).expect(201);
      const so = (await post(t, '/api/sales-orders', { customerId: cus, warehouseId: wh, lines: [{ productId: prod, qty: '10' }] }).expect(201)).body;
      await post(t, `/api/sales-orders/${so.id}/confirm`).expect(201);
      await post(t, '/api/invoices', { salesOrderId: so.id }).expect(201);
    }
  });
  afterAll(() => app.close());

  it('bawaan tersedia dan margin 50% hanya info', async () => {
    const r = (await get(owner, '/api/settings/support-insights').expect(200)).body;
    expect(r.values).toEqual(r.defaults);
    expect(r.defaults.marginWarnPct).toBe(10);
    expect(await margin(owner)).toBe('info');
  });

  it('mengubah ambang mengubah kesimpulan, hanya untuk perusahaan itu', async () => {
    const r = (await put(owner, { marginWarnPct: 60 }).expect(200)).body;
    expect(r.values.marginWarnPct).toBe(60);
    expect(r.values.returnPct).toBe(5); // lainnya tetap
    expect(await margin(owner)).toBe('warning');
    expect(await margin(other)).toBe('info');
  });

  it('nilai tidak sah, kunci asing, dan kritis lebih kecil dari perhatian ditolak', async () => {
    await put(owner, { marginWarnPct: 500 }).expect(400);
    await put(owner, { marginWarnPct: 'abc' }).expect(400);
    await put(owner, { tidakAda: 1 }).expect(400);
    await put(owner, { agingWarnPct: 30, agingDangerPct: 20 }).expect(400);
    await put(owner, { posRepeatSessions: 1 }).expect(400);
    expect((await get(owner, '/api/settings/support-insights').expect(200)).body.values.agingWarnPct).toBe(20); // penolakan tidak menyimpan setengah-setengah
  });

  it('Keuangan boleh melihat tetapi tidak mengubah', async () => {
    await get(fin, '/api/settings/support-insights').expect(200);
    await put(fin, { marginWarnPct: 5 }).expect(403);
  });

  it('kembali ke standar', async () => {
    const r = (await put(owner, { reset: true }).expect(200)).body;
    expect(r.values).toEqual(r.defaults);
    expect(await margin(owner)).toBe('info');
  });
});
