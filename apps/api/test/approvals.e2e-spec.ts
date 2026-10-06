/** Persetujuan transaksi bernilai besar: pesanan pembelian dan jurnal manual dari peran yang tidak berwenang */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Persetujuan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let warehouseId: string;
  let productId: string;
  let supplierId: string;
  let cashId: string;
  let capitalId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const newPo = async (qty: string, price = '10000') => (await post(finance, '/api/purchase-orders', { supplierId, warehouseId, lines: [{ productId, qty, price }] }).expect(201)).body;
  const pending = async () => (await get(owner, '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string; title: string; status: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Persetujuan', name: 'Pemilik', email: `ap-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `ap-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `ap-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    warehouseId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    productId = (await post(owner, '/api/products', { sku: 'AP-1', name: 'Barang', sellPrice: '20000' }).expect(201)).body.id;
    supplierId = (await post(owner, '/api/suppliers', { code: 'S', name: 'Pemasok' }).expect(201)).body.id;
    const accs = (await get(owner, '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    cashId = accs.find((a) => a.code === '1-1100')!.id;
    capitalId = accs.find((a) => a.code === '3-1000')!.id;
  });
  afterAll(() => app.close());

  it('tanpa batas (bawaan) semua berjalan seperti biasa', async () => {
    const po = await newPo('500', '10000'); // 5,55 juta
    await post(finance, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    expect((await pending()).length).toBe(0);
  });

  it('hanya admin/pemilik yang bisa mengatur batas; nilai tak sah ditolak', async () => {
    await http.put('/api/approvals/policy').set(as(finance)).send({ purchaseOrder: 1 }).expect(403);
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: -5 }).expect(400);
    const p = (await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 1000000, manualJournal: 5000000 }).expect(200)).body;
    expect(p).toEqual({ purchaseOrder: 1000000, manualJournal: 5000000 });
  });

  it('pesanan di bawah batas langsung dikonfirmasi; di atas batas menunggu persetujuan', async () => {
    const small = await newPo('10', '10000'); // 111.000
    await post(finance, `/api/purchase-orders/${small.id}/confirm`).expect(201);
    const big = await newPo('200', '10000'); // 2,22 juta
    const r1 = await post(finance, `/api/purchase-orders/${big.id}/confirm`);
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('APPROVAL_REQUIRED');
    const r2 = await post(finance, `/api/purchase-orders/${big.id}/confirm`); // diulang: tidak membuat permintaan ganda
    expect(r2.status).toBe(409);
    expect(r2.body.requestId).toBe(r1.body.requestId);
    expect((await get(owner, `/api/purchase-orders/${big.id}`).expect(200)).body.status).toBe('DRAFT');
    const list = await pending();
    expect(list.filter((x) => x.kind === 'PURCHASE_ORDER')).toHaveLength(1);
    expect((await get(owner, '/api/approvals/pending-count').expect(200)).body.count).toBe(1);
    expect((await get(finance, '/api/approvals/pending-count').expect(200)).body.count).toBe(0);
  });

  it('peran tidak berwenang tidak bisa memutuskan; pemilik menyetujui dan pesanan terkonfirmasi', async () => {
    const [req] = await pending();
    await post(finance, `/api/approvals/${req.id}/approve`).expect(403);
    await post(finance, `/api/approvals/${req.id}/reject`, { note: 'x' }).expect(403);
    const done = (await post(owner, `/api/approvals/${req.id}/approve`, { note: 'Silakan' }).expect(201)).body;
    expect(done.status).toBe('APPROVED');
    expect(done.resultRef).toMatch(/^PO\//);
    const po = (await get(owner, '/api/purchase-orders').expect(200)).body.find((p: { number: string }) => p.number === done.resultRef);
    expect(po.status).toBe('CONFIRMED');
    await post(owner, `/api/approvals/${req.id}/approve`).expect(409); // sudah diputuskan
    expect((await pending()).length).toBe(0);
  });

  it('pemilik tidak terkena batas; penolakan wajib beralasan dan pesanan tetap draft', async () => {
    const mine = await newPo('300', '10000');
    await post(owner, `/api/purchase-orders/${mine.id}/confirm`).expect(201); // pemilik langsung
    const other = await newPo('250', '10000');
    const r = await post(finance, `/api/purchase-orders/${other.id}/confirm`);
    expect(r.status).toBe(409);
    await post(owner, `/api/approvals/${r.body.requestId}/reject`, {}).expect(400);
    await post(owner, `/api/approvals/${r.body.requestId}/reject`, { note: 'Harga terlalu tinggi' }).expect(201);
    expect((await get(owner, `/api/purchase-orders/${other.id}`).expect(200)).body.status).toBe('DRAFT');
    const all = (await get(finance, '/api/approvals?status=ALL').expect(200)).body as { status: string; decisionNote: string | null }[];
    expect(all.find((x) => x.status === 'REJECTED')!.decisionNote).toBe('Harga terlalu tinggi');
  });

  it('jurnal manual bernilai besar: tidak diposting sampai disetujui, lalu terposting dan seimbang', async () => {
    const body = { date: new Date().toISOString().slice(0, 10), description: 'Setoran modal besar', lines: [{ accountId: cashId, debit: '8000000' }, { accountId: capitalId, credit: '8000000' }] };
    const before = ((await get(owner, '/api/accounting/journals').expect(200)).body as unknown[]).length;
    const r = await post(finance, '/api/accounting/journals', body);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    expect(((await get(owner, '/api/accounting/journals').expect(200)).body as unknown[]).length).toBe(before);
    const approved = (await post(owner, `/api/approvals/${r.body.requestId}/approve`).expect(201)).body;
    expect(approved.resultRef).toMatch(/^JU\//);
    expect(((await get(owner, '/api/accounting/journals').expect(200)).body as unknown[]).length).toBe(before + 1);
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
    // di bawah batas langsung terposting
    await post(finance, '/api/accounting/journals', { ...body, lines: [{ accountId: cashId, debit: '1000' }, { accountId: capitalId, credit: '1000' }] }).expect(201);
  });

  it('pemohon bisa membatalkan permintaannya sendiri; orang lain tidak', async () => {
    const body = { date: new Date().toISOString().slice(0, 10), description: 'Jurnal batal', lines: [{ accountId: cashId, debit: '9000000' }, { accountId: capitalId, credit: '9000000' }] };
    const r = await post(finance, '/api/accounting/journals', body);
    await post(owner, `/api/approvals/${r.body.requestId}/cancel`).expect(403);
    await post(finance, `/api/approvals/${r.body.requestId}/cancel`).expect(201);
    await post(owner, `/api/approvals/${r.body.requestId}/approve`).expect(409);
  });

  it('dua persetujuan serentak: hanya satu yang berhasil dan pesanan hanya dikonfirmasi sekali', async () => {
    const po = await newPo('400', '10000');
    const r = await post(finance, `/api/purchase-orders/${po.id}/confirm`);
    const [a, b] = await Promise.all([post(owner, `/api/approvals/${r.body.requestId}/approve`), post(owner, `/api/approvals/${r.body.requestId}/approve`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await get(owner, `/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('CONFIRMED');
  });

  it('batas dimatikan (0): peran tidak berwenang kembali bebas', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 0 }).expect(200);
    const po = await newPo('900', '10000');
    await post(finance, `/api/purchase-orders/${po.id}/confirm`).expect(201);
  });
});
