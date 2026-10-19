/**
 * Laporan pendukung Jasa & proyek dan Utilitas (e2e): rincian dan pencocokan dengan buku besar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung jasa & utilitas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const reg = async (name: string, businessModel: string) => (await http.post('/api/auth/register').send({ companyName: name, name: 'Pemilik', email: `lj-${businessModel}-${stamp}@uji.id`, password: 'rahasia123', businessModel }).expect(201)).body.accessToken as string;
  const report = async (t: string, kind: string) => (await get(t, `/api/accounting/support/${kind}?from=${from}&to=${day}`).expect(200)).body as Rep;
  const rec = (r: Rep, key: string) => r.reconciliation.find((x) => x.key === key)!;
  const allOk = (r: Rep) => { for (const x of r.reconciliation) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 }); };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('jasa: proyek, termin, kemajuan, dan uang muka cocok dengan buku besar', async () => {
    const t = await reg('PT Jasa Laporan', 'JASA');
    const cust = (await post(t, '/api/customers', { code: 'PT-MAJU', name: 'PT Maju', npwp: '0987654321098765', paymentTermDays: 30 }).expect(201)).body.id;
    const prj = (await post(t, '/api/services/projects', { name: 'Renovasi', customerId: cust, contractValue: '100000000', startDate: from }).expect(201)).body.id;
    await post(t, '/api/services/deposits', { customerId: cust, projectId: prj, date: day, amount: '33300000' }).expect(201); // DPP 30 jt
    await post(t, '/api/services/invoices', { customerId: cust, projectId: prj, date: day, termLabel: 'Termin 1', lines: [{ description: 'Struktur 40%', price: '40000000' }] }).expect(201);
    await post(t, `/api/services/projects/${prj}/progress`, { date: day, percent: '55' }).expect(201);
    const r = await report(t, 'jasa');
    expect(r.reconciliation.map((x) => x.key)).toEqual(['jasa-revenue', 'jasa-contract', 'jasa-deposit']);
    allOk(r);
    expect(rec(r, 'jasa-contract').left.value).toBe(15_000_000); // 55 jt diakui − 40 jt ditagih
    expect(rec(r, 'jasa-deposit').left.value).toBe(30_000_000);
    const p = r.sections.find((s) => s.key === 'jasa-project')!.tables[0].rows[0];
    expect(p.slice(3, 9)).toEqual([100_000_000, 55, 55_000_000, 40_000_000, 60_000_000, 15_000_000]);
    expect(r.sections.find((s) => s.key === 'jasa-invoice')!.tables[0].rows).toHaveLength(1);
  });

  it('utilitas: meter, tagihan, dan pendapatan cocok; tunggakan tampil', async () => {
    const t = await reg('PAM Laporan', 'UTILITAS');
    const cust = (await post(t, '/api/customers', { code: 'PLG1', name: 'Budi', paymentTermDays: 20 }).expect(201)).body.id;
    const tariff = (await post(t, '/api/utility/tariffs', { name: 'Air', serviceType: 'AIR', fixedFee: 12000, adminFee: 2500, minUsage: 0, blocks: [{ upTo: 10, price: 3000 }, { upTo: null, price: 7000 }] }).expect(201)).body.id;
    await post(t, '/api/users', { name: 'Fin', email: `lj-fin-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    await post(t, '/api/users', { name: 'Lap', email: `lj-lap-${stamp}@uji.id`, password: 'rahasia12345', role: 'WAREHOUSE' }).expect(201);
    const login = async (n: string) => (await http.post('/api/auth/login').send({ email: `lj-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    const fin = await login('fin');
    const lap = await login('lap');
    const longAgo = `${new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 3, 1)).toISOString().slice(0, 7)}-05`;
    const conn = (await post(fin, '/api/utility/connections', { customerId: cust, tariffId: tariff, address: 'Blok A-01', meterNo: 'MA-1', installedAt: longAgo, initialReading: '0' }).expect(201)).body.id;
    const period = day.slice(0, 7);
    const rd = (await post(lap, '/api/utility/readings', { connectionId: conn, period, current: '10' }).expect(201)).body;
    await post(fin, `/api/utility/readings/${rd.id}/verify`, {}).expect(201);
    await post(fin, '/api/utility/billing/run', { period }).expect(201);
    const r = await report(t, 'utility');
    expect(r.reconciliation.map((x) => x.key)).toEqual(['util-revenue', 'util-usage', 'util-late']);
    allOk(r);
    expect(rec(r, 'util-revenue').left.value).toBe(44_500); // 10×3.000 + 12.000 + 2.500
    expect(rec(r, 'util-usage').left.value).toBe(10);
    const bills = r.sections.find((s) => s.key === 'util-bills')!.tables[0];
    expect(bills.rows[0].slice(0, 4)).toEqual([period, 1, 10, 44_500]);
    expect(r.sections.find((s) => s.key === 'util-readings')!.tables[0].rows[0].slice(0, 4)).toEqual([period, 1, 0, 1]);
    expect(r.sections.find((s) => s.key === 'util-connections')!.tables[0].rows[0]).toEqual(['Air', 1, 0, 0]);
  });
});
