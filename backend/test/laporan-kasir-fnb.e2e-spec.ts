/**
 * Laporan pendukung Kasir (Ritel & F&B) dan F&B (e2e): rincian per kasir/sesi/metode/menu, pencocokan buku besar, selisih kas,
 * pajak daerah, piutang platform, dan bahan terpakai vs resep.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung kasir & F&B (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  let W: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const report = async (kind: string, t = owner) => (await get(t, `/api/accounting/support/${kind}?from=${from}&to=${day}`).expect(200)).body as Rep;
  const rec = (r: Rep, key: string) => r.reconciliation.find((x) => x.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Laporan', name: 'Pemilik', email: `lk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    await post(owner, '/api/users', { name: 'Kasir Uji', email: `lk-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `lk-k-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
    const mk = async (sku: string, body: object) => (await post(owner, '/api/products', { sku, sellPrice: '0', ...body }).expect(201)).body.id as string;
    const kopi = await mk('BB-KOPI', { name: 'Biji Kopi', baseUom: 'GRAM' });
    const susu = await mk('BB-SUSU', { name: 'Susu', baseUom: 'ML' });
    const menu = await mk('MN-KOPSU', { name: 'Kopi Susu', baseUom: 'PCS', sellPrice: '24000', madeToOrder: true });
    await post(owner, '/api/production/boms', { name: 'Resep Kopi Susu', productId: menu, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: '18' }, { productId: susu, qty: '150' }] }).expect(201);
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: day, lines: [{ productId: kopi, qty: '1000', unitCost: '140' }, { productId: susu, qty: '3000', unitCost: '18' }] }).expect(201);
    const session = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
    // tunai 2 menu (52.800), QRIS 1 menu (26.400)
    await post(cashier, '/api/pos/orders', { sessionId: session, lines: [{ productId: menu, qty: '2' }], payments: [{ method: 'CASH', amount: '60000' }] }).expect(201);
    await post(cashier, '/api/pos/orders', { sessionId: session, lines: [{ productId: menu, qty: '1' }], payments: [{ method: 'QRIS', amount: '26400' }] }).expect(201);
    // pesanan online GoFood belum dicairkan
    const tab = (await post(cashier, '/api/pos/tabs', { warehouseId: W, channel: 'GOFOOD', externalRef: 'GF-9', lines: [{ productId: menu, qty: '1' }] }).expect(201)).body;
    await post(cashier, `/api/pos/tabs/${tab.id}/send`).expect(201);
    await post(cashier, `/api/pos/tabs/${tab.id}/pay`, { sessionId: session }).expect(201);
    // tutup kasir kurang 5.000 dari seharusnya (100.000 + 52.800 = 152.800)
    await post(cashier, `/api/pos/sessions/${session}/close`, { countedCash: '147800' }).expect(201);
  });
  afterAll(() => app.close());

  it('kasir: rincian per kasir/metode/sesi dan pencocokan buku besar semuanya cocok', async () => {
    const r = await report('pos');
    expect(r.reconciliation.map((x) => x.key)).toEqual(['pos-revenue', 'pos-payments', 'pos-deposit', 'pos-cash-diff']);
    for (const x of r.reconciliation) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 });
    const cashierT = r.sections.find((s) => s.key === 'pos-cashier')!.tables[0];
    expect(cashierT.rows).toHaveLength(1);
    expect(cashierT.rows[0][0]).toBe('Kasir Uji');
    expect(cashierT.rows[0][1]).toBe(3);
    expect(cashierT.rows[0][2]).toBe(96000); // 4 × 24.000 (termasuk pesanan online)
    const methods = r.sections.find((s) => s.key === 'pos-method')!.tables[0].rows.map((x) => [x[0], x[2]]);
    expect(methods).toEqual(expect.arrayContaining([['Tunai', 52800], ['QRIS', 26400], ['Platform pesan-antar', 26400]]));
    const sess = r.sections.find((s) => s.key === 'pos-session')!.tables[0].rows[0];
    expect(sess[9]).toBe(-5000);
    expect(rec(r, 'pos-cash-diff').left.value).toBe(-5000);
  });

  it('F&B: menu, pajak daerah, piutang platform, HPP, dan bahan sesuai resep', async () => {
    const r = await report('fnb');
    expect(r.reconciliation.map((x) => x.key)).toEqual(['fnb-pb1', 'fnb-platform', 'fnb-cogs', 'fnb-usage']);
    for (const x of r.reconciliation) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 });
    expect(rec(r, 'fnb-pb1').left.value).toBe(9600); // 10% × 96.000
    const menuT = r.sections.find((s) => s.key === 'fnb-menu')!.tables[0];
    expect(menuT.rows[0].slice(0, 3)).toEqual(['MN-KOPSU', 'Kopi Susu', 4]);
    const usage = r.sections.find((s) => s.key === 'fnb-usage')!.tables[0].rows;
    expect(usage.map((x) => [x[0], x[2], x[3]])).toEqual([['BB-KOPI', 72, 72], ['BB-SUSU', 600, 600]]);
    expect(rec(r, 'fnb-platform').left.value).toBeGreaterThan(0);
    const plat = r.sections.find((s) => s.key === 'fnb-platform')!.tables[0].rows;
    expect(plat[0][0]).toBe('GOFOOD');
  });

  it('akses: hanya peran keuangan, dan kasir tidak boleh membuka laporan', async () => {
    await get(cashier, `/api/accounting/support/pos?from=${from}&to=${day}`).expect(403);
  });
});
