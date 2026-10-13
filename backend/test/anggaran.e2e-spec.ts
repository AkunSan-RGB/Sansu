/**
 * Anggaran vs realisasi (e2e): penyusunan, persetujuan oleh orang lain, kunci setelah disetujui, laporan selisih,
 * peringatan otomatis (sekali per akun per bulan), pengisian dari realisasi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailService } from '../src/common/mail/mail.service';
import { todayJakarta } from '../src/common/utils/dates';
import { BudgetService } from '../src/modules/accounting/budget';

describe('Anggaran vs realisasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let cashId: string;
  let expA: string;
  let expB: string;
  let revId: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const months = (v: string) => Array.from({ length: 12 }, (_, i) => (i + 1 === month ? v : '0'));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Anggaran', name: 'Pemilik', email: `ang-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `ang-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `ang-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    cashId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string }[])[0].id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    const exp = counters.filter((a) => a.type === 'EXPENSE');
    expA = exp[0].id;
    expB = exp[1].id;
    revId = counters.find((a) => a.type === 'REVENUE')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: today, description: 'Modal', reference: 'M-1', lines: [{ accountId: counters.find((a) => a.code === '3-1000')!.id, amount: '50000000' }] }).expect(201);
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: today, description: 'Biaya A', reference: 'A-1', lines: [{ accountId: expA, amount: '2500000' }] }).expect(201);
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: today, description: 'Biaya B tanpa anggaran', reference: 'B-1', lines: [{ accountId: expB, amount: '700000' }] }).expect(201);
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: today, description: 'Pendapatan lain', reference: 'R-1', lines: [{ accountId: revId, amount: '4000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('susun → hanya orang lain/pemilik yang menyetujui → terkunci → dibuka dengan alasan', async () => {
    await put(finance, `/api/budgets/${year}`, { rows: [{ accountId: expA, months: months('1000000') }, { accountId: revId, months: months('6000000') }] }).expect(200);
    await post(finance, `/api/budgets/${year}/approve`).expect(403); // role keuangan tidak boleh menyetujui
    await post(owner, `/api/budgets/${year}/approve`).expect(201);
    await put(finance, `/api/budgets/${year}`, { rows: [] }).expect(400); // terkunci
    await post(owner, `/api/budgets/${year}/reopen`, { reason: 'x' }).expect(400);
    await post(owner, `/api/budgets/${year}/reopen`, { reason: 'Revisi triwulan' }).expect(201);
    await post(owner, `/api/budgets/${year}/approve`).expect(201);
    await put(finance, `/api/budgets/${year}`, { rows: [{ accountId: cashId, months: months('1') }] }).expect(400);
  });

  it('laporan: selisih, status OVER / UNBUDGETED / SHORT, total laba', async () => {
    const r = (await get(finance, `/api/budgets/${year}/report`).expect(200)).body;
    const row = (id: string) => r.rows.find((x: { accountId: string }) => x.accountId === id);
    expect(Number(row(expA).actualYtd)).toBe(2500000);
    expect(Number(row(expA).budgetYtd)).toBe(1000000);
    expect(Number(row(expA).variance)).toBe(-1500000); // beban melebihi anggaran = tidak menguntungkan
    expect(row(expA).status).toBe('OVER');
    expect(row(expB).status).toBe('UNBUDGETED');
    expect(row(revId).status).toBe('SHORT'); // pendapatan 4 jt < 6 jt × 90%
    expect(Number(r.totals.profit.actualYtd)).toBe(4000000 - 2500000 - 700000);
  });

  it('peringatan otomatis terkirim sekali saja per akun per bulan', async () => {
    const mail = app.get(MailService);
    const svc = app.get(BudgetService);
    const before = mail.outbox.length;
    await svc.alertAll();
    const sent = mail.outbox.filter((m) => m.subject.startsWith('Peringatan anggaran')).length;
    expect(sent).toBeGreaterThanOrEqual(1);
    const after = mail.outbox.length;
    await svc.alertAll();
    expect(mail.outbox.length).toBe(after); // tidak diulang
    expect(after).toBeGreaterThan(before);
  });

  it('isi anggaran tahun depan otomatis dari realisasi + kenaikan', async () => {
    const next = year + 1;
    await post(finance, `/api/budgets/${next}/seed`, { fromYear: year, growthPct: 10 }).expect(201);
    const g = (await get(finance, `/api/budgets/${next}`).expect(200)).body;
    const a = g.rows.find((x: { accountId: string }) => x.accountId === expA);
    expect(Number(a.months[month - 1])).toBe(2750000); // 2.500.000 × 1,10
    expect(g.budget.status).toBe('DRAFT');
    await get(finance, `/api/budgets/${next}/report`).expect(200);
  });
});
