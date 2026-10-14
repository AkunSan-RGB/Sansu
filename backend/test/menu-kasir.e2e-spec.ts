/**
 * Menu yang dibuat saat dipesan (e2e): kasir memotong bahan sesuai resep aktif (bukan stok menu), HPP dari bahan,
 * porsi tersedia, bahan kurang ditolak, retur tidak mengembalikan bahan, pembukuan tetap seimbang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kasir: menu dibuat saat dipesan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let W: string;
  let kopi: string;
  let susu: string;
  let menu: string;
  let sessionId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string) => http.get(u).set(as(owner));
  const post = (u: string, b: object = {}) => http.post(u).set(as(owner)).send(b);
  const qty = async (productId: string) => Number((await get(`/api/inventory/balances?productId=${productId}&warehouseId=${W}`).expect(200)).body[0]?.qty ?? 0);
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
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kopi Menu', name: 'Pemilik', email: `mk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/apps/pos/install').expect(201);
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    kopi = (await post('/api/products', { sku: 'BB-KOPI', name: 'Biji Kopi', baseUom: 'GR', sellPrice: '0' }).expect(201)).body.id;
    susu = (await post('/api/products', { sku: 'BB-SUSU', name: 'Susu Cair', baseUom: 'ML', sellPrice: '0' }).expect(201)).body.id;
    menu = (await post('/api/products', { sku: 'MN-KOPSU', name: 'Kopi Susu', baseUom: 'PCS', sellPrice: '25000', madeToOrder: true }).expect(201)).body.id;
    await post('/api/inventory/adjustments', {
      warehouseId: W,
      reason: 'OPENING',
      date: todayJakarta(),
      lines: [
        { productId: kopi, qty: '1000', unitCost: '200' },
        { productId: susu, qty: '5000', unitCost: '20' },
      ],
    }).expect(201);
    sessionId = (await post('/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const sell = (q: string) => post('/api/pos/orders', { sessionId, lines: [{ productId: menu, qty: q }], payments: [{ method: 'CASH', amount: '5000000' }] });

  it('menu tanpa resep aktif ditolak dengan pesan yang jelas, stok tidak berubah', async () => {
    const r = await sell('1').expect(400);
    expect(JSON.stringify(r.body)).toContain('belum punya resep aktif');
    expect(await qty(kopi)).toBe(1000);
  });

  it('menu boleh dibuat, tetapi barang setengah jadi tidak bisa menjadi menu', async () => {
    const r = await post('/api/products', { sku: 'MN-SEMI', name: 'Salah', sellPrice: '1', madeToOrder: true, inventoryKind: 'SEMI' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('setengah jadi');
  });

  let orderId: string;
  let cogs0: number;
  let inv0: number;
  let sales0: number;

  it('setelah resep dibuat: porsi tersedia dihitung dari bahan; penjualan memotong bahan dan HPP dari bahan', async () => {
    await post('/api/production/boms', { name: 'Resep Kopi Susu', productId: menu, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: '18' }, { productId: susu, qty: '150' }] }).expect(201);
    const list = (await get(`/api/pos/products?warehouseId=${W}`).expect(200)).body as { id: string; stock: string; madeToOrder: boolean }[];
    const m = list.find((p) => p.id === menu)!;
    expect(m.madeToOrder).toBe(true);
    expect(Number(m.stock)).toBe(33); // min(1000/18 = 55, 5000/150 = 33)
    cogs0 = await bal('5-1000');
    inv0 = await bal('1-1400');
    sales0 = await bal('4-1000');
    const o = (await sell('2').expect(201)).body;
    orderId = o.id;
    expect(o.lines[0].fromRecipe).toBe(true);
    expect(Number(o.lines[0].unitCost)).toBeCloseTo(6600, 2); // 18 × 200 + 150 × 20 per porsi
    expect(await qty(kopi)).toBe(964);
    expect(await qty(susu)).toBe(4700);
    expect(await qty(menu)).toBe(0); // stok menu sendiri tidak disentuh
    expect(Number(o.cogsAmount)).toBeCloseTo(13200, 2);
    expect(await bal('5-1000')).toBeCloseTo(cogs0 + 13200, 2);
    expect(await bal('1-1400')).toBeCloseTo(inv0 - 13200, 2);
    expect(await bal('4-1000')).toBeCloseTo(sales0 + 50000, 2); // pendapatan 2 × 25.000
  });

  it('bahan tidak cukup menolak penjualan dan tidak memotong sebagian bahan', async () => {
    const r = await sell('40').expect(400); // butuh 6000 ml susu, tersisa 4700
    expect(JSON.stringify(r.body).toLowerCase()).toContain('stok');
    expect(await qty(kopi)).toBe(964);
    expect(await qty(susu)).toBe(4700);
  });

  it('retur menu: pendapatan dibalik, bahan tidak kembali ke stok, biaya bahan tetap tercatat', async () => {
    const r = (await post(`/api/pos/orders/${orderId}/return`, { all: true, reason: 'pelanggan membatalkan pesanan' }).expect(201)).body;
    expect(Number(r.cogsAmount)).toBe(0);
    expect(await qty(kopi)).toBe(964);
    expect(await qty(susu)).toBe(4700);
    expect(await bal('5-1000')).toBeCloseTo(cogs0 + 13200, 2);
    expect(await bal('1-1400')).toBeCloseTo(inv0 - 13200, 2);
    expect(await bal('4-1000')).toBeCloseTo(sales0 + 50000, 2);
    expect(Math.abs(await bal('4-1100'))).toBeCloseTo(50000, 2); // retur penjualan = lawan pendapatan
  });

  it('tutup kasir tetap cocok dan buku besar seimbang', async () => {
    const cur = (await get('/api/pos/sessions/current').expect(200)).body;
    const closed = (await post(`/api/pos/sessions/${sessionId}/close`, { countedCash: String(Number(cur.summary.expectedCash)) }).expect(201)).body;
    expect(Number(closed.difference)).toBe(0);
    await bal('1-1400');
  });
});
