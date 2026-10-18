/**
 * Kontrol alur PO (e2e): tagihan hanya atas barang yang diterima Gudang (pencocokan tiga arah), penerimaan buta,
 * alasan pembatalan PO terkonfirmasi, perubahan rekening supplier wajib disetujui + pembayaran ditahan, tugas "PO menunggu barang".
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kontrol PO (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string; let wh: string; let buy: string;
  let whId: string; let prod: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const patch = (t: string, u: string, b: object = {}) => http.patch(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `kpo-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `kpo-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  let sup: string;
  const newPo = async (qty = '10') => {
    const po = (await post(buy, '/api/purchase-orders', { supplierId: sup, warehouseId: whId, lines: [{ productId: prod, qty, price: '5000' }] }).expect(201)).body;
    await post(buy, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    return po as { id: string; number: string; lines: { id: string }[] };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol PO', name: 'P', email: `kpo-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    fin = await login('FINANCE', 'fin');
    wh = await login('WAREHOUSE', 'wh');
    buy = await login('PURCHASING', 'buy');
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'KPO-1', name: 'Barang Uji', sellPrice: '10000' }).expect(201)).body.id;
    sup = (await post(owner, '/api/suppliers', { code: 'S-KPO', name: 'Pemasok Uji', bankName: 'BCA', bankAccountNo: '1234567890', bankAccountName: 'Pemasok Uji' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('tagihan tanpa penerimaan Gudang ditolak untuk Keuangan; setelah diterima baru boleh', async () => {
    const po = await newPo();
    const r = await post(fin, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `KPO-${stamp}-1`, date: day });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('belum diterima Gudang');
    await post(wh, `/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    expect((await post(fin, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `KPO-${stamp}-1`, date: day })).status).toBe(201);
  });

  it('penerimaan buta: Gudang wajib mengisi jumlah hitungannya (bila dinyalakan)', async () => {
    await put(owner, '/api/approvals/policy', { blindReceiving: true }).expect(200);
    const po = await newPo();
    const r = await post(wh, `/api/purchase-orders/${po.id}/receipts`, {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('penerimaan buta');
    // jumlah kurang dari pesanan tetap bisa dicatat (selisih dikabarkan), tidak bisa lebih dari sisa
    await post(wh, `/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: po.lines[0].id, qty: '12' }] }).expect(400);
    await post(wh, `/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: po.lines[0].id, qty: '8' }] }).expect(201);
    await put(owner, '/api/approvals/policy', { blindReceiving: false }).expect(200);
  });

  it('PO terkonfirmasi: pembatalan oleh staf wajib beralasan dan tercatat; tugas Gudang "PO menunggu barang"', async () => {
    const po = await newPo();
    const tasks = (await get(wh, '/api/tasks/mine').expect(200)).body as { key: string }[];
    expect(tasks.some((t) => t.key === 'po-awaiting-goods')).toBe(true);
    expect((await post(buy, `/api/purchase-orders/${po.id}/cancel`, {})).status).toBe(400);
    await post(buy, `/api/purchase-orders/${po.id}/cancel`, { reason: 'Pemasok kehabisan stok' }).expect(201);
    const found = (await get(owner, '/api/purchase-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    expect(found.find((f) => f.key === 'PO_CANCELLED_AFTER_CONFIRM')?.refs.join()).toContain('Pemasok kehabisan stok');
  });

  it('ubah rekening supplier oleh Keuangan menunggu persetujuan; pembayaran ditahan beberapa hari setelah rekening berubah', async () => {
    const r = await patch(fin, `/api/suppliers/${sup}`, { bankAccountNo: '9999888877' }); if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    expect(r.body.bankChangePending).toBe(true);
    expect((await get(owner, `/api/suppliers/${sup}`).expect(200)).body.bankAccountNo).toBe('1234567890'); // belum berubah
    await post(owner, `/api/approvals/${r.body.approvalId}/approve`, {}).expect(201);
    expect((await get(owner, `/api/suppliers/${sup}`).expect(200)).body.bankAccountNo).toBe('9999888877');
    // pembayaran oleh Keuangan ke supplier ini ditahan untuk persetujuan
    const po = await newPo();
    await post(wh, `/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    const inv = (await post(fin, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `KPO-${stamp}-2`, date: day }).expect(201)).body;
    const pay = await post(fin, '/api/purchase-invoices/payments', { purchaseInvoiceId: inv.id, amount: '10000', date: day });
    expect(pay.status).toBe(409);
    expect(pay.body.code).toBe('APPROVAL_REQUIRED');
    const flagged = (await get(owner, '/api/purchase-controls').expect(200)).body.items as { key: string }[];
    expect(flagged.some((f) => f.key === 'SUPPLIER_BANK_CHANGED')).toBe(true);
    // pemilik/admin langsung mengubah rekening: berlaku seketika dan tercatat
    await patch(owner, `/api/suppliers/${sup}`, { bankAccountNo: '1111222233' }).expect(200);
    expect((await get(owner, `/api/suppliers/${sup}`).expect(200)).body.bankAccountNo).toBe('1111222233');
  });
});
