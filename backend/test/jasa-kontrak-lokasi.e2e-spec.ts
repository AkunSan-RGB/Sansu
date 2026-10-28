/**
 * Jasa kontrak per lokasi (kebersihan/keamanan): pos dengan jumlah petugas, jadwal jaga, tagihan bulanan, potongan kekurangan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Jasa kontrak per lokasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let sales = '';
  let cust = ''; let contract = ''; let postPagi = ''; let postMalam = '';
  let e1 = ''; let e2 = ''; let e3 = '';
  const stamp = Date.now();
  const today = todayJakarta();
  const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7); // bulan lalu
  const prevFirst = `${prev}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const daysInPrev = Number(addDays(`${today.slice(0, 7)}-01`, -1).slice(8));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Sentosa Alih Daya', name: 'Pemilik', email: `sl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/hr/install').expect(201);
    await post(owner, '/api/users', { name: 'Sales', email: `sl-s-${stamp}@uji.id`, password: 'rahasia12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `sl-s-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    cust = (await post(owner, '/api/customers', { code: 'GD1', name: 'Menara Satu', paymentTermDays: 14 }).expect(201)).body.id;
    const emp = async (code: string, name: string) => (await post(owner, '/api/hr/employees', { code, name, ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '3500000' }).expect(201)).body.id as string;
    e1 = await emp('S1', 'Satpam Agus'); e2 = await emp('S2', 'Satpam Budi'); e3 = await emp('S3', 'Satpam Candra');
  });
  afterAll(() => app.close());

  it('kontrak butuh pos bertarif; peran SALES tidak boleh membuat/melihat', async () => {
    const base = { customerId: cust, siteName: 'Menara Satu', title: 'Jasa pengamanan', startDate: addDays(prevFirst, -10) };
    expect((await post(owner, '/api/services/sites', { ...base, posts: [] })).status).toBe(400);
    expect((await post(owner, '/api/services/sites', { ...base, posts: [{ name: 'Pagi', headcount: 2, monthlyRate: '0' }] })).status).toBe(400);
    expect((await post(sales, '/api/services/sites', { ...base, posts: [{ name: 'Pagi', headcount: 2, monthlyRate: '4000000' }] })).status).toBe(403);
    contract = (await post(owner, '/api/services/sites', { ...base, posts: [{ name: 'Satpam pagi', headcount: 2, monthlyRate: '4000000' }, { name: 'Satpam malam', headcount: 1, monthlyRate: '4500000' }] }).expect(201)).body.id;
    const list = (await get(owner, '/api/services/sites').expect(200)).body;
    expect(list[0].monthlyTotal).toBe('12500000.00');
    postPagi = list[0].posts.find((p: { name: string }) => p.name === 'Satpam pagi').id;
    postMalam = list[0].posts.find((p: { name: string }) => p.name === 'Satpam malam').id;
    expect(list[0].unbilledPeriods).toEqual(expect.arrayContaining([prev]));
  });

  it('jadwal jaga: satu petugas satu pos per hari, di dalam masa kontrak', async () => {
    const d1 = prevFirst; const d2 = addDays(prevFirst, 9);
    await post(owner, `/api/services/sites/${contract}/roster`, { postId: postPagi, employeeId: e1, from: d1, to: d2 }).expect(201);
    const clash = await post(owner, `/api/services/sites/${contract}/roster`, { postId: postMalam, employeeId: e1, from: addDays(d1, 5), to: addDays(d2, 3) });
    expect(clash.status).toBe(409);
    expect((await post(owner, `/api/services/sites/${contract}/roster`, { postId: postPagi, employeeId: e2, from: addDays(prevFirst, -60), to: addDays(prevFirst, -20) })).status).toBe(400);
    expect((await post(owner, `/api/services/sites/${contract}/roster`, { postId: postPagi, employeeId: e2, from: d1, to: addDays(d1, 100) })).status).toBe(400);
  });

  it('cakupan: kekurangan hari-orang dihitung per pos', async () => {
    const last = addDays(`${today.slice(0, 7)}-01`, -1);
    // pagi wajib 2 orang: e1 hadir hari 1–10, e2 hari 1–5; malam wajib 1 orang: e3 hari 1–daysInPrev
    await post(owner, `/api/services/sites/${contract}/roster`, { postId: postPagi, employeeId: e2, from: prevFirst, to: addDays(prevFirst, 4) }).expect(201);
    await post(owner, `/api/services/sites/${contract}/roster`, { postId: postMalam, employeeId: e3, from: prevFirst, to: addDays(prevFirst, 29 > daysInPrev - 1 ? daysInPrev - 1 : 29) }).expect(201);
    const cov = (await get(owner, `/api/services/sites/${contract}/coverage?from=${prevFirst}&to=${last}`).expect(200)).body;
    const pagi = cov.posts.find((p: { name: string }) => p.name === 'Satpam pagi');
    // hari 1–5: 0 kurang; hari 6–10: 1 kurang (5); hari 11–akhir: 2 kurang
    expect(pagi.shortfallHeadDays).toBe(5 + 2 * (daysInPrev - 10));
    expect(cov.posts.find((p: { name: string }) => p.name === 'Satpam malam').shortfallHeadDays).toBe(0);
  });

  it('tagihan bulanan: tarif penuh per pos; tidak bisa dua kali; periode depan ditolak', async () => {
    const r = (await post(owner, `/api/services/sites/${contract}/bill`, { period: prev, date: today }).expect(201)).body;
    const inv = (await get(owner, `/api/invoices/${r.id}`).expect(200)).body;
    expect(Number(inv.subtotal)).toBe(12_500_000);
    expect((await post(owner, `/api/services/sites/${contract}/bill`, { period: prev })).status).toBe(400);
    expect((await post(owner, `/api/services/sites/${contract}/bill`, { period: `${Number(today.slice(0, 4)) + 1}-01` })).status).toBe(400);
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  });

  it('potongan kekurangan: jumlah petugas ditagih berkurang proporsional dan dicatat', async () => {
    const c2 = (await post(owner, '/api/services/sites', { customerId: cust, siteName: 'Pabrik Dua', title: 'Jasa kebersihan', startDate: addDays(prevFirst, -5), posts: [{ name: 'Cleaning', headcount: 3, monthlyRate: '3000000' }] }).expect(201)).body.id;
    const post2 = (await get(owner, '/api/services/sites').expect(200)).body.find((c: { id: string }) => c.id === c2).posts[0].id;
    const e4 = (await post(owner, '/api/hr/employees', { code: 'S4', name: 'Cleaning Dedi', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '3000000' }).expect(201)).body.id as string;
    // satu petugas hadir 10 hari dari kebutuhan 3 petugas sebulan penuh: kekurangan = 3 × hari − 10 hari-orang
    await post(owner, `/api/services/sites/${c2}/roster`, { postId: post2, employeeId: e4, from: prevFirst, to: addDays(prevFirst, 9) }).expect(201);
    const r = (await post(owner, `/api/services/sites/${c2}/bill`, { period: prev, date: today, deductShortfall: true }).expect(201)).body;
    const inv = (await get(owner, `/api/invoices/${r.id}`).expect(200)).body;
    // petugas ditagih = 3 − (3·hari − 10)/hari = 10/hari
    expect(Math.abs(Number(inv.subtotal) - (10 / daysInPrev) * 3_000_000)).toBeLessThan(1000);
    const list = (await get(owner, '/api/services/sites').expect(200)).body.find((c: { id: string }) => c.id === c2);
    expect(Number(list.billedPeriods[0].shortfall)).toBe(3 * daysInPrev - 10);
  });

  it('hapus jadwal dan nonaktifkan kontrak dengan alasan', async () => {
    const cov = (await get(owner, `/api/services/sites/${contract}/coverage?from=${prevFirst}&to=${prevFirst}`).expect(200)).body;
    const dutyId = cov.posts[0].duty[0].id as string;
    await http.delete(`/api/services/sites/${contract}/roster/${dutyId}`).set(as(owner)).expect(200);
    expect((await http.delete(`/api/services/sites/${contract}/roster/${dutyId}`).set(as(owner))).status).toBe(404);
    expect((await http.put(`/api/services/sites/${contract}`).set(as(owner)).send({ isActive: false, reason: 'x' })).status).toBe(400);
    await http.put(`/api/services/sites/${contract}`).set(as(owner)).send({ isActive: false, reason: 'Kontrak diakhiri pelanggan' }).expect(200);
    expect((await post(owner, `/api/services/sites/${contract}/bill`, { period: today.slice(0, 7) })).status).toBe(400);
  });
});
