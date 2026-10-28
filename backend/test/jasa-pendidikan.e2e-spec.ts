/**
 * Jasa pendidikan/kursus: kelas, pendaftaran peserta (kuota), SPP bulanan satu faktur per wali, tanpa tagih ganda.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Jasa pendidikan: kelas + SPP (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let sales = '';
  let wali1 = ''; let wali2 = ''; let kelas = ''; let kelasKecil = '';
  const stamp = Date.now();
  const today = todayJakarta();
  const period = today.slice(0, 7);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Bimbel Cerdas', name: 'Pemilik', email: `ed-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Sales', email: `ed-s-${stamp}@uji.id`, password: 'rahasia12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `ed-s-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    wali1 = (await post(owner, '/api/customers', { code: 'W1', name: 'Bu Ratna', paymentTermDays: 7 }).expect(201)).body.id;
    wali2 = (await post(owner, '/api/customers', { code: 'W2', name: 'Pak Hendra', paymentTermDays: 7 }).expect(201)).body.id;
    kelas = (await post(owner, '/api/services/education/classes', { code: 'mat-7', name: 'Matematika kelas 7', monthlyFee: '300000', capacity: 5, startDate: addDays(today, -90) }).expect(201)).body.id;
    kelasKecil = (await post(owner, '/api/services/education/classes', { code: 'ING-1', name: 'Inggris dasar', monthlyFee: '200000', capacity: 1, startDate: addDays(today, -90) }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const enroll = (classId: string, customerId: string, studentName: string, extra: object = {}) =>
    post(owner, '/api/services/education/enrollments', { classId, customerId, studentName, enrolledOn: addDays(today, -40), ...extra });

  it('kode kelas unik (tidak peka huruf besar) dan SPP harus positif', async () => {
    expect((await post(owner, '/api/services/education/classes', { code: 'MAT-7', name: 'Dobel', monthlyFee: '1', startDate: today })).status).toBe(409);
    expect((await post(owner, '/api/services/education/classes', { code: 'NOL-1', name: 'Nol', monthlyFee: '0', startDate: today })).status).toBe(400);
  });

  it('peran SALES tidak punya akses ke kelas dan pendaftaran', async () => {
    expect((await get(sales, '/api/services/education/classes')).status).toBe(403);
    expect((await post(sales, '/api/services/education/enrollments', { classId: kelas, customerId: wali1, studentName: 'X', enrolledOn: today })).status).toBe(403);
  });

  it('kuota kelas ditegakkan', async () => {
    await enroll(kelasKecil, wali1, 'Dina').expect(201);
    const r = await enroll(kelasKecil, wali2, 'Eka');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/penuh/);
  });

  it('SPP satu faktur per wali, satu baris per peserta, diskon diterapkan', async () => {
    await enroll(kelas, wali1, 'Andi').expect(201);
    await enroll(kelas, wali1, 'Budi', { discountPct: '10' }).expect(201); // saudara kandung
    await enroll(kelas, wali2, 'Cici', { enrolledOn: addDays(today, -100) }).expect(201);
    const due = (await get(owner, `/api/services/education/due?period=${period}`).expect(200)).body as { customerId: string; total: string; students: unknown[] }[];
    const d1 = due.find((d) => d.customerId === wali1)!;
    expect(d1.students).toHaveLength(3); // Dina (200rb) + Andi (300rb) + Budi (270rb)
    expect(d1.total).toBe('770000.00');
    const r = (await post(owner, '/api/services/education/bill', { period }).expect(201)).body;
    expect(r.invoices).toHaveLength(2);
    const inv = r.invoices.find((i: { customerId: string }) => i.customerId === wali1);
    const detail = (await get(owner, `/api/invoices/${inv.invoiceId}`).expect(200)).body;
    expect(Number(detail.subtotal)).toBe(770000);
    expect(JSON.stringify(detail)).toMatch(/SPP Matematika kelas 7 — Budi/);
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  });

  it('tidak bisa menagih dua kali; periode depan ditolak', async () => {
    expect((await post(owner, '/api/services/education/bill', { period })).status).toBe(400);
    expect((await post(owner, '/api/services/education/bill', { period: `${Number(period.slice(0, 4)) + 1}-01` })).status).toBe(400);
    expect((await get(owner, `/api/services/education/due?period=${period}`).expect(200)).body).toEqual([]);
  });

  it('periode lampau ditagih sekali; peserta keluar berhenti ditagih mulai bulan berikutnya', async () => {
    const list = (await get(owner, '/api/services/education/enrollments').expect(200)).body as { id: string; studentName: string }[];
    const cici = list.find((e) => e.studentName === 'Cici')!;
    expect((await post(owner, `/api/services/education/enrollments/${cici.id}/leave`, { leftOn: addDays(today, -75), reason: 'x' })).status).toBe(400);
    await post(owner, `/api/services/education/enrollments/${cici.id}/leave`, { leftOn: addDays(today, -75), reason: 'Pindah sekolah' }).expect(201);
    expect((await post(owner, `/api/services/education/enrollments/${cici.id}/leave`, { leftOn: today, reason: 'Pindah sekolah' })).status).toBe(400);
    const prev = addDays(today, -35).slice(0, 7);
    const due = (await get(owner, `/api/services/education/due?period=${prev}`).expect(200)).body as { customerId: string }[];
    expect(due.find((d) => d.customerId === wali2)).toBeUndefined(); // Cici sudah keluar sebelum periode itu
    expect(due.find((d) => d.customerId === wali1)).toBeDefined();
  });

  it('penagihan serentak hanya sekali berhasil', async () => {
    const mei = '2020-01';
    // kelas lama untuk periode lampau
    const k = (await post(owner, '/api/services/education/classes', { code: 'LAMA-1', name: 'Kelas lama', monthlyFee: '100000', startDate: '2019-12-01' }).expect(201)).body.id;
    await enroll(k, wali2, 'Fani', { enrolledOn: '2019-12-05' }).expect(201);
    const res = await Promise.all([post(owner, '/api/services/education/bill', { period: mei }), post(owner, '/api/services/education/bill', { period: mei })]);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.find((r) => r.status !== 201)!.status).toBeGreaterThanOrEqual(400);
    const cnt = (await get(owner, '/api/services/education/enrollments').expect(200)).body.find((e: { studentName: string }) => e.studentName === 'Fani').billedPeriods;
    expect(cnt.filter((p: string) => p === mei)).toHaveLength(1);
  });
});
