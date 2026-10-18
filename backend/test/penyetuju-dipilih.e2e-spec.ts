/**
 * Persetujuan: pemohon memilih penyetuju yang berwenang; hanya yang dipilih (atau Pemilik) yang bisa memutuskan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Persetujuan: pilih penyetuju berwenang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string; let admin1: string; let admin2: string; let buyer: string;
  let admin1Id: string; let admin2Id: string; let ownerId: string; let buyerId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const r = (await http.post('/api/auth/register').send({ companyName: 'PT Setuju', name: 'Pemilik', email: `pd-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body;
    owner = r.accessToken; ownerId = r.user.id;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `pd-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      const l = (await http.post('/api/auth/login').send({ email: `pd-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
      return { token: l.accessToken as string, id: l.user.id as string };
    };
    const a1 = await mk('ADMIN', 'admin1'); admin1 = a1.token; admin1Id = a1.id;
    const a2 = await mk('ADMIN', 'admin2'); admin2 = a2.token; admin2Id = a2.id;
    const b = await mk('PURCHASING', 'beli'); buyer = b.token; buyerId = b.id;
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 1000 }).expect(200);
  });
  afterAll(() => app.close());

  const newRequest = async () => {
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const sku = `AP${Math.floor(Math.random() * 1e8)}`;
    const prod = (await post('/api/products', { sku, name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: `S${sku.slice(2)}`, name: `Pemasok ${sku}` }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '10', price: '5000' }] }, buyer).expect(201)).body;
    const res = await post(`/api/purchase-orders/${po.id}/confirm`, {}, buyer);
    expect(res.status).toBe(409);
    return res.body.requestId as string;
  };

  it('daftar penyetuju berwenang: hanya Admin/Pemilik aktif, tanpa pemohon', async () => {
    const list = (await get('/api/approvals/approvers', buyer).expect(200)).body as { id: string; role: string }[];
    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual([ownerId, admin1Id, admin2Id].sort());
    expect(list.every((a) => ['OWNER', 'ADMIN'].includes(a.role))).toBe(true);
    expect(ids).not.toContain(buyerId);
  });

  it('tanpa pilihan: semua penyetuju boleh memutuskan', async () => {
    const id = await newRequest();
    await post(`/api/approvals/${id}/approve`, {}, admin2).expect(201);
  });

  it('dengan pilihan: hanya penyetuju terpilih (atau Pemilik) yang bisa memutuskan; pemohon saja yang bisa memilih; pilihan harus berwenang', async () => {
    const id = await newRequest();
    expect((await post(`/api/approvals/${id}/assign`, { approverId: buyerId }, buyer)).status).toBe(400); // bukan penyetuju berwenang
    expect((await post(`/api/approvals/${id}/assign`, { approverId: admin1Id }, admin2)).status).toBe(403); // bukan pemohon
    await post(`/api/approvals/${id}/assign`, { approverId: admin1Id }, buyer).expect(201);
    const seenBy2 = (await get('/api/approvals?status=PENDING', admin2).expect(200)).body as { id: string }[];
    expect(seenBy2.find((r) => r.id === id)).toBeUndefined(); // tidak muncul di antrean Admin lain
    expect((await post(`/api/approvals/${id}/approve`, {}, admin2)).status).toBe(403);
    expect((await post(`/api/approvals/${id}/reject`, { note: 'tidak' }, admin2)).status).toBe(403);
    const seenBy1 = (await get('/api/approvals?status=PENDING', admin1).expect(200)).body as { id: string; canDecide: boolean; assignedTo: string }[];
    expect(seenBy1.find((r) => r.id === id)).toMatchObject({ canDecide: true, assignedTo: 'admin1' });
    expect((await get('/api/approvals/pending-count', admin2).expect(200)).body.count).toBe(0);
    expect((await get('/api/approvals/pending-count', admin1).expect(200)).body.count).toBeGreaterThanOrEqual(1);
    await post(`/api/approvals/${id}/approve`, {}, admin1).expect(201);
    expect((await post(`/api/approvals/${id}/assign`, { approverId: admin2Id }, buyer)).status).toBe(409); // sudah diputuskan
  });

  it('Pemilik tetap dapat memutuskan permintaan yang ditujukan ke Admin', async () => {
    const id = await newRequest();
    await post(`/api/approvals/${id}/assign`, { approverId: admin1Id }, buyer).expect(201);
    await post(`/api/approvals/${id}/reject`, { note: 'ditolak pemilik' }, owner).expect(201);
  });
});
