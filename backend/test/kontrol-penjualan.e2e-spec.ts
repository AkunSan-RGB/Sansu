/**
 * Kontrol alur penjualan (e2e): faktur hanya atas barang yang dikirim Gudang, pengiriman buta, alasan batal pesanan/surat jalan,
 * tugas Gudang/Penagihan, temuan tinjauan Pemilik.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kontrol penjualan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string; let wh: string; let sls: string;
  let whId: string; let prod: string; let cust: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ksl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `ksl-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const newSo = async (qty = '5', discountPct?: string) => {
    const so = (await post(sls, '/api/sales-orders', { customerId: cust, warehouseId: whId, date: day, lines: [{ productId: prod, qty, ...(discountPct ? { discountPct } : {}) }] }).expect(201)).body;
    await post(sls, `/api/sales-orders/${so.id}/confirm`).expect(201);
    return so as { id: string; number: string; lines: { id: string }[] };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Jual', name: 'P', email: `ksl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    fin = await login('FINANCE', 'fin');
    wh = await login('WAREHOUSE', 'wh');
    sls = await login('SALES', 'sls');
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'KSL-1', name: 'Barang Jual', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    cust = (await post(owner, '/api/customers', { code: 'C-KSL', name: 'Pelanggan Uji' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: whId, reason: 'OPENING', date: day, lines: [{ productId: prod, qty: '500', unitCost: '5000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('faktur oleh Keuangan ditolak sebelum barang dikirim Gudang; setelah surat jalan boleh', async () => {
    const so = await newSo();
    const r = await post(fin, '/api/invoices', { salesOrderId: so.id, date: day });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('belum dikirim Gudang');
    await post(wh, `/api/sales-orders/${so.id}/deliver`, {}).expect(201);
    expect((await post(fin, '/api/invoices', { salesOrderId: so.id, date: day })).status).toBe(201);
  });

  it('pengiriman buta: Gudang wajib mengisi jumlah kemas; selisih menahan pengiriman', async () => {
    await put(owner, '/api/approvals/policy', { blindDelivery: true }).expect(200);
    const so = await newSo('5');
    // jumlah pesanan disembunyikan dari Gudang
    const seen = (await get(wh, `/api/sales-orders/${so.id}`).expect(200)).body;
    expect(seen.blindDelivery).toBe(true);
    expect(Number(seen.lines[0].qty)).toBe(0);
    const r = await post(wh, `/api/sales-orders/${so.id}/deliver`, {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('pengiriman buta');
    const bad = await post(wh, `/api/sales-orders/${so.id}/deliver`, { lines: [{ orderLineId: so.lines[0].id, qty: '4' }] });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('tidak sama dengan pesanan');
    await post(wh, `/api/sales-orders/${so.id}/deliver`, { lines: [{ orderLineId: so.lines[0].id, qty: '5' }] }).expect(201);
    await put(owner, '/api/approvals/policy', { blindDelivery: false }).expect(200);
  });

  it('pembatalan pesanan terkonfirmasi dan surat jalan oleh staf wajib beralasan; tugas Gudang/Penagihan; temuan Pemilik', async () => {
    const so = await newSo();
    const tasks = (await get(wh, '/api/tasks/mine').expect(200)).body as { key: string }[];
    expect(tasks.some((t) => t.key === 'so-awaiting-delivery')).toBe(true);
    expect((await post(fin, `/api/sales-orders/${so.id}/cancel`, {})).status).toBe(400);
    await post(fin, `/api/sales-orders/${so.id}/cancel`, { reason: 'Pelanggan membatalkan pesanan' }).expect(201);

    const so2 = await newSo();
    const dn = (await post(wh, `/api/sales-orders/${so2.id}/deliver`, {}).expect(201)).body;
    const finTasks = (await get(fin, '/api/tasks/mine').expect(200)).body as { key: string }[];
    expect(finTasks.some((t) => t.key === 'dn-awaiting-invoice')).toBe(true);
    expect((await post(fin, `/api/deliveries/${dn.id}/cancel`, {})).status).toBe(400);
    await post(fin, `/api/deliveries/${dn.id}/cancel`, { reason: 'Barang salah kirim' }).expect(201);

    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    expect(items.find((f) => f.key === 'SO_CANCELLED_AFTER_CONFIRM')?.refs.join()).toContain('Pelanggan membatalkan pesanan');
    expect(items.find((f) => f.key === 'DN_CANCELLED')?.refs.join()).toContain('Barang salah kirim');
  });

  it('diskon besar muncul sebagai temuan', async () => {
    const so = await newSo('2', '25');
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    expect(items.find((f) => f.key === 'DISCOUNT_HEAVY')?.refs.join()).toContain(so.number);
  });
});
