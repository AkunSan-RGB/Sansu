/**
 * Permintaan pembelian: gudang mengajukan → disetujui (atau otomatis bila nilainya kecil) → dijadikan PO per supplier,
 * serta usulan pembelian dari stok minimum.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Permintaan pembelian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let gudang: string;
  let wh: string;
  let supA: string;
  let supB: string;
  let p1: string;
  let p2: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Minta Beli', name: 'Pemilik', email: `pr-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Gudang', email: `pr-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    gudang = await login(`pr-g-${stamp}@uji.id`, 'gudang12345');
    wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    supA = (await post(owner, '/api/suppliers', { code: 'SA', name: 'Pemasok A' }).expect(201)).body.id;
    supB = (await post(owner, '/api/suppliers', { code: 'SB', name: 'Pemasok B' }).expect(201)).body.id;
    p1 = (await post(owner, '/api/products', { sku: 'MIE', name: 'Mie', sellPrice: '3500' }).expect(201)).body.id;
    p2 = (await post(owner, '/api/products', { sku: 'KOPI', name: 'Kopi', sellPrice: '1500' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('diajukan gudang → menunggu; hanya admin yang memutuskan; tolak butuh alasan', async () => {
    const r = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p1, qty: '100', supplierId: supA, estPrice: '2000' }] }).expect(201)).body;
    expect(r.status).toBe('SUBMITTED');
    expect(r.number).toMatch(/^PR/);
    expect(r.estimatedTotal).toBe(200000);
    await post(gudang, `/api/purchase-requests/${r.id}/approve`).expect(403);
    await post(owner, `/api/purchase-requests/${r.id}/reject`).expect(400); // alasan wajib
    const rej = (await post(owner, `/api/purchase-requests/${r.id}/reject`, { note: 'Stok masih cukup' }).expect(201)).body;
    expect(rej).toMatchObject({ status: 'REJECTED', decisionNote: 'Stok masih cukup' });
    await post(owner, `/api/purchase-requests/${r.id}/approve`).expect(400); // sudah diputuskan
  });

  it('diajukan pemilik langsung disetujui, lalu dijadikan PO per supplier dengan harga terakhir bila kosong', async () => {
    // PO lama memberi harga terakhir untuk Kopi dari Pemasok B
    const old = (await post(owner, '/api/purchase-orders', { supplierId: supB, warehouseId: wh, lines: [{ productId: p2, qty: '10', price: '800' }] }).expect(201)).body;
    expect(old.status).toBe('DRAFT');
    const r = (
      await post(owner, '/api/purchase-requests', {
        warehouseId: wh,
        submit: true,
        lines: [
          { productId: p1, qty: '50', supplierId: supA, estPrice: '2000' },
          { productId: p2, qty: '20', supplierId: supB },
        ],
      }).expect(201)
    ).body;
    expect(r.status).toBe('APPROVED');
    expect(r.estimateComplete).toBe(true);
    expect(r.estimatedTotal).toBe(50 * 2000 + 20 * 800);
    const c = (await post(gudang, `/api/purchase-requests/${r.id}/convert`).expect(201)).body;
    expect(c.status).toBe('CONVERTED');
    const orders = new Set(c.lines.map((l: { order: { id: string } }) => l.order.id));
    expect(orders.size).toBe(2); // satu PO per supplier
    const poB = (await get(owner, `/api/purchase-orders/${c.lines.find((l: { supplierId: string }) => l.supplierId === supB).order.id}`).expect(200)).body;
    expect(Number(poB.lines[0].qty)).toBe(20);
    expect(Number(poB.lines[0].price)).toBe(800);
    expect(poB.status).toBe('DRAFT');
    await post(gudang, `/api/purchase-requests/${r.id}/convert`).expect(400); // tidak bisa dua kali
    await post(owner, `/api/purchase-requests/${r.id}/cancel`).expect(400); // sudah dipesan
  });

  it('konversi: supplier / harga wajib diketahui, bisa ditimpa per baris', async () => {
    const r = (await post(owner, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p1, qty: '5' }] }).expect(201)).body;
    const miss = await post(owner, `/api/purchase-requests/${r.id}/convert`);
    expect(miss.status).toBe(400);
    expect(miss.body.message).toContain('supplier');
    const noPrice = await post(owner, `/api/purchase-requests/${r.id}/convert`, { lines: [{ lineId: r.lines[0].id, supplierId: supA }] });
    expect(noPrice.status === 201 || /harga/i.test(noPrice.body.message)).toBe(true);
    const done =
      noPrice.status === 201
        ? noPrice.body
        : (await post(owner, `/api/purchase-requests/${r.id}/convert`, { lines: [{ lineId: r.lines[0].id, supplierId: supA, price: '2500' }] }).expect(201)).body;
    expect(done.status).toBe('CONVERTED');
    const failed = await get(owner, `/api/purchase-requests/${r.id}`).expect(200);
    expect(failed.body.lines[0].order.number).toMatch(/^PO/);
  });

  it('persetujuan otomatis untuk nilai kecil; batas hanya diatur admin', async () => {
    await http.put('/api/approvals/policy').set(as(gudang)).send({ purchaseRequestAuto: 500000 }).expect(403);
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseRequestAuto: 500000 }).expect(200);
    const small = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p1, qty: '100', estPrice: '2000' }] }).expect(201)).body; // 200 rb
    expect(small).toMatchObject({ status: 'APPROVED', autoApproved: true });
    const big = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p1, qty: '1000', estPrice: '2000' }] }).expect(201)).body; // 2 jt
    expect(big.status).toBe('SUBMITTED');
    const unknown = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p2, qty: '1' }] }).expect(201)).body;
    // harga terakhir Kopi diketahui (800) → nilai 800 ≤ batas → otomatis
    expect(unknown.status).toBe('APPROVED');
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseRequestAuto: 0 }).expect(200);
    const off = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p1, qty: '1', estPrice: '1' }] }).expect(201)).body;
    expect(off.status).toBe('SUBMITTED');
    // draft dulu lalu diajukan
    const d = (await post(gudang, '/api/purchase-requests', { warehouseId: wh, lines: [{ productId: p1, qty: '2' }] }).expect(201)).body;
    expect(d.status).toBe('DRAFT');
    expect((await post(gudang, `/api/purchase-requests/${d.id}/submit`).expect(201)).body.status).toBe('SUBMITTED');
    // peminta boleh membatalkan miliknya
    expect((await post(gudang, `/api/purchase-requests/${d.id}/cancel`).expect(201)).body.status).toBe('CANCELLED');
  });

  it('usulan dari stok minimum memperhitungkan stok, PO berjalan, dan permintaan yang sudah ada', async () => {
    const p3 = (await post(owner, '/api/products', { sku: 'TEH', name: 'Teh', sellPrice: '1000' }).expect(201)).body.id;
    await http.put('/api/inventory/minimums').set(as(owner)).send({ warehouseId: wh, items: [{ productId: p3, minQty: '100' }] }).expect(200);
    const find = async () => ((await get(owner, `/api/purchase-requests/suggestions?warehouseId=${wh}`).expect(200)).body as { productId: string; suggestedQty: number; onOrder: number; requested: number }[]).find((s) => s.productId === p3);
    expect(await find()).toMatchObject({ onOrder: 0, requested: 0, suggestedQty: 200 }); // sampai 2× minimum
    const po = (await post(owner, '/api/purchase-orders', { supplierId: supA, warehouseId: wh, lines: [{ productId: p3, qty: '60', price: '500' }] }).expect(201)).body;
    expect(await find()).toMatchObject({ onOrder: 60, suggestedQty: 140 });
    await post(owner, `/api/purchase-orders/${po.id}/cancel`).expect(201);
    const r = (await post(owner, '/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: p3, qty: '150' }] }).expect(201)).body;
    expect(await find()).toBeUndefined(); // 150 ≥ minimum → tidak perlu diusulkan lagi
    await post(owner, `/api/purchase-requests/${r.id}/cancel`).expect(201);
    expect(await find()).toMatchObject({ requested: 0 });
  });

  it('validasi: gudang/produk/supplier asing, qty tak sah, dan ID sembarang', async () => {
    const bad = (b: object) => post(owner, '/api/purchase-requests', { warehouseId: wh, lines: [{ productId: p1, qty: '1' }], ...b });
    expect((await bad({ lines: [] })).status).toBe(400);
    expect((await bad({ lines: [{ productId: p1, qty: '0' }] })).status).toBe(400);
    expect((await bad({ lines: [{ productId: p1, qty: 'abc' }] })).status).toBe(400);
    expect((await bad({ warehouseId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await bad({ lines: [{ productId: p1, qty: '1', supplierId: '00000000-0000-4000-8000-000000000000' }] })).status).toBe(400);
    expect((await get(owner, '/api/purchase-requests/bukan-uuid')).status).toBe(400);
    expect((await get(owner, '/api/purchase-requests/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get(owner, '/api/purchase-requests?status=ASAL')).status).toBe(400);
  });

  it('tenant lain tidak bisa melihat permintaan', async () => {
    const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'X', email: `pr-o-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const mine = (await get(owner, '/api/purchase-requests').expect(200)).body[0];
    expect((await get(other, `/api/purchase-requests/${mine.id}`)).status).toBe(404);
    expect((await get(other, '/api/purchase-requests').expect(200)).body).toEqual([]);
  });
});
