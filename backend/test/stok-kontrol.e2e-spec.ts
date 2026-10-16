/**
 * Kontrol stok (e2e): stok opname tidak bisa dibukukan dua kali walau diklik serentak,
 * dan transaksi stok / pembayaran tidak boleh bertanggal di masa depan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol stok (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let W: string;
  let P: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const qty = async () => {
    const r = await http.get('/api/inventory/balances').query({ warehouseId: W, productId: P }).set(as()).expect(200);
    return Number(r.body[0]?.qty ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Stok', name: 'Pemilik', email: `ks-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    W = (await http.get('/api/warehouses').set(as())).body[0].id;
    P = (await http.post('/api/products').set(as()).send({ sku: 'KS-1', name: 'Barang uji', sellPrice: '5000', category: 'Lain-lain' }).expect(201)).body.id;
    await http.post('/api/inventory/adjustments').set(as()).send({ warehouseId: W, reason: 'OPENING', date: addDays(todayJakarta(), -3), lines: [{ productId: P, qty: '100', unitCost: '2000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('stok opname diposting serentak: hanya satu yang berhasil, selisih tidak ganda', async () => {
    const c = (await http.post('/api/inventory/counts').set(as()).send({ warehouseId: W, date: todayJakarta() }).expect(201)).body;
    await http.put(`/api/inventory/counts/${c.id}`).set(as()).send({ lines: [{ productId: P, countedQty: '90' }] }).expect(200);
    const rs = await Promise.all([1, 2, 3, 4].map(() => http.post(`/api/inventory/counts/${c.id}/post`).set(as())));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(3);
    expect(await qty()).toBe(90);
  });

  it('tanggal masa depan ditolak untuk penyesuaian stok', async () => {
    const future = addDays(todayJakarta(), 5);
    await http.post('/api/inventory/adjustments').set(as()).send({ warehouseId: W, reason: 'OPENING', date: future, lines: [{ productId: P, qty: '5', unitCost: '2000' }] }).expect(400);
    expect(await qty()).toBe(90);
  });
});
