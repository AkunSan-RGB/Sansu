/**
 * Persetujuan lewat tautan email pribadi (tanpa login) dan supplier favorit dengan persetujuan otomatis.
 * Pengiriman email sendiri tidak diuji di sini (SMTP mati pada lingkungan uji); token dibuat langsung seperti yang dikirim.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { signApprovalLink } from '../src/common/approvals/approval-link';

describe('Persetujuan lewat tautan & supplier favorit (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let ownerId: string;
  let finance: string;
  let gudang: string;
  let wh: string;
  let sup: string;
  let prod: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const link = (k: 'AR' | 'PR', r: string, u = ownerId) => signApprovalLink({ k, r, u });
  const poOf = async (t: string, total: number, supplierId = sup) => {
    const po = (await post(t, '/api/purchase-orders', { supplierId, warehouseId: wh, lines: [{ productId: prod, qty: '1', price: String(total) }] }).expect(201)).body;
    return po;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Tautan', name: 'Pemilik', email: `al-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    ownerId = (await get(owner, '/api/auth/me').expect(200)).body.id;
    await post(owner, '/api/users', { name: 'Keuangan', email: `al-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    await post(owner, '/api/users', { name: 'Gudang', email: `al-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    finance = await login(`al-f-${stamp}@uji.id`, 'keuangan123');
    gudang = await login(`al-g-${stamp}@uji.id`, 'gudang12345');
    wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    sup = (await post(owner, '/api/suppliers', { code: 'S1', name: 'Pemasok Biasa' }).expect(201)).body.id;
    prod = (await post(owner, '/api/products', { sku: 'MIE', name: 'Mie', sellPrice: '3500' }).expect(201)).body.id;
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 1_000_000, purchaseRequestAuto: 0 }).expect(200);
  });
  afterAll(() => app.close());

  it('PO di atas batas: ringkasan dibuka dari tautan, disetujui tanpa login, PO terkonfirmasi', async () => {
    const po = await poOf(finance, 5_000_000);
    const r = await post(finance, `/api/purchase-orders/${po.id}/confirm`);
    expect(r.status).toBe(409);
    const t = link('AR', r.body.requestId);
    const sum = (await http.get(`/api/public/approval-links/${t}`).expect(200)).body;
    expect(sum).toMatchObject({ kind: 'AR', pending: true, status: 'PENDING', requestedBy: 'Keuangan', approver: 'Pemilik' });
    expect(sum.title).toContain(po.number);
    // membuka tautan (GET) tidak mengubah apa pun
    expect((await get(owner, `/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('DRAFT');
    await http.post(`/api/public/approval-links/${t}/decide`).send({ approve: true }).expect(200);
    expect((await get(owner, `/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('CONFIRMED');
    // sekali pakai: permintaan sudah diputuskan
    const again = await http.post(`/api/public/approval-links/${t}/decide`).send({ approve: true });
    expect(again.status).toBe(409);
    expect((await http.get(`/api/public/approval-links/${t}`).expect(200)).body).toMatchObject({ pending: false, status: 'APPROVED' });
  });

  it('tolak lewat tautan wajib beralasan', async () => {
    const po = await poOf(finance, 6_000_000);
    const r = await post(finance, `/api/purchase-orders/${po.id}/confirm`);
    const t = link('AR', r.body.requestId);
    expect((await http.post(`/api/public/approval-links/${t}/decide`).send({ approve: false })).status).toBe(400);
    await http.post(`/api/public/approval-links/${t}/decide`).send({ approve: false, note: 'Terlalu mahal' }).expect(200);
    expect((await get(owner, `/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('DRAFT');
  });

  it('permintaan pembelian disetujui lewat tautan', async () => {
    const r = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: prod, qty: '5', supplierId: sup, estPrice: '2000' }] }).expect(201)).body;
    expect(r.status).toBe('SUBMITTED');
    const t = link('PR', r.id);
    const sum = (await http.get(`/api/public/approval-links/${t}`).expect(200)).body;
    expect(sum).toMatchObject({ kind: 'PR', pending: true, requestedBy: 'Gudang' });
    expect(sum.details.join(' ')).toContain('MIE');
    await http.post(`/api/public/approval-links/${t}/decide`).send({ approve: true }).expect(200);
    expect((await get(owner, `/api/purchase-requests/${r.id}`).expect(200)).body.status).toBe('APPROVED');
  });

  it('tautan palsu, kedaluwarsa, milik pengguna non-penyetuju, atau lintas tenant ditolak', async () => {
    const po = await poOf(finance, 7_000_000);
    const r = await post(finance, `/api/purchase-orders/${po.id}/confirm`);
    const good = link('AR', r.body.requestId);
    const [body, sig] = good.split('.');
    expect((await http.get('/api/public/approval-links/sembarang')).status).toBe(400);
    expect((await http.get(`/api/public/approval-links/${body}.${sig.slice(1)}x`)).status).toBe(400);
    const stale = signApprovalLink({ k: 'AR', r: r.body.requestId, u: ownerId }, Date.now() - 4 * 86_400_000);
    expect((await http.post(`/api/public/approval-links/${stale}/decide`).send({ approve: true })).status).toBe(400);
    // penyetuju harus pemilik/admin: token atas nama keuangan ditolak
    const financeId = (await get(finance, '/api/auth/me').expect(200)).body.id;
    expect((await http.post(`/api/public/approval-links/${link('AR', r.body.requestId, financeId)}/decide`).send({ approve: true })).status).toBe(400);
    // tenant lain tidak bisa melihat permintaan ini walau token memakai id yang sama
    const lain = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'X', email: `al-o-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const lainId = (await get(lain, '/api/auth/me').expect(200)).body.id;
    expect((await http.get(`/api/public/approval-links/${link('AR', r.body.requestId, lainId)}`)).status).toBe(404);
    // token yang sah tetap bisa dipakai untuk menolak (keputusan sekali pakai)
    expect((await http.post(`/api/public/approval-links/${good}/decide`).send({ approve: false, note: 'cek' })).status).toBe(200);
  });

  it('supplier favorit: hanya admin/pemilik yang menetapkan; PO di bawah batasnya otomatis, di atas tetap menunggu', async () => {
    await http.patch(`/api/suppliers/${sup}`).set(as(finance)).send({ isPreferred: true, autoApproveLimit: '50000000' }).expect(403);
    await http.post('/api/suppliers').set(as(gudang)).send({ code: 'X', name: 'Coba', isPreferred: true }).expect(403);
    await http.patch(`/api/suppliers/${sup}`).set(as(owner)).send({ autoApproveLimit: 'abc' }).expect(400);
    const fav = (await http.post('/api/suppliers').set(as(owner)).send({ code: 'FAV', name: 'Pemasok Favorit', isPreferred: true, autoApproveLimit: '8000000' }).expect(201)).body;
    expect(fav).toMatchObject({ isPreferred: true, autoApproveLimit: '8000000.00' });
    const small = await poOf(finance, 7_000_000, fav.id); // di atas batas umum (1 jt), di bawah batas favorit
    await post(finance, `/api/purchase-orders/${small.id}/confirm`).expect(201);
    const big = await poOf(finance, 9_000_000, fav.id);
    expect((await post(finance, `/api/purchase-orders/${big.id}/confirm`)).status).toBe(409);
    const biasa = await poOf(finance, 2_000_000);
    expect((await post(finance, `/api/purchase-orders/${biasa.id}/confirm`)).status).toBe(409); // bukan favorit
  });

  it('permintaan pembelian dari supplier favorit di bawah batasnya langsung disetujui', async () => {
    const fav = (await get(owner, '/api/suppliers?q=FAV').expect(200)).body[0];
    const r1 = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: prod, qty: '100', supplierId: fav.id, estPrice: '50000' }] }).expect(201)).body; // 5 jt
    expect(r1).toMatchObject({ status: 'APPROVED', autoApproved: true });
    const r2 = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: prod, qty: '100', supplierId: fav.id, estPrice: '100000' }] }).expect(201)).body; // 10 jt
    expect(r2.status).toBe('SUBMITTED');
    const r3 = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: prod, qty: '1', supplierId: sup, estPrice: '1000' }] }).expect(201)).body;
    expect(r3.status).toBe('SUBMITTED'); // supplier biasa
  });
});
