/**
 * Jurnal penyesuaian & pembaliknya di neraca lajur: pembalikan jurnal penyesuaian tetap di kolom penyesuaian,
 * sehingga kolom "sebelum penyesuaian" tidak terdistorsi dan penyesuaian bersih = 0.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jurnal penyesuaian dan pembaliknya (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let expenseId: string;
  let accruedId: string;
  const day = todayJakarta();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(auth());
  const post = (u: string, b: object = {}) => http.post(u).set(auth()).send(b);
  type Row = { id: string; trial: { debit: string; credit: string }; adjustment: { debit: string; credit: string }; adjusted: { debit: string; credit: string } };
  const sheet = async () => (await get(`/api/accounting/statements/worksheet?from=${day.slice(0, 4)}-01-01&to=${day}`).expect(200)).body as { rows: Row[]; balanced: boolean };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Penyesuaian', name: 'Pemilik', email: `adj-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string; type: string; isPostable: boolean }[];
    expenseId = accs.find((a) => a.type === 'EXPENSE' && a.isPostable)!.id;
    accruedId = accs.find((a) => a.type === 'LIABILITY' && a.isPostable && a.code !== '2-1100')!.id; // bukan Utang Usaha (akun kontrol)
  });
  afterAll(() => app.close());

  it('jurnal penyesuaian masuk kolom penyesuaian; pembaliknya juga, bukan kolom sebelum penyesuaian', async () => {
    const adj = (await post('/api/accounting/journals', { date: day, description: 'Beban masih harus dibayar', adjustment: true, lines: [{ accountId: expenseId, debit: '500000' }, { accountId: accruedId, credit: '500000' }] }).expect(201)).body as { id: string };
    let w = await sheet();
    let r = w.rows.find((x) => x.id === expenseId)!;
    expect(r.adjustment.debit).toBe('500000.00');
    expect(r.trial).toEqual({ debit: '0.00', credit: '0.00' });

    await post(`/api/accounting/journals/${adj.id}/reverse`).expect(201);
    w = await sheet();
    r = w.rows.find((x) => x.id === expenseId) ?? ({ trial: { debit: '0.00', credit: '0.00' }, adjustment: { debit: '0.00', credit: '0.00' }, adjusted: { debit: '0.00', credit: '0.00' } } as Row);
    // kolom sebelum penyesuaian tetap bersih; penyesuaian bersih nol; hasil akhir nol
    expect(r.trial).toEqual({ debit: '0.00', credit: '0.00' });
    expect(Number(r.adjustment.debit) - Number(r.adjustment.credit)).toBe(0);
    expect(r.adjusted).toEqual({ debit: '0.00', credit: '0.00' });
    expect(w.balanced).toBe(true);
  });

  it('jurnal manual biasa dan pembaliknya tetap di kolom sebelum penyesuaian', async () => {
    const m = (await post('/api/accounting/journals', { date: day, description: 'Biaya biasa', lines: [{ accountId: expenseId, debit: '200000' }, { accountId: accruedId, credit: '200000' }] }).expect(201)).body as { id: string };
    let r = (await sheet()).rows.find((x) => x.id === expenseId)!;
    expect(r.trial.debit).toBe('200000.00');
    expect(Number(r.adjustment.debit) - Number(r.adjustment.credit)).toBe(0); // hanya sisa penyesuaian (500rb + pembaliknya) yang tetap bersih
    await post(`/api/accounting/journals/${m.id}/reverse`).expect(201);
    const w = await sheet();
    r = w.rows.find((x) => x.id === expenseId) ?? ({ trial: { debit: '0.00', credit: '0.00' }, adjustment: { debit: '0.00', credit: '0.00' } } as Row);
    expect(r.trial).toEqual({ debit: '0.00', credit: '0.00' });
    expect(Number(r.adjustment.debit) - Number(r.adjustment.credit)).toBe(0);
    expect(w.balanced).toBe(true);
  });
});
