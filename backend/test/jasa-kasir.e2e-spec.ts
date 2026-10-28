/**
 * Jasa: kasir untuk layanan tanpa stok (bengkel, salon, klinik): petugas per baris, bahan habis pakai lewat resep, retur tanpa stok, kinerja petugas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jasa: kasir layanan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let cashier = ''; let ritel = '';
  let W = ''; let svc = ''; let svc2 = ''; let bahan = ''; let sessionId = ''; let staffA = ''; let staffB = '';
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const sell = (lines: object[]) => post(cashier, '/api/pos/orders', { sessionId, lines, payments: [{ method: 'CASH', amount: '5000000' }] });
  const stockOf = async (id: string) => Number(((await get(owner, `/api/inventory/balances?productId=${id}`).expect(200)).body[0]?.qty) ?? 0);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Bengkel Layanan', name: 'Pemilik', email: `jk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    ritel = (await http.post('/api/auth/register').send({ companyName: 'Toko Biasa', name: 'Pemilik', email: `jk-r-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/pos/install').expect(201);
    await post(owner, '/api/apps/hr/install').expect(201);
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    await post(owner, '/api/users', { name: 'Kasir', email: `jk-k-${stamp}@uji.id`, password: 'rahasia12345', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `jk-k-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    staffA = (await post(owner, '/api/hr/employees', { code: 'T1', name: 'Teknisi Andi', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '4000000' }).expect(201)).body.id;
    staffB = (await post(owner, '/api/hr/employees', { code: 'T2', name: 'Teknisi Budi', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '4000000' }).expect(201)).body.id;
    bahan = (await post(owner, '/api/products', { sku: 'OLI', name: 'Oli mesin', baseUom: 'LITER', sellPrice: '0' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: bahan, qty: '20', unitCost: '40000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('layanan hanya untuk jenis usaha Jasa; tidak boleh jadi menu', async () => {
    expect((await post(ritel, '/api/products', { sku: 'LY-X', name: 'Layanan', sellPrice: '1000', isService: true })).status).toBe(400);
    svc = (await post(owner, '/api/products', { sku: 'SRV-TUNE', name: 'Servis ringan', baseUom: 'KUNJUNGAN', sellPrice: '150000', isService: true }).expect(201)).body.id;
    svc2 = (await post(owner, '/api/products', { sku: 'SRV-OLI', name: 'Ganti oli', baseUom: 'KUNJUNGAN', sellPrice: '120000', isService: true }).expect(201)).body.id;
    expect((await get(owner, `/api/products/${svc}`).expect(200)).body.isService).toBe(true);
    expect((await post(owner, '/api/products', { sku: 'SRV-BAD', name: 'Salah', sellPrice: '1', isService: true, madeToOrder: true })).status).toBe(400);
  });

  it('layanan tidak punya stok dan tidak bisa dipesan sebagai barang', async () => {
    expect((await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: svc, qty: '5', unitCost: '1000' }] })).status).toBe(400);
    const cust = (await post(owner, '/api/customers', { code: 'C1', name: 'Pelanggan' }).expect(201)).body.id;
    expect((await post(owner, '/api/sales-orders', { customerId: cust, warehouseId: W, lines: [{ productId: svc, qty: '1', price: '150000' }] })).status).toBe(400);
  });

  it('kasir menjual layanan tanpa stok dengan petugas; bahan habis pakai terpotong bila ada resep', async () => {
    sessionId = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
    const staff = (await get(cashier, '/api/pos/staff').expect(200)).body as { id: string; name: string }[];
    expect(staff.map((s) => s.name)).toEqual(expect.arrayContaining(['Teknisi Andi', 'Teknisi Budi']));
    const prods = (await get(cashier, `/api/pos/products?warehouseId=${W}`).expect(200)).body as { id: string; isService?: boolean }[];
    expect(prods.find((p) => p.id === svc)?.isService).toBe(true);
    // tanpa resep: tidak ada stok bergerak
    const r1 = await sell([{ productId: svc, qty: '1', price: '150000', staffId: staffA }]);
    expect(r1.status).toBe(201);
    // dengan resep (bahan oli 4 liter per layanan)
    await post(owner, '/api/production/boms', { code: 'BOM-OLI', name: 'Resep ganti oli', productId: svc2, outputQty: '1', lines: [{ productId: bahan, qty: '4' }] }).expect(201);
    const r2 = await sell([{ productId: svc2, qty: '2', price: '120000', staffId: staffB }]);
    expect(r2.status).toBe(201);
    expect(await stockOf(bahan)).toBe(12); // 20 − 2×4
    expect(Number((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced === true)).toBe(1);
    // petugas harus pegawai aktif
    expect((await sell([{ productId: svc, qty: '1', price: '150000', staffId: '00000000-0000-4000-8000-000000000000' }])).status).toBe(400);
  });

  it('retur layanan tidak menambah stok; kinerja petugas mengurangi retur', async () => {
    const orders = (await get(owner, `/api/pos/orders?sessionId=${sessionId}`).expect(200)).body as { id: string }[];
    let orderId = '';
    let lineId = '';
    for (const o of orders) {
      const ord = (await get(owner, `/api/pos/orders/${o.id}`).expect(200)).body;
      const line = ord.lines.find((l: { productId: string }) => l.productId === svc2);
      if (line) { orderId = o.id; lineId = line.id; }
    }
    expect(orderId).not.toBe('');
    await post(owner, `/api/pos/orders/${orderId}/return`, { reason: 'Pelanggan batal satu layanan', lines: [{ orderLineId: lineId, qty: '1' }] }).expect(201);
    expect(await stockOf(bahan)).toBe(12); // bahan sudah terpakai: tidak kembali
    const rep = (await get(owner, '/api/pos/staff-sales').expect(200)).body as { name: string; revenue: string }[];
    expect(rep.find((r) => r.name === 'Teknisi Andi')?.revenue).toBe('150000.00');
    // Budi: 2 layanan × 120.000, 1 diretur → 120.000
    expect(Number(rep.find((r) => r.name === 'Teknisi Budi')?.revenue)).toBe(120000);
  });
});
