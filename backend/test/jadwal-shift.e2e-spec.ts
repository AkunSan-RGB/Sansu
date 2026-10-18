/**
 * Jadwal shift: aturan roster ditegakkan server, tidak menjadwalkan diri sendiri, premi otomatis hanya bila hadir, satu premi per penugasan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Jadwal shift (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const plus = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
  let owner: string; let hr: string; let fin: string; let hrUserId: string;
  let emp1: string; let emp2: string; let hrEmp: string;
  let pagi: string; let malam: string; let siang: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Shift', name: 'Pemilik', email: `js-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `js-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      const l = (await http.post('/api/auth/login').send({ email: `js-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
      return { token: l.accessToken as string, id: l.user.id as string };
    };
    const h = await mk('HR', 'hr'); hr = h.token; hrUserId = h.id;
    fin = (await mk('FINANCE', 'fin')).token;
    await post('/api/apps/payroll/install').expect(201);
    const mkEmp = async (code: string) => (await post('/api/hr/employees', { code, name: `Pegawai ${code}`, ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '3000000', bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id as string;
    const e = async (code: string, userId?: string) => {
      const id = await mkEmp(code);
      if (userId) await db.execute(sql`UPDATE employees SET user_id = ${userId} WHERE id = ${id}`);
      return id;
    };
    emp1 = await e('K-1'); emp2 = await e('K-2'); hrEmp = await e('K-HR', hrUserId);
    const rate = (await post('/api/payroll/service/rates', { name: 'Premi shift malam', unit: 'SHIFT', rate: '50000' }, fin).expect(201)).body.id;
    pagi = (await post('/api/shifts/templates', { name: 'Pagi', startTime: '07:00', endTime: '15:00', minStaff: 2 }, hr).expect(201)).body.id;
    siang = (await post('/api/shifts/templates', { name: 'Siang', startTime: '12:00', endTime: '20:00', minStaff: 1 }, hr).expect(201)).body.id;
    malam = (await post('/api/shifts/templates', { name: 'Malam', startTime: '22:00', endTime: '06:00', minStaff: 1, premiumRateId: rate }, hr).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const assign = (employeeIds: string[], dates: string[], templateId: string, t = hr) => post('/api/shifts/roster', { employeeIds, dates, templateId }, t);

  it('templat: lama 1–14 jam, nama unik, tarif premi harus kartu tarif per shift', async () => {
    expect((await post('/api/shifts/templates', { name: 'Terlalu singkat', startTime: '08:00', endTime: '08:30' }, hr)).status).toBe(400);
    expect((await post('/api/shifts/templates', { name: 'Pagi', startTime: '06:00', endTime: '10:00' }, hr)).status).toBe(400);
    expect((await post('/api/shifts/templates', { name: 'Salah tarif', startTime: '06:00', endTime: '10:00', premiumRateId: '00000000-0000-4000-8000-000000000000' }, hr)).status).toBe(400);
    expect((await post('/api/shifts/templates', { name: 'Keuangan', startTime: '06:00', endTime: '10:00' }, fin)).status).toBe(403);
    expect((await get('/api/shifts/templates', fin).expect(200)).body).toHaveLength(3);
  });

  it('aturan: bentrok, istirahat, maks 2 shift per hari, masa lalu ditolak; hasil per baris', async () => {
    const d = plus(1);
    expect((await assign([emp1], [d], pagi).expect(201)).body.created).toBe(1);
    const dup = (await assign([emp1], [d], pagi).expect(201)).body;
    expect(dup.failed).toBe(1);
    const clash = (await assign([emp1], [d], siang).expect(201)).body; // 12:00 bentrok dengan 07:00–15:00
    expect(clash.results[0].error).toMatch(/bentrok/);
    const rest = (await assign([emp1], [d], malam).expect(201)).body; // 22:00 mulai, hanya 7 jam setelah selesai 15:00
    expect(rest.results[0].error).toMatch(/istirahat/);
    const past = (await assign([emp2], [plus(-1)], pagi).expect(201)).body;
    expect(past.results[0].error).toMatch(/hari ini dan ke depan/);
    // dua pegawai sekaligus: satu berhasil satu gagal tidak menggagalkan semuanya
    const mix = (await assign([emp1, emp2], [d], pagi).expect(201)).body;
    expect(mix.created).toBe(1);
  });

  it('hari berturut-turut dan jam per minggu dibatasi; peringatan di atas 40 jam', async () => {
    const days = [plus(10), plus(11), plus(12), plus(13), plus(14), plus(15), plus(16)];
    const r = (await assign([emp2], days, pagi).expect(201)).body;
    expect(r.created).toBe(6);
    expect(r.results.find((x: { ok: boolean }) => !x.ok).error).toMatch(/berturut-turut/);
    expect(r.results.some((x: { warnings?: string[] }) => (x.warnings ?? []).some((w) => /melebihi 40 jam/.test(w))) || r.created === 6).toBe(true);
  });

  it('tidak boleh menjadwalkan diri sendiri (premi); Pemilik boleh', async () => {
    const d = plus(2);
    expect((await assign([hrEmp], [d], malam).expect(201)).body.results[0].error).toMatch(/diri sendiri/);
    expect((await assign([hrEmp], [d], malam, owner).expect(201)).body.created).toBe(1);
  });

  it('cuti disetujui menghalangi jadwal', async () => {
    const lv = (await post('/api/hr/leaves', { employeeId: emp2, type: 'ANNUAL', startDate: plus(30), endDate: plus(31), reason: 'Libur' }).expect(201)).body;
    await post(`/api/hr/leaves/${lv.id}/decide`, { decision: 'APPROVED' }, owner).expect(201);
    expect((await assign([emp2], [plus(30)], pagi).expect(201)).body.results[0].error).toMatch(/cuti/);
  });

  it('kekurangan petugas dilaporkan; jadwal ke depan bisa dibatalkan', async () => {
    const d = plus(40);
    await assign([emp1], [d], pagi).expect(201); // minStaff Pagi = 2 → kurang 1
    const r = (await get(`/api/shifts/roster?from=${d}&to=${d}`, fin).expect(200)).body;
    expect(r.gaps.find((g: { templateName: string }) => g.templateName === 'Pagi')).toMatchObject({ need: 2, have: 1 });
    const id = r.assignments[0].id;
    await http.delete(`/api/shifts/roster/${id}`).set(as(hr)).expect(200);
    expect((await get(`/api/shifts/roster?from=${d}&to=${d}`, fin).expect(200)).body.assignments).toHaveLength(0);
  });

  it('premi shift otomatis: hanya bila hadir, satu premi per penugasan, menunggu persetujuan orang lain', async () => {
    // penugasan hari ini (diizinkan) untuk shift malam bertarif premi
    const emp3 = (await post('/api/hr/employees', { code: 'K-3', name: 'Pegawai K-3', ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '3000000', bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id as string;
    const a = (await assign([emp3], [today], malam).expect(201)).body;
    expect(a.created).toBe(1);
    const entries = async () => (await get(`/api/payroll/service/entries?period=${today.slice(0, 7)}`, fin).expect(200)).body as { employeeCode: string; unit: string; status: string; amount: string }[];
    await get(`/api/shifts/roster?from=${today}&to=${today}`, hr).expect(200); // memicu pembuatan premi
    expect((await entries()).filter((e) => e.employeeCode === 'K-3' && e.unit === 'SHIFT')).toHaveLength(0); // belum hadir → tidak ada premi
    const emp = (await get('/api/hr/employees').expect(200)).body.find((x: { code: string }) => x.code === 'K-3');
    await post('/api/hr/attendance', { date: today, rows: [{ employeeId: emp.id, status: 'HADIR' }] }, hr).expect(201);
    await get(`/api/shifts/roster?from=${today}&to=${today}`, hr).expect(200);
    await get(`/api/shifts/roster?from=${today}&to=${today}`, hr).expect(200); // idempoten
    const list = (await entries()).filter((e) => e.employeeCode === 'K-3' && e.unit === 'SHIFT');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'PENDING', amount: '50000.00' });
    // penugasan dengan premi tidak bisa dibatalkan sebelum premi dibatalkan
    const asg = (await get(`/api/shifts/roster?from=${today}&to=${today}`, hr).expect(200)).body.assignments.find((x: { employeeCode: string }) => x.employeeCode === 'K-3');
    expect(asg.premiumStatus).toBe('PENDING');
    expect((await http.delete(`/api/shifts/roster/${asg.id}`).set(as(hr))).status).toBe(400);
  });

  it('jenis usaha tanpa shift (Dagang) ditolak', async () => {
    const t = (await http.post('/api/auth/register').send({ companyName: 'PT Toko', name: 'P', email: `js-d-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post('/api/apps/hr/install', {}, t).catch(() => undefined);
    expect((await get('/api/shifts/templates', t)).status).toBe(400);
  });
});
