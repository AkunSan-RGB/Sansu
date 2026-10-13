/**
 * Kontrol pembelian anti-fraud (e2e): peringatan pemasok mirip/ganda, pembayaran pertama ke pemasok butuh persetujuan,
 * PO dipecah di bawah batas persetujuan, dan temuan di halaman Kontrol pembelian.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kontrol pembelian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let expenseId: string;
  let warehouseId: string;
  let productId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const day = todayJakarta();
  let n = 0;
  const bill = async (supplierId: string, price = '100000') =>
    (await post(owner, '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `KP-${stamp}-${++n}`, withVat: false, lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: expenseId, price }] }).expect(201)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Beli', name: 'Pemilik', email: `kb-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `kb-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `kb-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    expenseId = ((await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string }[]).find((a) => a.type === 'EXPENSE')!.id;
    warehouseId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    productId = (await post(owner, '/api/products', { sku: 'KB-1', name: 'Barang', sellPrice: '10000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('pemasok dengan NPWP atau nama mirip ditahan sampai dikonfirmasi', async () => {
    await post(finance, '/api/suppliers', { code: 'S-A', name: 'PT Maju Jaya', npwp: '0123456789012345' }).expect(201);
    const dupName = await post(finance, '/api/suppliers', { code: 'S-B', name: 'CV. Maju-Jaya' }).expect(409);
    expect(dupName.body.code).toBe('POSSIBLE_DUPLICATE_SUPPLIER');
    const dupNpwp = await post(finance, '/api/suppliers', { code: 'S-C', name: 'Beda Nama', npwp: '01.234.567.8-901.2345' }).expect(409);
    expect(dupNpwp.body.matches[0].code).toBe('S-A');
    await post(finance, '/api/suppliers', { code: 'S-B', name: 'CV. Maju-Jaya', confirmDuplicate: true }).expect(201);
    await post(finance, '/api/suppliers', { code: 'S-D', name: 'Sama Sekali Lain' }).expect(201);
  });

  it('pembayaran pertama ke pemasok oleh staf menunggu persetujuan (bila diaktifkan); berikutnya normal', async () => {
    const sup = (await post(owner, '/api/suppliers', { code: 'S-FIRST', name: 'Pemasok Pertama Bayar' }).expect(201)).body.id;
    const b1 = await bill(sup);
    const b2 = await bill(sup);
    // kebijakan mati: langsung bisa
    await put(owner, '/api/approvals/policy', { firstSupplierPayment: true }).expect(200);
    const res = await post(finance, '/api/purchase-invoices/payments', { purchaseInvoiceId: b1.id, amount: '50000', date: day }).expect(409);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
    // pemilik menyetujui → dibayar
    await post(owner, `/api/approvals/${res.body.requestId}/approve`, {}).expect(201);
    const inv1 = (await get(owner, `/api/purchase-invoices/${b1.id}`).expect(200)).body;
    expect(Number(inv1.paidAmount)).toBe(50000);
    // sudah pernah dibayar → pembayaran berikutnya oleh staf langsung jalan
    await post(finance, '/api/purchase-invoices/payments', { purchaseInvoiceId: b2.id, amount: '10000', date: day }).expect(201);
    await put(owner, '/api/approvals/policy', { firstSupplierPayment: false }).expect(200);
  });

  it('halaman kontrol menandai PO yang dipecah di bawah batas persetujuan', async () => {
    await put(owner, '/api/approvals/policy', { purchaseOrder: 1000000 }).expect(200);
    const sup = (await post(owner, '/api/suppliers', { code: 'S-SPLIT', name: 'Pemasok Pecah' }).expect(201)).body.id;
    for (let i = 0; i < 3; i++) {
      await post(owner, '/api/purchase-orders', { supplierId: sup, warehouseId, lines: [{ productId, qty: '1', price: '600000' }] }).expect(201);
    }
    const r = (await get(finance, '/api/purchase-controls').expect(200)).body as { items: { key: string; refs: string[] }[] };
    expect(r.items.find((i) => i.key === 'PO_SPLIT')?.refs.length).toBe(3);
    await get(owner, '/api/purchase-controls').expect(200);
  });
});
