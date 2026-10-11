/** Mata uang asing: kurs, faktur jual/beli valas, selisih kurs terealisasi, penilaian ulang akhir periode */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Mata uang asing (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  let gudang: string;
  let wh: string;
  let cust: string;
  let supp: string;
  let prod: string;
  const stamp = Date.now();
  const as = (tok = t) => ({ Authorization: `Bearer ${tok}` });
  const get = (u: string, tok = t) => http.get(u).set(as(tok));
  const post = (u: string, b: object = {}, tok = t) => http.post(u).set(as(tok)).send(b);
  const put = (u: string, b: object = {}, tok = t) => http.put(u).set(as(tok)).send(b);
  const today = new Date().toISOString().slice(0, 10);
  // saldo sisi normal akun (aset/beban positif bila debit; liabilitas/pendapatan positif bila kredit); `to` membatasi tanggal laporan
  const bal = async (code: string, to?: string) => {
    const tb = (await get(`/api/accounting/reports/trial-balance${to ? `?to=${to}` : ''}`).expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const health = async (key: string) => ((await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[]).find((c) => c.key === key);
  let invId: string;
  let apId: string;
  let apBefore = 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    t = (await http.post('/api/auth/register').send({ companyName: 'PT Ekspor Impor', name: 'Pemilik', email: `fx-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'Gudang', email: `fx-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    gudang = (await http.post('/api/auth/login').send({ email: `fx-g-${stamp}@uji.id`, password: 'gudang12345' }).expect(200)).body.accessToken;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    cust = (await post('/api/customers', { code: 'BUY', name: 'Buyer Singapore Pte' }).expect(201)).body.id;
    supp = (await post('/api/suppliers', { code: 'SUP', name: 'Supplier Shenzhen' }).expect(201)).body.id;
    prod = (await post('/api/products', { sku: 'BRG', name: 'Barang', sellPrice: '1000' }).expect(201)).body.id;
    // stok rupiah untuk dijual
    const po = (await post('/api/purchase-orders/quick', { supplierId: supp, warehouseId: wh, receiveNow: true, lines: [{ productId: prod, qty: '500', price: '50000' }] }).expect(201)).body;
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'IDR-1' }).expect(201);
  });
  afterAll(() => app.close());

  it('kurs: hanya admin/keuangan, mata uang dikenal, kurs positif, menimpa kurs di tanggal sama', async () => {
    await put('/api/fx/rates', { currency: 'USD', rate: '16000' }, gudang).expect(403);
    await put('/api/fx/rates', { currency: 'XYZ', rate: '10' }).expect(400);
    await put('/api/fx/rates', { currency: 'USD', rate: '0' }).expect(400);
    await put('/api/fx/rates', { currency: 'USD', rate: '16000', note: 'JISDOR' }).expect(200);
    await put('/api/fx/rates', { currency: 'USD', rate: '16000', note: 'JISDOR (koreksi)' }).expect(200);
    const rates = (await get('/api/fx/rates?currency=USD').expect(200)).body;
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ currency: 'USD', note: 'JISDOR (koreksi)' });
    expect(Number(rates[0].rate)).toBe(16000);
    expect((await get('/api/fx/rate?currency=USD').expect(200)).body.rate).toMatch(/^16000/);
    expect((await get('/api/fx/currencies').expect(200)).body.some((c: { code: string }) => c.code === 'USD')).toBe(true);
  });

  it('pesanan valas: harga dalam USD, Rupiah dari kurs, PPN dari DPP rupiah; kurs belum ada ditolak', async () => {
    const base = { customerId: cust, warehouseId: wh, lines: [{ productId: prod, qty: '100', price: '10' }] };
    await post('/api/sales-orders', { ...base, currency: 'EUR' }).expect(400); // kurs EUR belum ada
    await post('/api/sales-orders', { ...base, currency: 'XYZ', fxRate: '1' }).expect(400);
    await post('/api/sales-orders', { ...base, currency: 'USD', pricesIncludeVat: true }).expect(400);
    await post('/api/sales-orders', { ...base, currency: 'USD', lines: [{ productId: prod, qty: '1' }] }).expect(400); // harga wajib
    const so = (await post('/api/sales-orders', { ...base, currency: 'USD' }).expect(201)).body;
    expect(so).toMatchObject({ currency: 'USD', subtotal: '16000000.00', taxAmount: '1760000.00', total: '17760000.00', totalForeign: '1110.00' });
    expect(Number(so.fxRate)).toBe(16000);
    expect(Number(so.lines[0].priceForeign)).toBe(10);
    expect(Number(so.lines[0].price)).toBe(160000);
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    invId = inv.id;
    expect(inv).toMatchObject({ currency: 'USD', total: '17760000.00', totalForeign: '1110.00', paidForeign: '0.00' });
    expect(await bal('1-1300')).toBe(17760000);
  });

  it('pelunasan sebagian dengan kurs lebih tinggi: laba kurs terealisasi, piutang rupiah berkurang pada kurs faktur', async () => {
    await post('/api/payments', { invoiceId: invId, amount: '1200', fxRate: '16200' }).expect(400); // melebihi sisa 1.110 USD
    await post('/api/payments', { invoiceId: invId, amount: '500' }).expect(201); // kurs hari bayar = kurs tersimpan 16.000 → tanpa selisih
    expect(await bal('4-9300')).toBe(0);
    const p = (await post('/api/payments', { invoiceId: invId, amount: '100', fxRate: '16200' }).expect(201)).body;
    expect(p).toMatchObject({ currency: 'USD', amount: '1600000.00', cashAmount: '1620000.00', fxGainLoss: '20000.00' });
    expect(await bal('4-9300')).toBe(20000);
    const inv = (await get(`/api/invoices/${invId}`).expect(200)).body;
    expect(inv).toMatchObject({ paidForeign: '600.00', paidAmount: '9600000.00', status: 'PARTIAL' });
    expect(await bal('1-1300')).toBe(8160000);
    expect((await health('ar'))?.status).toBe('OK');
  });

  it('PO valas: kurs PO dipakai faktur; hutang tercatat pada kurs PO', async () => {
    await post('/api/purchase-orders', { supplierId: supp, warehouseId: wh, currency: 'USD', lines: [{ productId: prod, qty: '100', price: '5' }], pricesIncludeVat: true }).expect(400);
    apBefore = await bal('2-1100');
    const po = (await post('/api/purchase-orders', { supplierId: supp, warehouseId: wh, currency: 'USD', fxRate: '16000', lines: [{ productId: prod, qty: '100', price: '5' }] }).expect(201)).body;
    expect(po).toMatchObject({ currency: 'USD', subtotal: '8000000.00', taxAmount: '880000.00', total: '8880000.00', totalForeign: '555.00' });
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    // harga faktur valas mengikuti PO
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'SZ-1', varianceReason: 'OTHER', varianceNote: 'harga berubah', prices: [{ orderLineId: po.lines[0].id, price: '90000' }] }).expect(400);
    const inv = (await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'SZ-1' }).expect(201)).body;
    apId = inv.id;
    expect(inv).toMatchObject({ currency: 'USD', total: '8880000.00', totalForeign: '555.00' });
    expect(await bal('2-1100')).toBe(apBefore + 8880000);
  });

  it('penilaian ulang akhir periode: piutang dan utang valas dinilai pada kurs penutup, dibalik otomatis, subbuku tetap cocok', async () => {
    const exp = (await get('/api/fx/exposure').expect(200)).body;
    expect(exp.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(['AP', 'AR']);
    expect(exp.rows.find((r: { kind: string }) => r.kind === 'AR')).toMatchObject({ currency: 'USD', outstandingForeign: '510.00', carrying: '8160000.00' });
    await post('/api/fx/revaluation', {}, gudang).expect(403);
    await put('/api/fx/rates', { currency: 'USD', rate: '16500', note: 'Kurs penutup' }).expect(200);
    const rv = (await post('/api/fx/revaluation').expect(201)).body;
    // piutang: 510 USD × 16.500 = 8.415.000 − 8.160.000 = laba 255.000; utang: 555 × 16.500 = 9.157.500 − 8.880.000 = rugi 277.500
    expect(rv).toMatchObject({ receivable: '255000.00', payable: '-277500.00', net: '-22500.00' });
    expect(await bal('1-1305', today)).toBe(255000);
    expect(await bal('2-1105', today)).toBe(277500); // liabilitas bertambah 277.500 (sisi kredit)
    expect(await bal('4-9300', today)).toBe(20000);
    expect(await bal('8-3000', today)).toBe(22500); // rugi bersih belum terealisasi (277.500 − 255.000)
    expect((await health('ar'))?.status).toBe('OK');
    expect((await health('ap'))?.status).toBe('OK');
    // besok dibalik otomatis
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(await bal('1-1305', tomorrow)).toBe(0);
    expect(await bal('2-1105', tomorrow)).toBe(0);
    await post('/api/fx/revaluation').expect(400); // tanggal yang sama tidak dua kali
  });

  it('CALK memuat catatan mata uang asing; cek kesehatan mengingatkan kurs dan penilaian ulang', async () => {
    const year = new Date().getFullYear();
    const n = (await get(`/api/accounting/notes/${year}`).expect(200)).body as { sections: { key: string; title: string; paragraphs: string[]; tables: { rows: unknown[][] }[] }[] };
    const fx = n.sections.find((x) => x.key === 'foreign-currency')!;
    expect(fx.title).toMatch(/mata uang asing/i);
    expect(fx.paragraphs.join(' ')).toMatch(/terealisasi/);
    expect(fx.tables[0].rows[0][0]).toBe('USD');
    const basis = n.sections.find((x) => x.key === 'basis') ?? n.sections[0];
    expect(JSON.stringify(n.sections)).toMatch(/PSAK 10/);
    expect(basis).toBeTruthy();
    const c = ((await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[]).find((x) => x.key === 'fx');
    expect(c?.status).toBe('OK'); // kurs diperbarui hari ini dan penilaian ulang sudah dicatat
  });

  it('pelunasan akhir piutang menghitung selisih dari nilai tercatat awal (bukan nilai revaluasi)', async () => {
    const p = (await post('/api/payments', { invoiceId: invId, amount: '510', fxRate: '16300' }).expect(201)).body;
    expect(p).toMatchObject({ amount: '8160000.00', cashAmount: '8313000.00', fxGainLoss: '153000.00' });
    const inv = (await get(`/api/invoices/${invId}`).expect(200)).body;
    expect(inv).toMatchObject({ status: 'PAID', paidAmount: '17760000.00', paidForeign: '1110.00' });
    expect(await bal('1-1300')).toBe(0);
  });

  it('pelunasan hutang valas dengan kurs lebih tinggi menjadi rugi kurs terealisasi', async () => {
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: apId, amount: '600', fxRate: '16100' }).expect(400);
    const pay = (await post('/api/purchase-invoices/payments', { purchaseInvoiceId: apId, amount: '555', fxRate: '16100' }).expect(201)).body;
    expect(pay).toMatchObject({ amount: '8880000.00', cashAmount: '8935500.00', fxGainLoss: '-55500.00' });
    expect(await bal('2-1100')).toBe(apBefore);
    expect((await health('ap'))?.status).toBe('OK');
    expect((await get(`/api/purchase-invoices/${apId}`).expect(200)).body).toMatchObject({ status: 'PAID', paidForeign: '555.00' });
  });

  it('retur dan uang muka untuk faktur valas ditolak dengan pesan jelas', async () => {
    const inv = (await get(`/api/invoices/${invId}`).expect(200)).body;
    const r = await post('/api/sales-returns', { invoiceId: invId, lines: [{ invoiceLineId: inv.lines[0].id, qty: '1' }] }).expect(400);
    expect(r.body.message).toMatch(/USD/);
  });
});
