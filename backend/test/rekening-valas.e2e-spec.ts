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
});
