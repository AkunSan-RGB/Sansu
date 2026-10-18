/**
 * Kontrol keuangan: catatan vs rekening koran — uang keluar di bank tak tercatat, uang keluar tercatat tapi tak ada di bank,
 * selisih saldo akhir rekening koran vs buku.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../src/db/db';

describe('Kontrol keuangan: kas vs bank (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let bankId: string; let expenseId: string; let equityId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const day = (n: number) => addDays(todayJakarta(), -n);
  const items = async () => (await get('/api/cash/controls').expect(200)).body.items as { key: string; refs: string[] }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kas Bank', name: 'P', email: `kb-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    bankId = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1200')!.id;
    const counters = (await get('/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: bankId, date: day(30), description: 'Setoran modal', reference: 'M-1', lines: [{ accountId: equityId, amount: '10000000' }] }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('mutasi keluar di bank tanpa catatan, catatan keluar tanpa mutasi, dan selisih saldo terdeteksi', async () => {
    // Dicatat 500rb keluar (tidak ada di bank); bank mencatat 2 juta keluar yang tak tercatat; setoran modal cocok
    await post('/api/cash/transactions', { type: 'OUT', cashAccountId: bankId, date: day(16), description: 'Bayar pemasok fiktif', reference: 'KW-1', lines: [{ accountId: expenseId, amount: '500000' }] }).expect(201);
    await post('/api/bank/statements', {
      cashAccountId: bankId,
      lines: [
        { date: day(30), description: 'SETOR MODAL', amount: '10000000', balance: '10000000' },
        { date: day(15), description: 'TRSF KELUAR MISTERIUS', amount: '-2000000', balance: '8000000' },
      ],
    }).expect(201);
    const k = await items();
    expect(k.find((f) => f.key === 'BANK_OUT_UNRECORDED')?.refs.join()).toContain('TRSF KELUAR MISTERIUS');
    expect(k.find((f) => f.key === 'BANK_OUT_NOT_IN_STATEMENT')?.refs.join()).toContain('500.000');
    const bd = k.find((f) => f.key === 'BANK_BALANCE_DIFF');
    expect(bd?.refs.join()).toContain('selisih');
  });

  it('penggajian: karyawan tanpa rekening dan gaji setelah berhenti terdeteksi', async () => {
    const d = todayJakarta();
    const period = d.slice(0, 7);
    await post('/api/apps/hr/install').expect(201);
    await post('/api/apps/payroll/install').expect(201);
    const e = (await post('/api/hr/employees', { code: 'E-9', name: 'Pegawai Sembilan', ptkp: 'TK/0', joinDate: `${d.slice(0, 4)}-01-02`, baseSalary: '5000000' }).expect(201)).body;
    await post('/api/payroll/runs', { period }).expect(201);
    expect((await items()).find((f) => f.key === 'PAYROLL_NO_BANK')?.refs.join()).toContain('Pegawai Sembilan');
    expect((await items()).some((f) => f.key === 'PAYROLL_AFTER_RESIGN')).toBe(false);
    await app.get<Db>(DB).execute(sql`UPDATE employees SET resign_date = ${`${period}-01`}::date - 5 WHERE id = ${e.id}`);
    expect((await items()).find((f) => f.key === 'PAYROLL_AFTER_RESIGN')?.refs.join()).toContain('Pegawai Sembilan');
  });
});
