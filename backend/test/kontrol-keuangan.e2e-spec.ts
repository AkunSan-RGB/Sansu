/**
 * Kontrol keuangan (e2e): pengaman "belum aktif" + rekomendasi, temuan jurnal manual (besar, akun kontrol, akhir pekan, dibalik cepat).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol keuangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cash: string; let equity: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const put = (u: string, b: object = {}) => http.put(u).set(as()).send(b);
  const keys = async () => ((await get('/api/cash/controls').expect(200)).body.items as { key: string }[]).map((i) => i.key);
  const saturday = () => { let d = todayJakarta(); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, -1); return d; };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Uang', name: 'P', email: `kk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    cash = accs.find((a) => a.code === '1-1100')!.id;
    equity = accs.find((a) => a.code === '3-1000')!.id;
  });
  afterAll(async () => { await app.close(); });

  it('pengaman belum aktif lalu aktif setelah rekomendasi diterapkan', async () => {
    const r = (await get('/api/cash/controls').expect(200)).body;
    expect(r.setup.active).toBe(false);
    await put('/api/approvals/policy', r.setup.recommended).expect(200);
    expect((await get('/api/cash/controls').expect(200)).body.setup.active).toBe(true);
    await put('/api/approvals/policy', { cashOut: 0, manualJournal: 0 }).expect(200);
  });

  it('jurnal manual ke kas, bernilai besar, di akhir pekan, lalu dibalik cepat terdeteksi', async () => {
    const j = (await post('/api/accounting/journals', { date: saturday(), description: 'Setoran modal uji', controlOverrideReason: 'Uji kontrol keuangan', lines: [{ accountId: cash, debit: '15000000' }, { accountId: equity, credit: '15000000' }] }).expect(201)).body;
    const k = await keys();
    expect(k).toEqual(expect.arrayContaining(['JE_LARGE', 'JE_CONTROL_ACCOUNT', 'JE_WEEKEND']));
    expect(k).not.toContain('JE_REVERSED_FAST');
    await post(`/api/accounting/journals/${j.id}/reverse`, {}).expect(201);
    expect(await keys()).toContain('JE_REVERSED_FAST');
  });
});
