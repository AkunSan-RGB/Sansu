/**
 * Pajak restoran daerah PB1/PBJT (e2e): penjualan kasir F&B dikenai pajak daerah (bukan PPN) ke akun Utang Pajak Restoran,
 * retur membaliknya, setoran PB1 melunasi kewajiban, rekap memuat PB1, dan pengaturan tarif divalidasi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Pajak restoran daerah PB1 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let W: string;
  let menu: string;
  let sessionId: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const period = today.slice(0, 7);
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const sell = (qty: string) => post('/api/pos/orders', { sessionId, lines: [{ productId: menu, qty }], payments: [{ method: 'CASH', amount: '1000000' }] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Pajak', name: 'Pemilik', email: `pb1-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    await http.put('/api/cash/settings').set({ Authorization: `Bearer ${owner}` }).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    menu = (await post('/api/products', { sku: 'BRG-1', name: 'Kopi Jadi', sellPrice: '20000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: menu, qty: '100', unitCost: '8000' }] }).expect(201);
    sessionId = (await post('/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('perusahaan F&B baru: pajak daerah 10% menyala bawaan', async () => {
    const me = (await get('/api/auth/me').expect(200)).body;
    expect(me.taxProfile.localTaxEnabled).toBe(true);
    expect(me.taxProfile.localTaxRate).toBe('10');
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { code: string; isActive: boolean }[];
    expect(accs.find((a) => a.code === '2-1210')?.isActive).toBe(true);
  });

  let orderId: string;
  it('kasir: PB1 10% masuk Utang Pajak Restoran, bukan PPN Keluaran', async () => {
    const pb0 = await bal('2-1210');
    const ppn0 = await bal('2-1200');
    const o = (await sell('5').expect(201)).body; // 5 × 20.000 = 100.000
    orderId = o.id;
    expect(o.taxKind).toBe('LOCAL');
    expect(Number(o.subtotal)).toBe(100000);
    expect(Number(o.taxAmount)).toBe(10000);
    expect(Number(o.total)).toBe(110000);
    expect(await bal('2-1210')).toBeCloseTo(pb0 + 10000, 2);
    expect(await bal('2-1200')).toBeCloseTo(ppn0, 2);
  });

  it('retur kasir membalik PB1, bukan PPN', async () => {
    const pb0 = await bal('2-1210');
    await post(`/api/pos/orders/${orderId}/return`, { all: true, reason: 'pesanan dibatalkan' }).expect(201);
    expect(await bal('2-1210')).toBeCloseTo(pb0 - 10000, 2);
    expect(await bal('2-1200')).toBeCloseTo(0, 2);
  });

  it('kewajiban PB1 muncul, bisa disetor, dan tidak bisa disetor melebihi terutang', async () => {
    await sell('10').expect(201); // PB1 20.000
    const ob = (await get(`/api/tax/obligations?period=${period}`).expect(200)).body as { type: string; outstanding: string; dueDate: string }[];
    const pb = ob.find((o) => o.type === 'PB1')!;
    expect(Number(pb.outstanding)).toBeCloseTo(20000, 2);
    expect(pb.dueDate).toMatch(/-15$|-1[5-9]$|-2\d$/); // tanggal 15 bulan berikutnya, digeser ke hari kerja
    await post('/api/tax/payments', { type: 'PB1', period, date: today, amount: '30000' }).expect(400); // melebihi terutang
    const pay = (await post('/api/tax/payments', { type: 'PB1', period, date: today, ntpn: 'PB1-0001' }).expect(201)).body;
    expect(Number(pay.amount)).toBeCloseTo(20000, 2);
    expect(await bal('2-1210')).toBeCloseTo(0, 2);
    const ob2 = (await get(`/api/tax/obligations?period=${period}`).expect(200)).body as { type: string; outstanding: string; status: string }[];
    expect(ob2.find((o) => o.type === 'PB1')).toMatchObject({ outstanding: '0.00', status: 'LUNAS' });
  });

  it('rekap tahunan memuat PB1; dibatalkan lagi setoran dihapus', async () => {
    const recap = (await get(`/api/tax/reports/annual?year=${today.slice(0, 4)}`).expect(200)).body as { types: { type: string; total: { payable: string; paid: string } }[] };
    const pb = recap.types.find((t) => t.type === 'PB1')!;
    expect(pb).toBeDefined();
    expect(Number(pb.total.paid)).toBeCloseTo(20000, 2);
    const list = (await get('/api/tax/payments').expect(200)).body as { id: string; type: string }[];
    await http.delete(`/api/tax/payments/${list.find((p) => p.type === 'PB1')!.id}`).set(as()).expect(200);
    expect(await bal('2-1210')).toBeCloseTo(20000, 2);
  });

  it('tarif divalidasi 0–10%; harga termasuk pajak dihitung mundur', async () => {
    await http.patch('/api/settings/company').set(as()).send({ localTaxRate: '12' }).expect(400);
    await http.patch('/api/settings/company').set(as()).send({ localTaxRate: 'abc' }).expect(400);
    await http.patch('/api/settings/company').set(as()).send({ localTaxRate: '5.5', posPricesIncludeVat: true }).expect(200);
    const o = (await sell('1').expect(201)).body; // harga rak 20.000 termasuk PB1 5,5%
    expect(Number(o.total)).toBe(20000);
    expect(Number(o.taxAmount)).toBeCloseTo(20000 - 20000 / 1.055, 0);
    expect(o.taxKind).toBe('LOCAL');
  });

  it('pajak daerah dimatikan: kasir kembali memakai PPN (PKP)', async () => {
    await http.patch('/api/settings/company').set(as()).send({ localTaxEnabled: false, posPricesIncludeVat: false }).expect(200);
    const ppn0 = await bal('2-1200');
    const o = (await sell('1').expect(201)).body;
    expect(o.taxKind).toBe('VAT');
    expect(Number(o.taxAmount)).toBeGreaterThan(0);
    expect(await bal('2-1200')).toBeGreaterThan(ppn0);
  });
});
