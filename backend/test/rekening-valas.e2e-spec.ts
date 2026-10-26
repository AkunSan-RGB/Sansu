/** Rekening kas/bank valas: beli/jual valas, biaya rata-rata, pelunasan faktur, penolakan alur yang belum mengenal valas */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Rekening valas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  let usd: string;
  let usd2: string;
  let idr: string;
  const day = todayJakarta();
  const as = () => ({ Authorization: `Bearer ${t}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const acct = async (id: string) => ((await get('/api/cash/accounts').expect(200)).body as { id: string; balance: string; balanceForeign: string | null }[]).find((a) => a.id === id)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    t = (await http.post('/api/auth/register').send({ companyName: 'PT Rekening Valas', name: 'P', email: `rv-${Date.now()}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await http.put('/api/fx/rates').set(as()).send({ currency: 'USD', rate: '16000' }).expect(200);
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string; type: string }[];
    idr = accs.find((a) => a.code === '1-1200')!.id;
    const equity = accs.find((a) => a.type === 'EQUITY' && a.code.startsWith('3-1'))!.id;
    await post('/api/accounting/journals', { date: day, description: 'Modal awal', lines: [{ accountId: idr, debit: '50000000' }, { accountId: equity, credit: '50000000' }] }).expect(201);
    usd = (await post('/api/accounting/accounts', { code: '1-1210', name: 'Bank USD', type: 'ASSET', isCashAccount: true, currency: 'USD' }).expect(201)).body.id;
    usd2 = (await post('/api/accounting/accounts', { code: '1-1211', name: 'Bank USD 2', type: 'ASSET', isCashAccount: true, currency: 'USD' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('mata uang asing hanya untuk akun kas/bank dan harus dikenal', async () => {
    await post('/api/accounting/accounts', { code: '5-9999', name: 'Beban USD', type: 'EXPENSE', currency: 'USD' }).expect(400);
    await post('/api/accounting/accounts', { code: '1-1299', name: 'Bank XXX', type: 'ASSET', isCashAccount: true, currency: 'XXX' }).expect(400);
  });

  it('beli valas: saldo valas dan nilai Rupiah tercatat', async () => {
    await post('/api/cash/foreign', { kind: 'BUY', cashAccountId: idr, toCashAccountId: usd, amountForeign: '1000', amountIdr: '16000000', description: 'Beli USD' }).expect(201);
    const a = await acct(usd);
    expect(a.balanceForeign).toBe('1000.00');
    expect(a.balance).toBe('16000000.00');
  });

  it('jual sebagian: biaya rata-rata, selisih kurs terealisasi masuk laba', async () => {
    await post('/api/cash/foreign', { kind: 'SELL', cashAccountId: usd, toCashAccountId: idr, amountForeign: '400', amountIdr: '6600000', description: 'Jual USD' }).expect(201);
    const a = await acct(usd);
    expect(a.balanceForeign).toBe('600.00');
    expect(a.balance).toBe('9600000.00'); // 600 × 16.000
  });

  it('pengeluaran melebihi saldo valas ditolak', async () => {
    await post('/api/cash/foreign', { kind: 'SELL', cashAccountId: usd, toCashAccountId: idr, amountForeign: '700', amountIdr: '11000000', description: 'Kebanyakan' }).expect(400);
  });

  it('pindah antar rekening valas membawa nilai tercatat', async () => {
    await post('/api/cash/foreign', { kind: 'MOVE', cashAccountId: usd, toCashAccountId: usd2, amountForeign: '600', description: 'Pindah' }).expect(201);
    expect((await acct(usd)).balance).toBe('0.00');
    const b = await acct(usd2);
    expect(b.balanceForeign).toBe('600.00');
    expect(b.balance).toBe('9600000.00');
  });

  it('jurnal manual atau kas Rupiah ke rekening valas tanpa jumlah valas ditolak', async () => {
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const rev = accs.find((a) => a.code === '4-1000')!.id;
    await post('/api/accounting/journals', { date: day, description: 'Salah', lines: [{ accountId: usd2, debit: '1000' }, { accountId: rev, credit: '1000' }] }).expect(400);
    await post('/api/cash/transactions', { type: 'TRANSFER', cashAccountId: idr, toCashAccountId: usd2, amount: '1000', description: 'Salah' }).expect(400);
  });

  it('pelunasan faktur USD ke rekening USD dan pembayaran pemasok dari rekening USD', async () => {
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const cust = (await post('/api/customers', { code: 'BUY', name: 'Buyer SG' }).expect(201)).body.id;
    const supp = (await post('/api/suppliers', { code: 'SUP', name: 'Supplier SZ' }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'BRG', name: 'Barang', sellPrice: '1000' }).expect(201)).body.id;
    const po0 = (await post('/api/purchase-orders/quick', { supplierId: supp, warehouseId: wh, receiveNow: true, lines: [{ productId: prod, qty: '500', price: '50000' }] }).expect(201)).body;
    await post('/api/purchase-invoices', { purchaseOrderId: po0.id, supplierInvoiceNo: 'IDR-1' }).expect(201);
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, currency: 'USD', lines: [{ productId: prod, qty: '100', price: '10' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    await post('/api/payments', { invoiceId: inv.id, amount: '300', fxRate: '16200', cashAccountId: idr }).expect(201);
    await post('/api/payments', { invoiceId: inv.id, amount: '700', fxRate: '16200', cashAccountId: usd }).expect(201);
    const a = await acct(usd);
    expect(a.balanceForeign).toBe('700.00');
    expect(a.balance).toBe('11340000.00'); // 700 × 16.200
    // pemasok USD dibayar dari rekening USD: Rupiah keluar = biaya rata-rata (16.200), bukan kurs hari bayar
    const po = (await post('/api/purchase-orders', { supplierId: supp, warehouseId: wh, currency: 'USD', fxRate: '16000', lines: [{ productId: prod, qty: '100', price: '5' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    const pinv = (await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'SZ-1' }).expect(201)).body;
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: pinv.id, amount: '200', cashAccountId: usd }).expect(201);
    const b = await acct(usd);
    expect(b.balanceForeign).toBe('500.00');
    expect(b.balance).toBe('8100000.00'); // 500 × 16.200
  });

  it('rekening koran valas dicocokkan dengan jumlah valas dan rekonsiliasi selisih nol', async () => {
    const st = (await post('/api/bank/statements', {
      cashAccountId: usd, openingBalance: '0', closingBalance: '500',
      lines: [
        { date: day, description: 'Beli USD', amount: '1000' },
        { date: day, description: 'Jual USD', amount: '-400' },
        { date: day, description: 'Pelunasan buyer', amount: '700' },
        { date: day, description: 'Bayar supplier', amount: '-200' },
        { date: day, description: 'Pindah rekening', amount: '-600' },
      ],
    }).expect(201)).body;
    const lines = (await get(`/api/bank/statements/${st.id}`).expect(200)).body.lines as { status: string }[];
    expect(lines.filter((l) => l.status === 'MATCHED')).toHaveLength(5); // dicocokkan otomatis saat impor, berdasarkan jumlah valas
    const rec = (await get(`/api/bank/reconciliation?cashAccountId=${usd}&asOf=${day}`).expect(200)).body;
    expect(Number(rec.bookBalance ?? rec.book ?? 0)).toBe(500);
    expect(Number(rec.difference ?? 0)).toBe(0);
  });

  it('penilaian ulang menyertakan saldo bank valas', async () => {
    await http.put('/api/fx/rates').set(as()).send({ currency: 'USD', rate: '16500' }).expect(200);
    const exp = (await get('/api/fx/exposure').expect(200)).body;
    const row = exp.rows.find((r: { kind: string; number: string }) => r.kind === 'BANK' && r.number === '1-1210');
    expect(row.valueAtRate).toBe('8250000.00'); // 500 × 16.500
    expect(row.unrealized).toBe('150000.00'); // 8.250.000 − 8.100.000
    const r = (await post('/api/fx/revaluation', {}).expect(201)).body;
    expect(Number(r.bank)).toBe(450000); // + Bank USD 2: 600 × 16.500 − 9.600.000 = 300.000
  });
});
