/**
 * Profil PPN (PKP / non-PKP, harga kasir termasuk PPN) dan penurunan nilai persediaan (NRV, SAK EP Bab 13).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('PPN ritel / non-PKP & penurunan nilai persediaan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let supplierId: string;
  let sessionId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const patch = (url: string, body: object = {}) => http.patch(url).set(as()).send(body);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    const r = tb.rows.find((x: { code: string }) => x.code === code);
    return Number(r?.balance ?? 0);
  };
  const stock = async () => (await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0];
  const buy = async (qty: string, price: string, no: string) => {
    const po = (
      await post('/api/purchase-orders', { supplierId, warehouseId, lines: [{ productId, qty, price }] }).expect(201)
    ).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return (await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: no }).expect(201)).body;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({
          companyName: 'Toko Ritel PPN',
          name: 'Pemilik',
          email: `ppn-${stamp}@uji.id`,
          password: 'rahasia123',
          businessModel: 'RITEL',
        })
        .expect(201)
    ).body.accessToken;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    productId = (await post('/api/products', { sku: 'MNY-1', name: 'Minyak 1L', sellPrice: '11100' }).expect(201)).body
      .id;
    supplierId = (await post('/api/suppliers', { code: 'SUP-1', name: 'PT Pemasok' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('toko ritel baru: PKP, harga kasir sudah termasuk PPN', async () => {
    const me = (await get('/api/auth/me').expect(200)).body;
    expect(me.taxProfile).toEqual({ pkp: true, posPricesIncludeVat: true, salesPricesIncludeVat: false, vatRounding: 'NONE' });
    expect((await get('/api/settings/company').expect(200)).body.taxProfile).toEqual(me.taxProfile);
  });

  it('PKP: pembelian → PPN Masukan; kasir harga termasuk PPN → DPP & PPN dihitung mundur', async () => {
    const pi = await buy('10', '5000', 'F-1');
    expect(pi.vatCapitalized).toBe(false);
    expect(Number((await stock()).avgCost)).toBe(5000);
    expect(await bal('1-1500')).toBe(5500);

    sessionId = (await post('/api/pos/sessions', { warehouseId, openingCash: '0' }).expect(201)).body.id;
    const o = (
      await post('/api/pos/orders', {
        sessionId,
        lines: [{ productId, qty: '2' }],
        payments: [{ method: 'CASH', amount: '22200' }],
      }).expect(201)
    ).body;
    const order = (await get(`/api/pos/orders/${o.id}`).expect(200)).body;
    expect(order).toMatchObject({
      total: '22200.00',
      subtotal: '20000.00',
      taxAmount: '2200.00',
      change: '0.00',
      pricesIncludeVat: true,
    });
    expect(await bal('2-1200')).toBe(2200);
    expect(await bal('4-1000')).toBe(20000);
  });

  it('harga termasuk PPN dengan pecahan: total tetap = harga rak', async () => {
    await patch(`/api/products/${productId}`, { sellPrice: '15000' }).expect(200);
    const o = (
      await post('/api/pos/orders', {
        sessionId,
        lines: [{ productId, qty: '1' }],
        payments: [{ method: 'CASH', amount: '15000' }],
      }).expect(201)
    ).body;
    const order = (await get(`/api/pos/orders/${o.id}`).expect(200)).body;
    expect(order).toMatchObject({ total: '15000.00', subtotal: '13513.51', taxAmount: '1486.49' });
  });

  it('non-PKP: tanpa PPN keluaran; PPN supplier masuk harga pokok, biaya, dan retur', async () => {
    await patch('/api/settings/company', { pkp: false }).expect(200);
    expect((await get('/api/auth/me').expect(200)).body.taxProfile.pkp).toBe(false);
    const vatOut = await bal('2-1200');
    const vatIn = await bal('1-1500');

    const o = (
      await post('/api/pos/orders', {
        sessionId,
        lines: [{ productId, qty: '1' }],
        payments: [{ method: 'CASH', amount: '15000' }],
      }).expect(201)
    ).body;
    expect((await get(`/api/pos/orders/${o.id}`).expect(200)).body).toMatchObject({
      total: '15000.00',
      subtotal: '15000.00',
      taxAmount: '0.00',
    });

    await post('/api/apps/sales/install').expect(201);
    const customerId = (await post('/api/customers', { code: 'C-1', name: 'Pelanggan' }).expect(201)).body.id;
    const so = (
      await post('/api/sales-orders', {
        customerId,
        warehouseId,
        lines: [{ productId, qty: '1', price: '15000' }],
      }).expect(201)
    ).body;
    expect(so).toMatchObject({ subtotal: '15000.00', taxAmount: '0.00', total: '15000.00' });

    // stok 6 @5.000; beli 10 @5.000 + PPN 11% → biaya 5.550/pcs
    const pi = await buy('10', '5000', 'F-2');
    expect(pi).toMatchObject({ taxAmount: '5500.00', total: '55500.00', vatCapitalized: true });
    expect(Number((await stock()).qty)).toBe(16);
    expect(Number((await stock()).avgCost)).toBeCloseTo((6 * 5000 + 55500) / 16, 3);
    expect(await bal('1-1500')).toBe(vatIn);
    expect(await bal('2-1200')).toBe(vatOut);

    // retur 1 pcs: utang turun 5.550, PPN Masukan tidak tersentuh
    const ret = (
      await post('/api/purchase-returns', {
        invoiceId: pi.id,
        reason: 'Bocor',
        lines: [{ invoiceLineId: pi.lines[0].id, qty: '1' }],
      }).expect(201)
    ).body;
    expect(ret.total).toBe('5550.00');
    expect(await bal('1-1500')).toBe(vatIn);

    // tagihan jasa ber-PPN → seluruhnya beban
    const accounts = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const exp = accounts.find((a) => a.code === '6-7000')!;
    const before = await bal('6-7000');
    const bill = (
      await post('/api/purchase-invoices/bills', {
        supplierId,
        supplierInvoiceNo: 'B-1',
        lines: [{ type: 'EXPENSE', description: 'Servis freezer', accountId: exp.id, price: '1000000' }],
      }).expect(201)
    ).body;
    expect(bill).toMatchObject({ taxAmount: '110000.00', total: '1110000.00', vatCapitalized: true });
    expect((await bal('6-7000')) - before).toBe(1110000);
    expect(await bal('1-1500')).toBe(vatIn);

    await patch('/api/settings/company', { pkp: true }).expect(200);
  });

  it('penurunan nilai persediaan: indikasi, posting, kartu stok, jurnal, cek kesehatan', async () => {
    const s0 = await stock();
    const qty = Number(s0.qty);
    const avg = Number(s0.avgCost);
    await patch(`/api/products/${productId}`, { sellPrice: '4000' }).expect(200);

    const health0 = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(health0.find((c) => c.key === 'inventory-nrv')?.status).toBe('WARN');

    const cand = (await get(`/api/inventory/writedowns/candidates?warehouseId=${warehouseId}`).expect(200)).body;
    expect(cand).toHaveLength(1);
    expect(cand[0]).toMatchObject({ productId, nrv: '4000.00', sellPrice: '4000.00' });
    const withCost = (
      await get(`/api/inventory/writedowns/candidates?warehouseId=${warehouseId}&costToSellPct=10`).expect(200)
    ).body;
    expect(withCost[0].nrv).toBe('3600.00');

    await post('/api/inventory/writedowns', {
      date: '2026-10-05',
      warehouseId,
      reason: 'Harga pasar turun',
      lines: [{ productId, newCost: String(avg + 1) }],
    }).expect(400);
    await post('/api/inventory/writedowns', {
      date: '2026-10-05',
      warehouseId,
      reason: 'x',
      lines: [{ productId, newCost: '4000' }],
    }).expect(400);

    const inv0 = await bal('1-1400');
    const wd = (
      await post('/api/inventory/writedowns', {
        date: '2026-10-05',
        warehouseId,
        reason: 'Harga pasar turun di bawah harga pokok',
        lines: [{ productId, newCost: '4000' }],
      }).expect(201)
    ).body;
    expect(wd.number).toMatch(/^PNP\//);
    const expected = Math.round(qty * avg * 100) / 100 - qty * 4000;
    expect(Number(wd.total)).toBeCloseTo(expected, 1);

    const s1 = await stock();
    expect(Number(s1.qty)).toBe(qty);
    expect(Number(s1.avgCost)).toBe(4000);
    expect(await bal('5-3000')).toBe(Number(wd.total));
    expect(inv0 - (await bal('1-1400'))).toBeCloseTo(Number(wd.total), 2);

    const moves = (await get(`/api/inventory/moves?productId=${productId}`).expect(200)).body as {
      type: string;
      qty: string;
      unitCost: string;
    }[];
    expect(moves.find((m) => m.type === 'REVALUATION')).toMatchObject({ unitCost: '4000.0000' });

    const list = (await get('/api/inventory/writedowns').expect(200)).body;
    expect(list[0]).toMatchObject({ number: wd.number, total: wd.total });
    expect(list[0].lines[0]).toMatchObject({ productId, newCost: '4000.0000' });

    const health = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(health.find((c) => c.key === 'inventory-nrv')).toBeUndefined();
    expect(health.find((c) => c.key === 'inventory')?.status).toBe('OK');

    // dijual setelah penurunan: HPP memakai nilai baru
    const o = (
      await post('/api/pos/orders', {
        sessionId,
        lines: [{ productId, qty: '1' }],
        payments: [{ method: 'CASH', amount: '4000' }],
      }).expect(201)
    ).body;
    expect((await get(`/api/pos/orders/${o.id}`).expect(200)).body.cogsAmount).toBe('4000.00');
  });

  it('penawaran & pesanan dengan harga termasuk PPN: total = harga yang ditawarkan, baris disimpan sebagai DPP', async () => {
    await patch(`/api/products/${productId}`, { sellPrice: '15000' }).expect(200);
    const customerId = (await post('/api/customers', { code: 'C-2', name: 'Pelanggan Inklusif' }).expect(201)).body.id;
    const so = (
      await post('/api/sales-orders', {
        customerId,
        warehouseId,
        pricesIncludeVat: true,
        lines: [{ productId, qty: '3', price: '15000' }],
      }).expect(201)
    ).body;
    expect(so).toMatchObject({ pricesIncludeVat: true, total: '45000.00', subtotal: '40540.54', taxAmount: '4459.46' });
    expect(so.lines[0]).toMatchObject({ lineTotal: '40540.54', price: '13513.52' });
    expect(Number(so.lines[0].priceInclVat)).toBe(15000);

    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    expect(inv).toMatchObject({ total: '45000.00', subtotal: '40540.54', taxAmount: '4459.46' });
    const ret = (
      await post('/api/sales-returns', {
        invoiceId: inv.id,
        lines: [{ invoiceLineId: inv.lines[0].id, qty: '1' }],
      }).expect(201)
    ).body;
    expect(Math.abs(Number(ret.total) - 15000)).toBeLessThan(0.05);

    await post('/api/apps/crm/install').expect(201);
    const q = (
      await post('/api/crm/quotations', {
        customerId,
        warehouseId,
        pricesIncludeVat: true,
        lines: [{ productId, qty: '2', price: '15000', discountPct: '10' }],
      }).expect(201)
    ).body;
    expect(q).toMatchObject({ pricesIncludeVat: true, total: '27000.00' });
    const conv = (await post(`/api/crm/quotations/${q.id}/convert`).expect(201)).body;
    expect(conv.salesOrder).toMatchObject({ total: '27000.00', subtotal: q.subtotal, pricesIncludeVat: true });

    // tanpa centang: tetap seperti biasa (PPN ditambahkan)
    const plain = (
      await post('/api/sales-orders', {
        customerId,
        warehouseId,
        lines: [{ productId, qty: '1', price: '15000' }],
      }).expect(201)
    ).body;
    expect(plain).toMatchObject({ pricesIncludeVat: false, total: '16650.00' });
  });

  it('pemulihan nilai (maks. sebesar penurunan) & koreksi fiskal otomatis saat barang terjual', async () => {
    const rec = (await get(`/api/inventory/writedowns/recoverable?warehouseId=${warehouseId}`).expect(200)).body;
    expect(rec).toHaveLength(1);
    const r = rec[0];
    const avg = Number(r.avgCost);
    const max = Number(r.maxCost);
    const wu = max - avg;
    expect(avg).toBe(4000);
    expect(wu).toBeGreaterThan(0);
    expect(r.suggestedCost).toBe(r.maxCost); // harga jual 15.000 > batas → disarankan pulih penuh

    // fiskal: barang yang sudah keluar (POS 1 + SO 3 − retur 1 = 3) → koreksi negatif ≈ 3 × penurunan per satuan
    const f0 = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    const realized0 = f0.negative.find((i: { source: string }) => i.source === 'INVENTORY');
    expect(Number(realized0.amount)).toBeCloseTo(3 * wu, 1);
    expect(Number(f0.deferred.temporaryDifference)).toBeCloseTo(Number(r.qty) * wu, 0);

    await post('/api/inventory/writedowns', {
      date: '2026-10-05',
      warehouseId,
      kind: 'REVERSAL',
      reason: 'Harga pasar naik lagi',
      lines: [{ productId, newCost: String(max + 1) }],
    }).expect(400);
    await post('/api/inventory/writedowns', {
      date: '2026-10-05',
      warehouseId,
      kind: 'REVERSAL',
      reason: 'Harga pasar naik lagi',
      lines: [{ productId, newCost: '3999' }],
    }).expect(400);

    const wd5300 = await bal('5-3000');
    const inv0 = await bal('1-1400');
    const part = (
      await post('/api/inventory/writedowns', {
        date: '2026-10-05',
        warehouseId,
        kind: 'REVERSAL',
        reason: 'Harga pasar naik lagi sebagian',
        lines: [{ productId, newCost: '4500' }],
      }).expect(201)
    ).body;
    expect(part.number).toMatch(/^PMN\//);
    expect(Number(part.total)).toBeCloseTo(Number(r.qty) * 500, 2);
    expect(Number((await stock()).avgCost)).toBe(4500);
    expect(await bal('5-3000')).toBeCloseTo(wd5300 - Number(part.total), 2);
    expect((await bal('1-1400')) - inv0).toBeCloseTo(Number(part.total), 2);

    const rec2 = (await get(`/api/inventory/writedowns/recoverable?warehouseId=${warehouseId}`).expect(200)).body;
    expect(Number(rec2[0].maxCost)).toBeCloseTo(max, 3);
    await post('/api/inventory/writedowns', {
      date: '2026-10-05',
      warehouseId,
      kind: 'REVERSAL',
      reason: 'Harga pulih penuh',
      lines: [{ productId, newCost: rec2[0].maxCost }],
    }).expect(201);
    expect(
      (await get(`/api/inventory/writedowns/recoverable?warehouseId=${warehouseId}`).expect(200)).body,
    ).toHaveLength(0);

    const list = (await get('/api/inventory/writedowns').expect(200)).body;
    expect(list.filter((d: { kind: string }) => d.kind === 'REVERSAL')).toHaveLength(2);

    // pulih penuh: beban bersih 5-3000 = bagian yang sudah terjual → koreksi positif = koreksi negatif, beda temporer nol
    const f1 = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    const pos = f1.positive.find((i: { label: string }) => i.label.startsWith('5-3000'));
    const neg = f1.negative.find((i: { source: string }) => i.source === 'INVENTORY');
    expect(Math.abs(Number(pos.amount) - Number(neg.amount))).toBeLessThan(0.1);
    expect(Math.abs(Number(f1.deferred.temporaryDifference))).toBeLessThan(0.01);
  });
});
