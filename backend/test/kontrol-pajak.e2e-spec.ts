/**
 * Kontrol pajak (e2e): setoran tanpa NTPN, jurnal manual ke akun pajak, PPh 21 dipotong belum disetor.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, type Db } from '../src/db/db';

describe('Kontrol pajak (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let tenantId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const items = async () => (await get('/api/cash/controls').expect(200)).body.items as { key: string; refs: string[] }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Pajak', name: 'P', email: `kp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = (await get('/api/auth/me').expect(200)).body.tenantId;
  });
  afterAll(async () => { await app.close(); });

  it('setoran pajak tanpa NTPN ditandai', async () => {
    const db = app.get<Db>(DB);
    await db.execute(sql`INSERT INTO tax_payments (tenant_id, number, type, period, date, amount) VALUES (${tenantId}, 'TP-UJI-1', 'PPN', '2026-01', ${addDays(todayJakarta(), -20)}, 1500000)`);
    const f = (await items()).find((x) => x.key === 'TAX_NO_NTPN');
    expect(f?.refs.join()).toContain('TP-UJI-1');
    await db.execute(sql`UPDATE tax_payments SET ntpn = '1234567890' WHERE number = 'TP-UJI-1'`);
    expect((await items()).some((x) => x.key === 'TAX_NO_NTPN')).toBe(false);
  });

  it('jurnal manual ke akun PPN ditandai', async () => {
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string; systemKey?: string }[];
    const vat = accs.find((a) => a.systemKey === 'VAT_OUT')!;
    const cash = accs.find((a) => a.code === '1-1100')!;
    await post('/api/accounting/journals', { date: todayJakarta(), description: 'Koreksi PPN uji', controlOverrideReason: 'Uji kontrol pajak', lines: [{ accountId: cash.id, debit: '100000' }, { accountId: vat.id, credit: '100000' }] }).expect(201);
    expect((await items()).some((x) => x.key === 'TAX_MANUAL_JOURNAL')).toBe(true);
  });

  it('PPh 21 dipotong dari gaji tetapi belum disetor setelah jatuh tempo ditandai', async () => {
    await post('/api/apps/hr/install').expect(201);
    await post('/api/apps/payroll/install').expect(201);
    const d = todayJakarta();
    const period = addDays(`${d.slice(0, 7)}-01`, -45).slice(0, 7);
    await post('/api/hr/employees', { code: 'E-P1', name: 'Pegawai Pajak', ptkp: 'TK/0', joinDate: `${period.slice(0, 4)}-01-02`, baseSalary: '30000000', bankAccount: '123456' }).expect(201);
    const run = (await post('/api/payroll/runs', { period }).expect(201)).body;
    await post(`/api/payroll/runs/${run.id}/post`).expect(201);
    const f = (await items()).find((x) => x.key === 'PPH21_UNPAID');
    expect(f?.refs.join()).toContain(`Masa ${period}`);
  });
});
