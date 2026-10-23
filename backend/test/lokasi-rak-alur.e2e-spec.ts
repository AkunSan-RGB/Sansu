/**
 * Lokasi rak tahap 2 (e2e): rak tujuan di penerimaan barang, penyesuaian, dan transfer; daftar ambil (FEFO, urutan jalan, saran = pembukuan),
 * daftar ambil dari pesanan penjualan, dan penolakan rak yang salah.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

type Row = { binId: string; binCode: string; binKind: string; sku: string; lotNo: string | null; qty: string; productId: string };
type Pick = { binId: string; binCode: string; lotNo: string | null; qty: string; sku: string; binKind: string };

describe('Lokasi rak tahap 2: alur dan daftar ambil (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let other: string;
  let W: string;
  let W2: string;
  let P: string;
  let Q: string;
  let sup: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}, t = owner) => http.post(u).set(as(t)).send(b);
  const rows = async (wid: string, pid?: string) => (await get(`/api/inventory/bins/stock?warehouseId=${wid}${pid ? `&productId=${pid}` : ''}`).expect(200)).body.rows as Row[];
  const stock = async (pid: string, wid: string) => Number((await get(`/api/inventory/balances?productId=${pid}&warehouseId=${wid}`).expect(200)).body[0]?.qty ?? 0);
  const binId = async (wid: string, code: string) => ((await get(`/api/inventory/bins?warehouseId=${wid}`).expect(200)).body.bins as { id: string; code: string }[]).find((b) => b.code === code)!.id;
  const poOf = async (product: string, wid: string, qty: string) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wid, date: today, lines: [{ productId: product, qty, price: '1000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return po;
  };
  const receive = async (product: string, wid: string, qty: string, extra: object = {}, status = 201) => {
    const po = await poOf(product, wid, qty);
    return post(`/api/purchase-orders/${po.id}/receipts`, { date: today, lines: [{ orderLineId: po.lines[0].id, qty, ...extra }] }).expect(status);
  };
  const plan = async (wid: string, items: string) => (await get(`/api/inventory/bins/pick-plan?warehouseId=${wid}&items=${items}`).expect(200)).body as { lines: Pick[]; shortages: { sku: string; needed: string; available: string }[]; unplaced: number };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Rak Alur', name: 'Pemilik', email: `rakalur-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    other = (await http.post('/api/auth/register').send({ companyName: 'PT Rak Lain', name: 'Lain', email: `rakalur-b-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    W2 = (await post('/api/warehouses', { code: 'GD-B', name: 'Gudang B' }).expect(201)).body.id;
    P = (await post('/api/products', { sku: 'AL-1', name: 'Minyak Goreng', sellPrice: '20000', category: 'Lain-lain' }).expect(201)).body.id;
    Q = (await post('/api/products', { sku: 'AL-2', name: 'Gula', sellPrice: '15000', category: 'Lain-lain' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'S-AL', name: 'Pemasok' }).expect(201)).body.id;
    for (const w of [W, W2]) await post('/api/inventory/bins/activate', { warehouseId: w }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W, codes: ['A-02-01', 'A-10-01', 'B-01-01'], zone: 'Z1' }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W, codes: ['RSK-1'], kind: 'DAMAGED' }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W2, codes: ['T-01'] }).expect(201);
  });
  afterAll(() => app.close());

  it('penerimaan barang boleh memilih rak tujuan; tanpa pilihan masuk BELUM-DITEMPATKAN; rak gudang lain ditolak', async () => {
    const a2 = await binId(W, 'A-02-01');
    await receive(P, W, '30', { binId: a2, lotNo: 'M-1', expiryDate: addDays(today, 60) });
    await receive(P, W, '20', { lotNo: 'M-2', expiryDate: addDays(today, 20) });
    const r = await rows(W, P);
    expect(r.find((x) => x.lotNo === 'M-1')!.binCode).toBe('A-02-01');
    expect(r.find((x) => x.lotNo === 'M-2')!.binKind).toBe('UNASSIGNED');
    const t01 = await binId(W2, 'T-01');
    const res = await receive(P, W, '5', { binId: t01 }, 400);
    expect(JSON.stringify(res.body)).toContain('Rak tujuan');
    expect(await stock(P, W)).toBe(50); // penolakan membatalkan seluruh penerimaan
  });

  it('penyesuaian masuk/keluar dengan rak; transfer membawa rak asal dan rak tujuan', async () => {
    const a10 = await binId(W, 'A-10-01');
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: Q, qty: '40', unitCost: '900', binId: a10 }] }).expect(201);
    expect((await rows(W, Q)).map((x) => [x.binCode, Number(x.qty)])).toEqual([['A-10-01', 40]]);
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'DAMAGED', date: today, lines: [{ productId: Q, qty: '-10', binId: a10 }] }).expect(201);
    expect(Number((await rows(W, Q))[0].qty)).toBe(30);
    // transfer langsung ke gudang B, rak tujuan T-01, diambil dari A-10-01
    const t01 = await binId(W2, 'T-01');
    await post('/api/inventory/transfers', { fromWarehouseId: W, toWarehouseId: W2, date: today, lines: [{ productId: Q, qty: '12', fromBinId: a10, toBinId: t01 }] }).expect(201);
    expect((await rows(W2, Q)).map((x) => [x.binCode, Number(x.qty)])).toEqual([['T-01', 12]]);
    expect(Number((await rows(W, Q))[0].qty)).toBe(18);
    // kirim dalam perjalanan: rak tujuan dipilih saat diterima
    const t = (await post('/api/inventory/transfers', { fromWarehouseId: W2, toWarehouseId: W, date: today, mode: 'IN_TRANSIT', lines: [{ productId: Q, qty: '5' }] }).expect(201)).body;
    await post(`/api/inventory/transfers/${t.id}/receive`, { lines: [{ productId: Q, receivedQty: '5', binId: await binId(W, 'B-01-01') }] }).expect(201);
    expect((await rows(W, Q)).find((x) => x.binCode === 'B-01-01')!.qty).toBe('5.0000');
    const c = (await get(`/api/inventory/bins/check?warehouseId=${W}`).expect(200)).body;
    expect(c.ok).toBe(true);
  });

  it('daftar ambil: FEFO per lot, rak rusak dilewati, kekurangan dilaporkan, urutan jalan mengikuti zona dan kode', async () => {
    // P: M-2 (20, BELUM-DITEMPATKAN, kedaluwarsa 20 hari) dan M-1 (30, A-02-01, 60 hari); tambah lot M-3 di B-01-01 (kedaluwarsa 5 hari)
    await receive(P, W, '10', { binId: await binId(W, 'B-01-01'), lotNo: 'M-3', expiryDate: addDays(today, 5) });
    // pindahkan sebagian M-1 ke rak rusak (tidak boleh diambil)
    const m1 = (await rows(W, P)).find((x) => x.lotNo === 'M-1')!;
    const lotId = ((await get(`/api/inventory/bins/stock?warehouseId=${W}&productId=${P}`).expect(200)).body.rows as { lotNo: string; lotId: string }[]).find((x) => x.lotNo === 'M-1')!.lotId;
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: P, lotId, fromBinId: m1.binId, toBinId: await binId(W, 'RSK-1'), qty: '10' }] }).expect(201);
    const p = await plan(W, `${P}:45`);
    // M-3 (10) → M-2 (20) → M-1 (15 dari 20 yang layak); rak rusak tidak dipakai
    const byLot = p.lines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.lotNo!]: (a[l.lotNo!] ?? 0) + Number(l.qty) }), {});
    expect(byLot).toEqual({ 'M-3': 10, 'M-2': 20, 'M-1': 15 });
    expect(p.lines.some((l) => l.binKind === 'DAMAGED')).toBe(false);
    expect(p.shortages).toEqual([]);
    expect(p.unplaced).toBe(1); // M-2 masih di BELUM-DITEMPATKAN
    // urutan jalan: zona dahulu, A-02 sebelum B-01, BELUM-DITEMPATKAN paling akhir
    expect(p.lines.map((l) => l.binCode)).toEqual(['A-02-01', 'B-01-01', 'BELUM-DITEMPATKAN']);
    const short = await plan(W, `${P}:100`);
    expect(short.shortages[0]).toMatchObject({ sku: 'AL-1', needed: '100.0000', available: '50.0000' });
    await get(`/api/inventory/bins/pick-plan?warehouseId=${W}&items=bukan-uuid:1`).expect(400);
    await get(`/api/inventory/bins/pick-plan?warehouseId=${W}`).expect(400);
  });

  it('saran daftar ambil sama dengan yang dikurangi pembukuan saat barang keluar', async () => {
    const p = await plan(W, `${P}:45`);
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'DAMAGED', date: today, lines: [{ productId: P, qty: '-45' }] }).expect(201);
    const after = await rows(W, P);
    const left = (code: string, lot: string) => Number(after.find((x) => x.binCode === code && x.lotNo === lot)?.qty ?? 0);
    const before = { 'A-02-01|M-1': 20, 'B-01-01|M-3': 10, 'BELUM-DITEMPATKAN|M-2': 20 };
    for (const l of p.lines) {
      const k = `${l.binCode}|${l.lotNo}` as keyof typeof before;
      expect(left(l.binCode, l.lotNo!)).toBe(before[k] - Number(l.qty));
    }
    expect(left('RSK-1', 'M-1')).toBe(10); // isi rak rusak tidak tersentuh
    const c = (await get(`/api/inventory/bins/check?warehouseId=${W}`).expect(200)).body;
    expect(c.ok).toBe(true);
  });

  it('daftar ambil dari pesanan penjualan: hanya sisa yang belum dikirim; gudang tanpa rak dan perusahaan lain ditolak', async () => {
    await receive(Q, W, '60', { binId: await binId(W, 'A-10-01') });
    const cust = (await post('/api/customers', { code: 'C-AL', name: 'Toko Alur' }).expect(201)).body.id;
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: W, date: today, lines: [{ productId: Q, qty: '25', price: '15000' }, { productId: P, qty: '5', price: '20000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const p = (await get(`/api/inventory/bins/pick-plan?salesOrderId=${so.id}`).expect(200)).body as { order: { number: string }; lines: Pick[] };
    expect(p.order.number).toBe(so.number);
    expect(p.lines.filter((l) => l.sku === 'AL-2').reduce((a, l) => a + Number(l.qty), 0)).toBe(25);
    expect(p.lines.filter((l) => l.sku === 'AL-1').reduce((a, l) => a + Number(l.qty), 0)).toBe(5);
    // kirim sebagian: sisa berkurang
    await post(`/api/sales-orders/${so.id}/deliver`, { lines: [{ orderLineId: so.lines.find((l: { productId: string }) => l.productId === Q).id, qty: '10' }] }).then((r) => expect([200, 201]).toContain(r.status));
    const p2 = (await get(`/api/inventory/bins/pick-plan?salesOrderId=${so.id}`).expect(200)).body as { lines: Pick[] };
    expect(p2.lines.filter((l) => l.sku === 'AL-2').reduce((a, l) => a + Number(l.qty), 0)).toBe(15);
    const wNoBins = (await post('/api/warehouses', { code: 'GD-N', name: 'Tanpa rak' }).expect(201)).body.id;
    await get(`/api/inventory/bins/pick-plan?warehouseId=${wNoBins}&items=${P}:1`).expect(400);
    await get(`/api/inventory/bins/pick-plan?salesOrderId=${so.id}`, other).expect(404);
    const c = (await get(`/api/inventory/bins/check?warehouseId=${W}`).expect(200)).body;
    expect(c.ok).toBe(true);
  });
});
