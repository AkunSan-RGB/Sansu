/**
 * Integrasi menyeluruh (e2e): tagihan biaya & aset dari supplier (PPh 23), setoran pajak & BPJS,
 * rekonsiliasi bank dari mutasi rekening, impor pesanan marketplace + pencairan dana, ekspor XML Coretax.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Integrasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let accounts: { id: string; code: string }[];
  let warehouseId: string;
  let supplierId: string;
  let productId: string;
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(auth());
  const post = (url: string, body: object = {}) => http.post(url).set(auth()).send(body);
  const put = (url: string, body: object = {}) => http.put(url).set(auth()).send(body);
  const balance = async (code: string) => {
    const tb = (await get('/api/accounting/statements/trial-balance?from=2026-01-01&to=2026-12-31').expect(200)).body;
    const r = tb.rows.find((x: { code: string }) => x.code === code);
    return r ? Number(r.closing.debit) - Number(r.closing.credit) : 0;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Terintegrasi', name: 'Pemilik', email: `int-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;
    accounts = (await get('/api/accounting/accounts')).body;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    supplierId = (await post('/api/suppliers', { code: 'SUP-JASA', name: 'CV Jasa Teknik', paymentTermDays: 14 }).expect(201)).body.id;
    productId = (await post('/api/products', { sku: 'SKU-MP', name: 'Produk Marketplace', sellPrice: '11100' }).expect(201)).body.id;
    await post('/api/accounting/opening-balances', {
      date: '2025-12-31',
      lines: [
        { accountId: acc('1-1200'), debit: '500000000' },
        { accountId: acc('3-1000'), credit: '500000000' },
      ],
    }).expect(201);
    await post('/api/inventory/adjustments', {
      warehouseId,
      reason: 'OPENING',
      date: '2025-12-31',
      lines: [{ productId, qty: '1000', unitCost: '8000' }],
    }).expect(201);
  });
  afterAll(() => app.close());

  it('tagihan supplier: biaya jasa dipotong PPh 23 + aset tetap masuk daftar aset', async () => {
    const cats = (await get('/api/assets/categories')).body as { id: string; name: string }[];
    const vehicle = cats.find((c) => c.name === 'Kendaraan')!.id;
    const bill = await post('/api/purchase-invoices/bills', {
      supplierId,
      supplierInvoiceNo: 'JT-001',
      date: '2026-02-10',
      description: 'Servis & pembelian mobil box',
      withholdingType: 'PPH23',
      lines: [
        { type: 'EXPENSE', description: 'Jasa servis AC gudang', accountId: acc('6-7000'), price: '2000000' },
        { type: 'ASSET', description: 'Mobil box L300', assetCategoryId: vehicle, price: '150000000', location: 'Gudang' },
      ],
    }).expect(201);
    // DPP 152 jt, PPN 11% 16,72 jt, PPh 23 2% × 2 jt = 40 rb → dibayar ke supplier 168,68 jt
    expect(Number(bill.body.subtotal)).toBe(152000000);
    expect(Number(bill.body.taxAmount)).toBe(16720000);
    expect(Number(bill.body.withholdingAmount)).toBe(40000);
    expect(Number(bill.body.total)).toBe(168680000);
    expect(bill.body.kind).toBe('BILL');
    const assetLine = bill.body.lines.find((l: { lineType: string }) => l.lineType === 'ASSET');
    expect(assetLine.asset.code).toMatch(/^AT-/);
    const assets = (await get('/api/assets')).body;
    expect(assets).toHaveLength(1);
    expect(Number(assets[0].cost)).toBe(150000000);
    expect(await balance('1-2100')).toBe(150000000);
    expect(await balance('2-1320')).toBe(-40000);
    expect(await balance('2-1100')).toBe(-168680000);
    // retur tidak berlaku untuk tagihan biaya
    await post('/api/purchase-returns', { invoiceId: bill.body.id, lines: [] }).expect(400);
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: bill.body.id, amount: '168680000', date: '2026-02-20' }).expect(201);
    // cek kesehatan: daftar aset = buku besar
    const health = (await get('/api/accounting/health?asOf=2026-02-28')).body;
    expect(health.checks.find((c: { key: string }) => c.key === 'fixed-assets').status).toBe('OK');
  });

  it('marketplace: impor pesanan jadi faktur, pencairan dana dipotong biaya', async () => {
    const imp = await post('/api/integrations/marketplace/import', {
      channel: 'Shopee',
      warehouseId,
      orders: [
        { orderNo: 'SHP-001', date: '2026-02-12', lines: [{ sku: 'SKU-MP', qty: '10', price: '11100' }] },
        { orderNo: 'SHP-002', date: '2026-02-13', lines: [{ sku: 'sku-mp', qty: '5', price: '11100' }] },
        { orderNo: 'SHP-003', date: '2026-02-13', lines: [{ sku: 'TIDAK-ADA', qty: '1', price: '1000' }] },
      ],
    }).expect(201);
    expect(imp.body.imported).toHaveLength(2);
    expect(imp.body.skipped).toHaveLength(1);
    // harga termasuk PPN: 11.100 / 1,11 = 10.000 DPP → 10 pcs = 100.000 + PPN 11.000
    expect(Number(imp.body.imported[0].total)).toBe(111000);
    const again = await post('/api/integrations/marketplace/import', {
      channel: 'Shopee',
      warehouseId,
      orders: [{ orderNo: 'SHP-001', date: '2026-02-12', lines: [{ sku: 'SKU-MP', qty: '10', price: '11100' }] }],
    }).expect(201);
    expect(again.body.skipped[0].reason).toMatch(/Sudah/);
    // dana cair 160.000 dari tagihan 166.500 → biaya 6.500
    const st = await post('/api/integrations/marketplace/settle', { channel: 'Shopee', date: '2026-02-20', cashAccountId: acc('1-1200'), amount: '160000' }).expect(201);
    expect(st.body.orders).toBe(2);
    expect(Number(st.body.fee)).toBe(6500);
    expect(await balance('6-2400')).toBe(6500);
    const orders = (await get('/api/integrations/marketplace/orders?channel=Shopee')).body;
    expect(orders.every((o: { status: string }) => o.status === 'PAID')).toBe(true);
  });

  it('setoran pajak: PPN masa (kurang bayar & lebih bayar), PPh 23, kewajiban otomatis', async () => {
    // Februari: PPN keluaran 11.000 + 5.500 = 16.500; masukan 16.720.000 → lebih bayar
    const feb = (await get('/api/tax/obligations?period=2026-02')).body as { type: string; outstanding: string; status: string; detail?: Record<string, string> }[];
    const ppn = feb.find((o) => o.type === 'PPN')!;
    expect(ppn.status).toBe('BELUM');
    expect(Number(ppn.detail!.ppnKeluaran)).toBe(16500);
    expect(feb.find((o) => o.type === 'PPH23')!.outstanding).toBe('40000.00');
    const comp = await post('/api/tax/payments', { type: 'PPN', period: '2026-02', date: '2026-03-20' }).expect(201);
    expect(Number(comp.body.amount)).toBe(0);
    expect(await balance('2-1200')).toBe(0);
    await post('/api/tax/payments', { type: 'PPH23', period: '2026-02', date: '2026-03-10', ntpn: 'NTPN0001' }).expect(201);
    expect(await balance('2-1320')).toBe(0);
    await post('/api/tax/payments', { type: 'PPH23', period: '2026-02', date: '2026-03-10' }).expect(400);
    // Maret: penjualan besar → PPN keluaran > sisa masukan → kurang bayar
    const so = await post('/api/sales-orders', {
      customerId: (await post('/api/customers', { code: 'BIG', name: 'Toko Besar', paymentTermDays: 30, npwp: '012345678901234' }).expect(201)).body.id,
      warehouseId,
      date: '2026-03-05',
      lines: [{ productId, qty: '900', price: '200000' }],
    }).expect(201);
    await post(`/api/sales-orders/${so.body.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so.body.id, date: '2026-03-05' }).expect(201);
    const mar = (await get('/api/tax/obligations?period=2026-03')).body as { type: string; outstanding: string }[];
    // keluaran 19.800.000 − sisa masukan (16.720.000 − 16.500) = 3.096.500
    expect(Number(mar.find((o) => o.type === 'PPN')!.outstanding)).toBe(3096500);
    const pay = await post('/api/tax/payments', { type: 'PPN', period: '2026-03', date: '2026-04-25', billingCode: '123456789012345' }).expect(201);
    expect(Number(pay.body.amount)).toBe(3096500);
    expect(await balance('2-1200')).toBe(0);
    expect(await balance('1-1500')).toBe(0);
    const list = (await get('/api/tax/payments?year=2026')).body;
    expect(list).toHaveLength(3);
    // batalkan setoran Februari tidak boleh selama masa Maret sudah dikompensasi
    await http.delete(`/api/tax/payments/${comp.body.id}`).set(auth()).expect(400);
  });

  it('Coretax: ekspor XML faktur keluaran', async () => {
    await http.patch('/api/settings/company').set(auth()).send({ npwp: '01.234.567.8-901.000' }).expect(200);
    const pre = (await get('/api/integrations/coretax/preview?from=2026-03-01&to=2026-03-31')).body;
    expect(pre.count).toBe(1);
    expect(pre.missingUnits).toEqual(['PCS']);
    await put('/api/integrations/settings', { coretaxUnits: { PCS: 'UM.0021' } }).expect(200);
    const xml = await get('/api/integrations/coretax/faktur-keluaran.xml?from=2026-03-01&to=2026-03-31').expect(200);
    const body = xml.text;
    expect(body).toContain('<TaxInvoiceBulk');
    expect(body).toContain('<TIN>0012345678901000</TIN>');
    expect(body).toContain('<TrxCode>04</TrxCode>');
    expect(body).toContain('<BuyerTin>0012345678901234</BuyerTin>');
    expect(body).toContain('<TaxBase>180000000.00</TaxBase>');
    expect(body).toContain('<OtherTaxBase>165000000.00</OtherTaxBase>');
    expect(body).toContain('<VAT>19800000.00</VAT>');
    expect(body).toContain('<Unit>UM.0021</Unit>');
  });

  it('rekonsiliasi bank: impor mutasi, cocok otomatis, biaya admin dibuatkan jurnal', async () => {
    const bank = acc('1-1200');
    const imp = await post('/api/bank/statements', {
      cashAccountId: bank,
      fileName: 'mutasi-feb.csv',
      lines: [
        { date: '2026-02-20', description: 'TRSF KE CV JASA TEKNIK JT-001', amount: '-168680000' },
        { date: '2026-02-21', description: 'SHOPEE PAYOUT', amount: '160000' },
        { date: '2026-02-28', description: 'BIAYA ADM', amount: '-15000' },
        { date: '2026-02-28', description: 'BUNGA JASA GIRO', amount: '42000' },
        { date: '2026-03-10', description: 'PAJAK PPH23 NTPN0001', amount: '-40000' },
      ],
    }).expect(201);
    expect(imp.body.summary.counts.MATCHED).toBe(3);
    const adm = imp.body.lines.find((l: { description: string }) => l.description === 'BIAYA ADM');
    const bunga = imp.body.lines.find((l: { description: string }) => l.description === 'BUNGA JASA GIRO');
    await post(`/api/bank/lines/${adm.id}/create`, { accountId: acc('8-1100') }).expect(201);
    await post(`/api/bank/lines/${bunga.id}/create`, { accountId: acc('4-9100'), description: 'Bunga jasa giro Februari' }).expect(201);
    await post(`/api/bank/lines/${adm.id}/create`, { accountId: acc('8-1100') }).expect(400);
    // impor ganda ditolak
    await post('/api/bank/statements', { cashAccountId: bank, lines: imp.body.lines.map((l: { date: string; description: string; amount: string }) => ({ date: l.date, description: l.description, amount: l.amount })) }).expect(400);
    const rec = (await get(`/api/bank/reconciliation?cashAccountId=${bank}&asOf=2026-03-10`)).body;
    expect(rec.unrecorded).toHaveLength(0);
    // saldo buku 10 Maret: 500 jt − 168,68 jt + 160 rb − 15 rb + 42 rb − 40 rb (PPN 25 Apr belum) = 331.467.000
    expect(Number(rec.bookBalance)).toBe(331467000);
    const cand = (await get(`/api/bank/lines/${imp.body.lines[0].id}/candidates`)).body;
    expect(Array.isArray(cand)).toBe(true);
  });
  it('jurnal penyesuaian: masuk kolom penyesuaian neraca lajur, ringkasan & daftar periksa', async () => {
    const j = await post('/api/accounting/journals', {
      date: '2026-03-31',
      description: 'Akrual listrik Maret',
      adjustment: true,
      lines: [
        { accountId: acc('6-4000'), debit: '750000', credit: '0' },
        { accountId: acc('2-1600'), debit: '0', credit: '750000' },
      ],
    }).expect(201);
    expect(j.body.sourceType).toBe('ADJUSTMENT');
    const list = (await get('/api/accounting/journals?source=ADJUSTMENT,DEPRECIATION&from=2026-03-01&to=2026-03-31')).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(j.body.id);
    const ws = (await get('/api/accounting/statements/worksheet?from=2026-01-01&to=2026-03-31')).body;
    const row = ws.rows.find((r: { code: string }) => r.code === '2-1600');
    expect(Number(row.adjustment.credit)).toBeGreaterThanOrEqual(750000);
    const sum = (await get('/api/accounting/adjustments/summary?from=2026-03-01&to=2026-03-31')).body;
    expect(Number(sum.find((x: { sourceType: string }) => x.sourceType === 'ADJUSTMENT').total)).toBe(750000);
    const ck = (await get('/api/accounting/adjustments/checklist?period=2026-03')).body;
    expect(ck.date).toBe('2026-03-31');
    expect(ck.items.find((x: { key: string }) => x.key === 'manual').amount).toBe('750000.00');
    await post(`/api/accounting/journals/${j.body.id}/reverse`).expect(201);
  });
});
