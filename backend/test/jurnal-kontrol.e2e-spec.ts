/**
 * Jurnal manual tidak boleh memakai akun kontrol (piutang, hutang, persediaan, kas/bank, aset tetap):
 * agar buku besar selalu sama dengan rincian per dokumennya. Hanya Pemilik yang bisa mengecualikan, dengan alasan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jurnal manual — akun kontrol (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  const id: Record<string, string> = {};
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const journal = (t: string, accountId: string, extra: object = {}) =>
    http.post('/api/accounting/journals').set(as(t)).send({ date: day, description: 'Uji akun kontrol', lines: [{ accountId, debit: '100000' }, { accountId: id.equity, credit: '100000' }], ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Jurnal Kontrol', name: 'Pemilik', email: `jk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await http.post('/api/users').set(as(owner)).send({ name: 'Keuangan', email: `jk-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `jk-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    const accs = (await get(owner, '/api/accounting/accounts').expect(200)).body as { id: string; code: string; type: string; isPostable: boolean }[];
    const by = (code: string) => accs.find((a) => a.code === code)!.id;
    id.ar = by('1-1300');
    id.ap = by('2-1100');
    id.inventory = by('1-1400');
    id.cash = by('1-1100');
    id.equity = by('3-1000');
    id.expense = accs.find((a) => a.type === 'EXPENSE' && a.isPostable)!.id;
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { assetAccountId: string; accumulatedAccountId: string | null }[];
    id.asset = cats[0].assetAccountId;
    id.accumulated = cats.find((c) => c.accumulatedAccountId)!.accumulatedAccountId!;
  });
  afterAll(() => app.close());

  it('akun biasa tetap boleh', async () => {
    await journal(finance, id.expense).expect(201);
  });

  it('piutang, hutang, persediaan, kas/bank, aset tetap, dan akumulasi penyusutan ditolak', async () => {
    for (const key of ['ar', 'ap', 'inventory', 'cash', 'asset', 'accumulated']) {
      const r = await journal(finance, id[key]);
      expect(`${key} ${r.status}`).toBe(`${key} 400`);
      expect(JSON.stringify(r.body)).toMatch(/akun kontrol/);
    }
  });

  it('pengecualian hanya untuk Pemilik dengan alasan memadai; Keuangan tidak bisa', async () => {
    await journal(finance, id.cash, { controlOverrideReason: 'Koreksi saldo kas karena salah input' }).expect(400);
    await journal(owner, id.cash).expect(400);
    await journal(owner, id.cash, { controlOverrideReason: 'singkat' }).expect(400);
    await journal(owner, id.cash, { controlOverrideReason: 'Koreksi selisih kas hasil rekonsiliasi Oktober' }).expect(201);
  });

  it('jurnal berulang juga tidak boleh memakai akun kontrol', async () => {
    const r = await http.post('/api/accounting/recurring').set(as(owner)).send({
      name: 'Uji', description: 'Uji', frequency: 'MONTHLY', nextDate: day, lines: [{ accountId: id.cash, debit: '1000' }, { accountId: id.equity, credit: '1000' }],
    });
    expect(r.status).toBe(400);
  });
});
