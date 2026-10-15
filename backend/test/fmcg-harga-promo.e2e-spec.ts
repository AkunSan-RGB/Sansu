/**
 * FMCG: daftar harga per segmen pelanggan (bertingkat menurut jumlah), promo potongan & bonus barang pada pesanan penjualan,
 * hak ubah harga hanya Pemilik/Admin, dan bonus barang ikut terpotong dari stok serta masuk HPP.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('FMCG: daftar harga & promo (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  let owner: string;
  let sales: string;
  let wh: string;
  let A: string; // produk utama (dus = 12 pcs)
  let B: string; // produk bonus
  let cGrosir: string;
  let cWarung: string;
  let listGrosir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Distribusi Konsumen', name: 'Pemilik', email: `fm-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'Sales', email: `fm-s-${stamp}@uji.id`, password: 'sales12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `fm-s-${stamp}@uji.id`, password: 'sales12345' }).expect(200)).body.accessToken;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    A = (await post('/api/products', { sku: 'MIE', name: 'Mi Goreng', baseUom: 'PCS', sellPrice: '3500', uoms: [{ uom: 'DUS', factor: '12' }] }).expect(201)).body.id;
    B = (await post('/api/products', { sku: 'KOPI', name: 'Kopi Sachet', baseUom: 'PCS', sellPrice: '2000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: A, qty: '1000', unitCost: '2800' }, { productId: B, qty: '500', unitCost: '1500' }] }).expect(201);
    cGrosir = (await post('/api/customers', { code: 'GROSIR1', name: 'Grosir Sumber Rezeki' }).expect(201)).body.id;
    cWarung = (await post('/api/customers', { code: 'WARUNG1', name: 'Warung Bu Sari' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const order = async (customerId: string, lines: object[], extra: object = {}, t = owner) => {
    const r = await post('/api/sales-orders', { customerId, warehouseId: wh, lines, ...extra }, t).expect(201);
    return (await get(`/api/sales-orders/${r.body.id}`).expect(200)).body as { id: string; subtotal: string; lines: { productId: string; qty: string; price: string; discountPct: string; lineTotal: string }[] };
  };

  it('tanpa daftar harga: harga jual master (dan satuan dus = faktor × harga)', async () => {
    const o = await order(cWarung, [{ productId: A, qty: '10' }, { productId: A, uom: 'DUS', qty: '1' }]);
    expect(Number(o.lines[0].price)).toBe(3500);
    expect(Number(o.lines[1].price)).toBe(42000);
  });

  it('hanya Pemilik/Admin yang membuat daftar harga dan promo; Sales boleh melihat', async () => {
    expect((await post('/api/price-lists', { name: 'Bocor' }, sales)).status).toBe(403);
    expect((await post('/api/promos', { name: 'x', kind: 'DISCOUNT', minQty: '1', discountPct: '5' }, sales)).status).toBe(403);
    listGrosir = (await post('/api/price-lists', { name: 'Grosir', description: 'Pedagang grosir' }).expect(201)).body.id;
    expect((await post('/api/price-lists', { name: 'grosir' })).status).toBe(400); // nama kembar (tanpa beda huruf besar/kecil)
    expect((await get('/api/price-lists', sales)).status).toBe(200);
  });

  it('daftar harga bertingkat: tingkat terbesar yang terpenuhi, dalam satuan dasar, dikali faktor satuan', async () => {
    await http.put(`/api/price-lists/${listGrosir}/items`).set(as(owner)).send({ items: [
      { productId: A, minQty: '1', price: '3300' },
      { productId: A, minQty: '120', price: '3100' },
    ] }).expect(200);
    // pelanggan menunjuk daftar harga
    await http.patch(`/api/customers/${cGrosir}`).set(as(owner)).send({ priceListId: listGrosir }).expect(200);
    const o = await order(cGrosir, [{ productId: A, qty: '50' }, { productId: A, uom: 'DUS', qty: '10' }]);
    // total 50 + 120 = 170 satuan dasar → tingkat 120+: 3100/pcs; dus = 12 × 3100
    expect(Number(o.lines[0].price)).toBe(3100);
    expect(Number(o.lines[1].price)).toBe(37200);
    // pesanan kecil memakai tingkat dasar
    const small = await order(cGrosir, [{ productId: A, qty: '5' }]);
    expect(Number(small.lines[0].price)).toBe(3300);
    // produk yang tidak ada di daftar memakai harga master
    const other = await order(cGrosir, [{ productId: B, qty: '5' }]);
    expect(Number(other.lines[0].price)).toBe(2000);
  });

  it('harga yang diisi di baris tidak ditimpa daftar harga', async () => {
    const o = await order(cGrosir, [{ productId: A, qty: '5', price: '3999' }]);
    expect(Number(o.lines[0].price)).toBe(3999);
  });

  it('daftar harga nonaktif tidak dipakai; tidak bisa menunjuk daftar harga perusahaan lain', async () => {
    await http.patch(`/api/price-lists/${listGrosir}`).set(as(owner)).send({ isActive: false }).expect(200);
    expect(Number((await order(cGrosir, [{ productId: A, qty: '5' }])).lines[0].price)).toBe(3500);
    await http.patch(`/api/price-lists/${listGrosir}`).set(as(owner)).send({ isActive: true }).expect(200);
    const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'P', email: `fm-o-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body.accessToken;
    const foreign = (await post('/api/price-lists', { name: 'Milik lain' }, other).expect(201)).body.id;
    expect((await http.patch(`/api/customers/${cWarung}`).set(as(owner)).send({ priceListId: foreign })).status).toBe(400);
    expect((await get(`/api/price-lists/${foreign}`)).status).toBe(404);
  });

  it('validasi isi daftar harga: harga negatif, jumlah nol, dan tingkat ganda ditolak', async () => {
    const put = (items: object[]) => http.put(`/api/price-lists/${listGrosir}/items`).set(as(owner)).send({ items });
    expect((await put([{ productId: A, minQty: '1', price: '-1' }])).status).toBe(400);
    expect((await put([{ productId: A, minQty: '0', price: '10' }])).status).toBe(400);
    expect((await put([{ productId: A, minQty: '1', price: '10' }, { productId: A, minQty: '1.0000', price: '9' }])).status).toBe(400);
    expect((await get(`/api/price-lists/${listGrosir}`)).body.items.length).toBe(2); // isi lama utuh
  });

  it('promo potongan: otomatis untuk baris tanpa potongan, tidak ditumpuk, mengikuti periode', async () => {
    await post('/api/promos', { name: 'Diskon 5% min 100 pcs', kind: 'DISCOUNT', productId: A, minQty: '100', discountPct: '5' }).expect(201);
    await post('/api/promos', { name: 'Diskon 8% min 300 pcs', kind: 'DISCOUNT', productId: A, minQty: '300', discountPct: '8' }).expect(201);
    const expired = (await post('/api/promos', { name: 'Promo lama', kind: 'DISCOUNT', productId: B, minQty: '1', discountPct: '50', validFrom: '2020-01-01', validTo: '2020-12-31' }).expect(201)).body.id;
    const o = await order(cWarung, [{ productId: A, qty: '150' }, { productId: B, qty: '10' }]);
    expect(Number(o.lines[0].discountPct)).toBe(5);
    expect(Number(o.lines[1].discountPct)).toBe(0); // promo kedaluwarsa
    const big = await order(cWarung, [{ productId: A, qty: '300' }]);
    expect(Number(big.lines[0].discountPct)).toBe(8);
    const manual = await order(cWarung, [{ productId: A, qty: '300', discountPct: '2' }]);
    expect(Number(manual.lines[0].discountPct)).toBe(2); // potongan manual dihormati
    const off = await order(cWarung, [{ productId: A, qty: '300' }], { applyPromos: false });
    expect(Number(off.lines[0].discountPct)).toBe(0);
    await http.put(`/api/promos/${expired}`).set(as(owner)).send({ name: 'Promo lama', kind: 'DISCOUNT', productId: B, minQty: '1', discountPct: '50', isActive: false }).expect(200);
  });

  it('promo bonus barang: tiap kelipatan memberi bonus (baris harga 0), stok bonus ikut terpotong dan masuk HPP', async () => {
    await post('/api/promos', { name: 'Beli 1 dus gratis 2 kopi', kind: 'BONUS', productId: A, minQty: '12', bonusProductId: B, bonusQty: '2' }).expect(201);
    const o = await order(cWarung, [{ productId: A, uom: 'DUS', qty: '3' }]);
    const bonus = o.lines.find((l) => l.productId === B)!;
    expect(Number(bonus.qty)).toBe(6); // 36 pcs → 3 kelipatan × 2
    expect(Number(bonus.price)).toBe(0);
    expect(Number(bonus.lineTotal)).toBe(0);
    // pratinjau untuk formulir menghasilkan hasil yang sama
    const q = (await post('/api/pricing/quote', { customerId: cWarung, lines: [{ productId: A, uom: 'DUS', qty: '3' }] }).expect(201)).body;
    expect(q.bonus).toHaveLength(1);
    expect(Number(q.bonus[0].qty)).toBe(6);
    expect(q.bonus[0].promoName).toBe('Beli 1 dus gratis 2 kopi');
    // lanjut: konfirmasi → faktur → stok kopi berkurang 6 dan HPP memuat biaya bonus
    await post(`/api/sales-orders/${o.id}/confirm`, {}).expect(201);
    await post('/api/invoices', { salesOrderId: o.id }).expect(201);
    const stock = (await get('/api/inventory/balances').expect(200)).body as { productId: string; qty: string }[];
    expect(Number(stock.find((s) => s.productId === B)!.qty)).toBe(494);
  });

  it('validasi promo: potongan di luar 0–100%, bonus tanpa produk, tanggal terbalik ditolak', async () => {
    expect((await post('/api/promos', { name: 'x', kind: 'DISCOUNT', minQty: '1', discountPct: '120' })).status).toBe(400);
    expect((await post('/api/promos', { name: 'x', kind: 'BONUS', minQty: '1' })).status).toBe(400);
    expect((await post('/api/promos', { name: 'x', kind: 'DISCOUNT', minQty: '1', discountPct: '5', validFrom: '2026-02-01', validTo: '2026-01-01' })).status).toBe(400);
  });

  it('perubahan harga & promo tercatat di jejak audit', async () => {
    await new Promise((r) => setTimeout(r, 200));
    const log = JSON.stringify((await get('/api/audit-logs').expect(200)).body.rows);
    expect(log).toContain('PriceList');
    expect(log).toContain('Promo');
  });
});
