/**
 * Lot dan kedaluwarsa bahan (e2e): lot dari penerimaan barang dan penyesuaian, FEFO saat barang keluar, transfer membawa lot,
 * pembatalan penerimaan menghapus lotnya, pembuangan lot tertentu, status kedaluwarsa, serta label meja/jenis pesanan di kasir.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

type Lot = { id: string; lotNo: string | null; expiryDate: string | null; qtyRemaining: string; status: string; daysLeft: number | null; warehouseId: string; productId: string };

describe('Kedaluwarsa bahan: lot, FEFO, transfer, pembuangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let W1: string;
  let W2: string;
  let P: string;
  let Q: string;
  let sup: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const lots = async (productId: string, warehouseId?: string) =>
    ((await get(`/api/inventory/lots${warehouseId ? `?warehouseId=${warehouseId}` : ''}`).expect(200)).body.items as Lot[]).filter((l) => l.productId === productId);
  const stock = async (productId: string, warehouseId: string) => Number((await get(`/api/inventory/balances?productId=${productId}&warehouseId=${warehouseId}`).expect(200)).body[0]?.qty ?? 0);
  const total = (ls: Lot[]) => ls.reduce((a, l) => a + Number(l.qtyRemaining), 0);
  const receive = async (product: string, wh: string, qty: string, date: string, lot: { lotNo?: string; expiryDate?: string }, status = 201) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, date, lines: [{ productId: product, qty, price: '1000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return post(`/api/purchase-orders/${po.id}/receipts`, { date, lines: [{ orderLineId: po.lines[0].id, qty, ...lot }] }).expect(status);
  };
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Lot', name: 'Pemilik', email: `lot-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W1 = (await get('/api/warehouses').expect(200)).body[0].id;
    W2 = (await post('/api/warehouses', { code: 'DPR-2', name: 'Dapur 2' }).expect(201)).body.id;
    P = (await post('/api/products', { sku: 'BB-SUSU', name: 'Susu Segar', baseUom: 'LTR', sellPrice: '0' }).expect(201)).body.id;
    Q = (await post('/api/products', { sku: 'BB-KRIM', name: 'Krim', baseUom: 'LTR', sellPrice: '0' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'S-LOT', name: 'Pemasok Susu' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('penerimaan membawa lot; barang sudah kedaluwarsa saat diterima atau tanggal salah ditolak', async () => {
    const bad = await receive(P, W1, '10', today, { lotNo: 'L-X', expiryDate: addDays(today, -1) }, 400);
    expect(JSON.stringify(bad.body)).toContain('kedaluwarsa');
    await receive(P, W1, '10', today, { expiryDate: 'bukan-tanggal' }, 400);
    expect(await lots(P)).toEqual([]); // penolakan tidak meninggalkan lot setengah jadi
    expect(await stock(P, W1)).toBe(0);
  });

  it('dua penerimaan: lot dan sisa hari tercatat; status mengikuti sisa hari', async () => {
    await receive(P, W1, '20', today, { lotNo: 'L-LAMBAT', expiryDate: addDays(today, 40) });
    await receive(P, W1, '30', today, { lotNo: 'L-CEPAT', expiryDate: addDays(today, 3) });
    const ls = await lots(P, W1);
    expect(ls.map((l) => l.lotNo)).toEqual(['L-CEPAT', 'L-LAMBAT']); // diurutkan paling cepat kedaluwarsa
    expect(ls[0].status).toBe('SOON');
    expect(ls[0].daysLeft).toBe(3);
    expect(ls[1].status).toBe('OK');
    const all = (await get('/api/inventory/lots').expect(200)).body;
    expect(all.summary.soon).toBeGreaterThanOrEqual(1);
    expect((await get('/api/inventory/lots?status=SOON').expect(200)).body.items.every((l: Lot) => l.status === 'SOON')).toBe(true);
  });

  it('barang keluar mengurangi lot yang paling cepat kedaluwarsa lebih dulu (FEFO); lot tidak pernah melebihi stok', async () => {
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'DAMAGED', date: today, lines: [{ productId: P, qty: '-35' }] }).expect(201);
    const ls = await lots(P, W1);
    expect(ls.map((l) => [l.lotNo, Number(l.qtyRemaining)])).toEqual([['L-LAMBAT', 15]]); // L-CEPAT (30) habis, L-LAMBAT berkurang 5
    expect(await stock(P, W1)).toBe(15);
    expect(total(ls)).toBeLessThanOrEqual(await stock(P, W1));
    // kuantitas keluar lebih dari lot yang tercatat tidak membuat lot negatif
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'DAMAGED', date: today, lines: [{ productId: P, qty: '-15' }] }).expect(201);
    expect(await lots(P, W1)).toEqual([]);
    expect(await stock(P, W1)).toBe(0);
  });

  it('lot hanya untuk barang masuk; pilihan lot hanya untuk barang keluar', async () => {
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'DAMAGED', date: today, lines: [{ productId: P, qty: '-1', lotNo: 'L-1' }] }).expect(400);
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'OPENING', date: today, lines: [{ productId: P, qty: '5', unitCost: '1000', lotId: '00000000-0000-4000-8000-000000000000' }] }).expect(400);
  });

  it('saldo awal dengan lot; transfer langsung dan kiriman dalam perjalanan membawa lot ke gudang tujuan', async () => {
    await post('/api/inventory/adjustments', {
      warehouseId: W1,
      reason: 'OPENING',
      date: today,
      lines: [
        { productId: Q, qty: '10', unitCost: '5000', lotNo: 'K-1', expiryDate: addDays(today, 5) },
        { productId: Q, qty: '10', unitCost: '5000', lotNo: 'K-2', expiryDate: addDays(today, 60) },
      ],
    }).expect(201);
    await post('/api/inventory/transfers', { fromWarehouseId: W1, toWarehouseId: W2, date: today, lines: [{ productId: Q, qty: '12' }] }).expect(201);
    expect((await lots(Q, W1)).map((l) => [l.lotNo, Number(l.qtyRemaining)])).toEqual([['K-2', 8]]); // K-1 (10) habis lalu K-2 berkurang 2
    expect((await lots(Q, W2)).map((l) => [l.lotNo, Number(l.qtyRemaining), l.expiryDate])).toEqual([
      ['K-1', 10, addDays(today, 5)],
      ['K-2', 2, addDays(today, 60)],
    ]);
    const t = (await post('/api/inventory/transfers', { fromWarehouseId: W2, toWarehouseId: W1, date: today, mode: 'IN_TRANSIT', lines: [{ productId: Q, qty: '10' }] }).expect(201)).body;
    expect(await lots(Q, W2).then((x) => total(x))).toBe(2); // 10 K-1 keluar dari W2
    await post(`/api/inventory/transfers/${t.id}/receive`, { lines: [{ productId: Q, receivedQty: '10' }] }).expect(201);
    expect((await lots(Q, W1)).map((l) => [l.lotNo, Number(l.qtyRemaining)]).sort()).toEqual([['K-1', 10], ['K-2', 8]]);
    expect(total(await lots(Q, W1))).toBeLessThanOrEqual(await stock(Q, W1));
    expect(total(await lots(Q, W2))).toBeLessThanOrEqual(await stock(Q, W2));
  });

  it('pembatalan penerimaan menghapus lot dari penerimaan itu saja', async () => {
    const keep = await receive(P, W1, '10', today, { lotNo: 'L-SIMPAN', expiryDate: addDays(today, 20) });
    const gone = await receive(P, W1, '7', today, { lotNo: 'L-BATAL', expiryDate: addDays(today, 2) });
    expect((await lots(P, W1)).map((l) => l.lotNo)).toEqual(['L-BATAL', 'L-SIMPAN']);
    await post(`/api/goods-receipts/${gone.body.id}/cancel`, {}).expect(201);
    expect((await lots(P, W1)).map((l) => [l.lotNo, Number(l.qtyRemaining)])).toEqual([['L-SIMPAN', 10]]); // bukan FEFO biasa: lot yang dibatalkan yang hilang
    expect(await stock(P, W1)).toBe(10);
    void keep;
  });

  it('membuang lot tertentu: stok dan jurnal turun sebesar lot itu, lot lain tidak tersentuh', async () => {
    await receive(P, W1, '6', today, { lotNo: 'L-RUSAK', expiryDate: addDays(today, 90) });
    const before = await lots(P, W1);
    const rusak = before.find((l) => l.lotNo === 'L-RUSAK')!;
    const simpan = before.find((l) => l.lotNo === 'L-SIMPAN')!; // kedaluwarsa lebih cepat, tetapi bukan yang dibuang
    const inv0 = await bal('1-1400');
    const r = (await post(`/api/inventory/lots/${rusak.id}/discard`, { notes: 'basi' }).expect(201)).body;
    expect(Number(r.valueOut)).toBeCloseTo(6000, 2);
    expect(await bal('1-1400')).toBeCloseTo(inv0 - 6000, 2);
    const after = await lots(P, W1);
    expect(after.find((l) => l.lotNo === 'L-RUSAK')).toBeUndefined();
    expect(Number(after.find((l) => l.id === simpan.id)!.qtyRemaining)).toBe(10);
    await post(`/api/inventory/lots/${rusak.id}/discard`, {}).expect(400); // sudah habis
  });

  it('status kedaluwarsa: lot yang sudah lewat tanggal ditandai dan dihitung nilainya', async () => {
    const old = addDays(today, -10);
    await receive(Q, W1, '4', old, { lotNo: 'K-LAMA', expiryDate: addDays(today, -2) });
    const res = (await get('/api/inventory/lots?status=EXPIRED').expect(200)).body;
    const l = (res.items as Lot[]).find((x) => x.lotNo === 'K-LAMA')!;
    expect(l.status).toBe('EXPIRED');
    expect(l.daysLeft).toBe(-2);
    expect(res.summary.expired).toBeGreaterThanOrEqual(1);
    expect(Number(res.summary.expiredValue)).toBeGreaterThan(0);
  });

  it('terima dan faktur sekaligus juga membawa lot; lot tidak sah membatalkan seluruh faktur', async () => {
    const mk = async () => {
      const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: W1, date: today, lines: [{ productId: Q, qty: '5', price: '2000' }] }).expect(201)).body;
      await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
      return po;
    };
    const bad = await mk();
    await post('/api/purchase-invoices', { purchaseOrderId: bad.id, supplierInvoiceNo: 'INV-BAD', date: today, lots: [{ orderLineId: bad.lines[0].id, lotNo: 'K-BAD', expiryDate: addDays(today, -3) }] }).expect(400);
    expect((await lots(Q, W1)).some((l) => l.lotNo === 'K-BAD')).toBe(false);
    expect((await get(`/api/purchase-orders/${bad.id}`).expect(200)).body.status).toBe('CONFIRMED'); // faktur gagal total, PO tetap bisa dipakai
    await post('/api/purchase-invoices', { purchaseOrderId: bad.id, supplierInvoiceNo: 'INV-OK', date: today, lots: [{ orderLineId: bad.lines[0].id, lotNo: 'K-OK', expiryDate: addDays(today, 9) }] }).expect(201);
    const l = (await lots(Q, W1)).find((x) => x.lotNo === 'K-OK')!;
    expect([Number(l.qtyRemaining), l.expiryDate]).toEqual([5, addDays(today, 9)]);
  });

  it('kasir: jenis pesanan dan label meja tersimpan; nilai tidak dikenal ditolak', async () => {
    const menu = (await post('/api/products', { sku: 'MN-ES', name: 'Es Susu', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'OPENING', date: today, lines: [{ productId: menu, qty: '20', unitCost: '3000' }] }).expect(201);
    await post('/api/apps/pos/install').expect(201);
    const sessionId = (await post('/api/pos/sessions', { warehouseId: W1, openingCash: '100000' }).expect(201)).body.id;
    const base = { sessionId, lines: [{ productId: menu, qty: '2' }], payments: [{ method: 'CASH', amount: '100000' }] };
    const o = (await post('/api/pos/orders', { ...base, orderType: 'DINE_IN', tableLabel: ' Meja 5 ' }).expect(201)).body;
    expect(o.orderType).toBe('DINE_IN');
    expect(o.tableLabel).toBe('Meja 5');
    await post('/api/pos/orders', { ...base, orderType: 'NGAWUR' }).expect(400);
    const plain = (await post('/api/pos/orders', base).expect(201)).body;
    expect(plain.orderType).toBeNull();
  });
});
