/**
 * Karyawan usaha jasa: status kepegawaian (tetap, kontrak, harian, tenaga lepas, magang, mitra), verifikasi karyawan baru,
 * persetujuan perubahan data sensitif, kontrak berakhir otomatis menghentikan gaji, upah harian hanya hari yang dicatat hadir,
 * tenaga lepas dibayar dari catatan kerja, dan pencegahan karyawan/rekening ganda.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Karyawan usaha jasa (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let hr: string;
  let fin: string;
  let finId: string;
  let tenantId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const patch = (url: string, body: object, t = owner) => http.patch(url).set(as(t)).send(body);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const period = today.slice(0, 7);
  const prevDate = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
  const prevPeriod = prevDate.toISOString().slice(0, 7);
  const lastOfPrev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const nextMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);
  const JOIN = '2000-01-03';

  const mkUser = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `kj-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `kj-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    return { token: r.accessToken as string, id: r.user.id as string };
  };
  const emp = (code: string, extra: object = {}, t = hr) => post('/api/hr/employees', { code, name: `Pegawai ${code}`, ptkp: 'TK/0', joinDate: JOIN, baseSalary: '5000000', ...extra }, t);
  const run = async (p: string) => (await post('/api/payroll/runs', { period: p }, hr).expect(201)).body;
  const slip = (r: { payslips: { employeeId: string }[] }, id: string) => r.payslips.find((p) => p.employeeId === id) as Record<string, string> | undefined;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Karyawan Jasa', name: 'Pemilik', email: `kj-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    hr = (await mkUser('HR', 'hr')).token;
    const f = await mkUser('FINANCE', 'keuangan');
    fin = f.token;
    finId = f.id;
    await post('/api/apps/payroll/install').expect(201);
  });
  afterAll(() => app.close());

  it('usaha non-jasa: status selain tetap ditolak, perilaku lama tidak berubah', async () => {
    const o = (await http.post('/api/auth/register').send({ companyName: 'Toko', name: 'P', email: `kj-d-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post('/api/apps/payroll/install', {}, o).expect(201);
    expect((await emp('D-1', { employmentType: 'KONTRAK', contractEnd: '2030-01-01' }, o)).status).toBe(400);
    const e = (await emp('D-2', {}, o).expect(201)).body;
    expect(e.verified).toBe(true);
    expect(e.employmentType).toBe('TETAP');
    const u = await patch(`/api/hr/employees/${e.id}`, { baseSalary: '6000000' }, o).expect(200); // langsung berlaku
    expect(u.body.baseSalary).toBe('6000000.00');
    expect(u.body.pendingChange).toBeNull();
  });

  it('aturan per status: gaji tetap wajib > 0; kontrak wajib tanggal akhir ≤ 5 tahun; harian wajib upah harian; lepas/mitra tanpa gaji dan tanpa BPJS', async () => {
    expect((await emp('X-1', { baseSalary: '0' })).status).toBe(400);
    expect((await emp('X-2', { employmentType: 'KONTRAK' })).status).toBe(400); // tanpa akhir kontrak
    expect((await emp('X-3', { employmentType: 'KONTRAK', joinDate: today, contractEnd: '2099-01-01' })).status).toBe(400); // > 5 tahun
    expect((await emp('X-4', { employmentType: 'KONTRAK', contractEnd: '1999-01-01' })).status).toBe(400); // sebelum mulai
    expect((await emp('X-5', { employmentType: 'HARIAN', baseSalary: '0' })).status).toBe(400); // tanpa upah harian
    expect((await emp('X-6', { employmentType: 'HARIAN', baseSalary: '1000000', dailyWage: '100000' })).status).toBe(400); // harian tanpa gaji bulanan
    expect((await emp('X-7', { employmentType: 'TENAGA_LEPAS', baseSalary: '1000000' })).status).toBe(400);
    expect((await emp('X-8', { employmentType: 'TETAP', contractEnd: '2030-01-01' })).status).toBe(400);
    const lepas = (await emp('L-0', { employmentType: 'MITRA', baseSalary: '0', bpjsKes: true, bpjsTk: true }).expect(201)).body;
    expect([lepas.bpjsKes, lepas.bpjsTk, lepas.bpjsJp]).toEqual([false, false, false]); // dinormalkan server
  });

  it('karyawan baru dari HR belum ikut gaji sampai diverifikasi orang lain; HR tidak memverifikasi sendiri', async () => {
    const e = (await emp('T-1', { bankAccount: '111222333' }).expect(201)).body;
    expect(e.verified).toBe(false);
    expect((await post(`/api/hr/employment/employees/${e.id}/verify`, {}, hr)).status).toBe(403);
    const r1 = await run(prevPeriod);
    expect(slip(r1, e.id)).toBeUndefined(); // belum diverifikasi → tidak digaji
    const w = (await get('/api/hr/employment/alerts', fin).expect(200)).body as { kind: string }[];
    expect(w.some((x) => x.kind === 'BELUM_DIVERIFIKASI')).toBe(true);
    await post(`/api/payroll/runs/${r1.id}/recompute`, {}, hr).expect(201);
    // karyawan yang dihubungkan ke akun Keuangan tidak memverifikasi dirinya sendiri
    await db.execute(sql`UPDATE employees SET user_id = ${finId} WHERE id = ${e.id}`);
    expect((await post(`/api/hr/employment/employees/${e.id}/verify`, {}, fin)).status).toBe(403);
    await db.execute(sql`UPDATE employees SET user_id = NULL WHERE id = ${e.id}`);
    await post(`/api/hr/employment/employees/${e.id}/verify`, {}, fin).expect(201);
    const again = (await post(`/api/payroll/runs/${r1.id}/recompute`, {}, hr).expect(201)).body;
    expect(slip(again, e.id)).toBeDefined(); // setelah verifikasi ikut gaji
    expect((await post(`/api/hr/employment/employees/${e.id}/verify`, {}, fin)).status).toBe(400); // sudah
  });

  it('rekening / NIK sama dengan karyawan aktif lain ditolak', async () => {
    expect((await emp('T-2', { bankAccount: '111-222-333' })).status).toBe(400);
    await emp('T-3', { nik: '3174010101900001' }).expect(201);
    expect((await emp('T-4', { nik: '3174010101900001' })).status).toBe(400);
  });

  it('perubahan gaji / rekening oleh HR menjadi permintaan; disetujui orang lain; data lama-baru tercatat; tidak boleh dobel; data basi ditolak', async () => {
    const all = (await get('/api/hr/employees', hr).expect(200)).body as { id: string; code: string }[];
    const t1 = all.find((x) => x.code === 'T-1')!;
    const r = await patch(`/api/hr/employees/${t1.id}`, { baseSalary: '9000000', jobTitle: 'Konsultan', reason: 'Kenaikan sesuai evaluasi' }, hr).expect(200);
    expect(r.body.pendingChange.fields).toEqual(['baseSalary']);
    expect(r.body.baseSalary).toBe('5000000.00'); // belum berubah
    expect(r.body.jobTitle).toBe('Konsultan'); // non-sensitif langsung berlaku
    expect((await patch(`/api/hr/employees/${t1.id}`, { bankAccount: '999000999' }, hr)).status).toBe(400); // sudah ada yang menunggu
    const pending = (await get('/api/hr/employment/changes?status=PENDING', fin).expect(200)).body as { id: string; employeeCode: string; changes: Record<string, { from: unknown; to: unknown }> }[];
    const req = pending.find((p) => p.employeeCode === 'T-1')!;
    expect(req.changes.baseSalary.to).toBe('9000000');
    expect((await post(`/api/hr/employment/changes/${req.id}/approve`, {}, hr)).status).toBe(403); // HR tidak menyetujui
    // Pemilik mengubah langsung → permintaan menjadi basi
    await patch(`/api/hr/employees/${t1.id}`, { baseSalary: '5500000' }).expect(200);
    const stale = await post(`/api/hr/employment/changes/${req.id}/approve`, {}, fin);
    expect(stale.status).toBe(400);
    expect(JSON.stringify(stale.body)).toMatch(/sudah berubah/);
    await post(`/api/hr/employment/changes/${req.id}/reject`, { reason: 'Data basi' }, fin).expect(201);
    // ajukan ulang → setujui
    await patch(`/api/hr/employees/${t1.id}`, { baseSalary: '9000000' }, hr).expect(200);
    const req2 = ((await get('/api/hr/employment/changes?status=PENDING', fin).expect(200)).body as { id: string; employeeCode: string }[]).find((p) => p.employeeCode === 'T-1')!;
    await post(`/api/hr/employment/changes/${req2.id}/approve`, {}, fin).expect(201);
    expect(((await get(`/api/hr/employees/${t1.id}`, hr).expect(200)).body as { baseSalary: string }).baseSalary).toBe('9000000.00');
    // permintaan yang melanggar aturan status langsung ditolak saat diajukan
    expect((await patch(`/api/hr/employees/${t1.id}`, { employmentType: 'HARIAN' }, hr)).status).toBe(400);
  });

  it('kontrak berakhir: gaji otomatis berhenti; catatan kerja sesudahnya ditolak; perpanjangan lewat persetujuan', async () => {
    const k = (await emp('K-1', { employmentType: 'KONTRAK', contractStart: `${prevPeriod}-01`, contractEnd: lastOfPrev, bankAccount: '555000111' }, owner).expect(201)).body;
    expect(k.verified).toBe(true); // dibuat Pemilik
    const r = await run(period);
    expect(slip(r, k.id)).toBeUndefined(); // kontrak berakhir bulan lalu → tidak digaji bulan ini
    const w = (await get('/api/hr/employment/alerts', fin).expect(200)).body as { kind: string }[];
    expect(w.some((x) => x.kind === 'KONTRAK_BERAKHIR')).toBe(true);
    // catatan kerja sesudah kontrak berakhir ditolak
    const rate = (await post('/api/payroll/service/rates', { name: 'Jam kontrak', unit: 'HOUR', rate: '100000' }, fin).expect(201)).body.id;
    const rej = await post('/api/payroll/service/entries', { employeeId: k.id, rateId: rate, quantity: '2', workDate: today }, hr);
    expect(rej.status).toBe(400);
    expect(JSON.stringify(rej.body)).toMatch(/Kontrak pegawai berakhir/);
    // perpanjang (HR mengajukan, Keuangan menyetujui) → ikut gaji lagi
    await patch(`/api/hr/employees/${k.id}`, { contractEnd: nextMonthEnd, reason: 'Diperpanjang 1 bulan' }, hr).expect(200);
    const req = ((await get('/api/hr/employment/changes?status=PENDING', fin).expect(200)).body as { id: string; employeeCode: string }[]).find((p) => p.employeeCode === 'K-1')!;
    await post(`/api/hr/employment/changes/${req.id}/approve`, {}, fin).expect(201);
    const after = (await post(`/api/payroll/runs/${r.id}/recompute`, {}, hr).expect(201)).body;
    expect(slip(after, k.id)).toBeDefined();
    await post('/api/payroll/service/entries', { employeeId: k.id, rateId: rate, quantity: '2', workDate: today }, hr).expect(201);
  });

  it('upah harian hanya untuk hari yang DICATAT hadir', async () => {
    const h = (await emp('H-1', { employmentType: 'HARIAN', baseSalary: '0', dailyWage: '200000', bankAccount: '777000111' }, owner).expect(201)).body;
    // tiga hari kerja pertama bulan lalu dicatat hadir
    const days: string[] = [];
    for (let d = new Date(prevDate); days.length < 3; d = new Date(d.getTime() + 86400000)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
    }
    for (const date of days) await db.execute(sql`INSERT INTO attendances (tenant_id, employee_id, date, status) VALUES (${tenantId}, ${h.id}, ${date}, 'HADIR')`);
    const r = (await post(`/api/payroll/runs/${(await get('/api/payroll/runs').expect(200)).body.find((x: { period: string }) => x.period === prevPeriod).id}/recompute`, {}, hr).expect(201)).body;
    const s = slip(r, h.id)!;
    expect(Number(s.baseSalary)).toBe(600000); // 3 hari × 200.000, bukan seluruh hari kerja
    expect(Number(s.absenceDeduction)).toBe(0);
  });

  it('tenaga lepas: tidak diabsen / tidak cuti; slip hanya bila ada upah jasa; tanpa BPJS', async () => {
    const l = (await emp('F-1', { employmentType: 'TENAGA_LEPAS', baseSalary: '0', bankAccount: '888000111' }, owner).expect(201)).body;
    const day = (await get(`/api/hr/attendance?date=${today}`, hr).expect(200)).body.rows as { employee: { id: string } }[];
    expect(day.some((x) => x.employee.id === l.id)).toBe(false);
    expect((await post('/api/hr/attendance', { date: today, rows: [{ employeeId: l.id, status: 'HADIR' }] }, hr)).status).toBe(400);
    expect((await post('/api/hr/leaves', { employeeId: l.id, type: 'ANNUAL', startDate: today, endDate: today }, hr)).status).toBe(400);
    const runs = (await get('/api/payroll/runs').expect(200)).body as { id: string; period: string }[];
    const cur = runs.find((x) => x.period === period)!;
    expect(slip((await post(`/api/payroll/runs/${cur.id}/recompute`, {}, hr).expect(201)).body, l.id)).toBeUndefined(); // tanpa upah jasa → tanpa slip
    const rate = (await get('/api/payroll/service/rates', fin).expect(200)).body.find((x: { name: string }) => x.name === 'Jam kontrak').id;
    const e = (await post('/api/payroll/service/entries', { employeeId: l.id, rateId: rate, quantity: '3', workDate: today }, hr).expect(201)).body;
    await post(`/api/payroll/service/entries/${e.id}/approve`, {}, fin).expect(201);
    const s = slip((await post(`/api/payroll/runs/${cur.id}/recompute`, {}, hr).expect(201)).body, l.id)!;
    expect(Number(s.serviceIncome)).toBe(300000);
    expect(Number(s.bpjsKesEmployee) + Number(s.jhtEmployee) + Number(s.jpEmployee)).toBe(0);
  });

  it('karyawan baru dari HR tidak bisa dicatat upah jasanya sebelum diverifikasi', async () => {
    const e = (await emp('U-1', { employmentType: 'TENAGA_LEPAS', baseSalary: '0', bankAccount: '123123123' }).expect(201)).body;
    const rate = (await get('/api/payroll/service/rates', fin).expect(200)).body.find((x: { name: string }) => x.name === 'Jam kontrak').id;
    expect((await post('/api/payroll/service/entries', { employeeId: e.id, rateId: rate, quantity: '1', workDate: today }, hr)).status).toBe(400);
    await post(`/api/hr/employment/employees/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/payroll/service/entries', { employeeId: e.id, rateId: rate, quantity: '1', workDate: today }, hr).expect(201);
  });

  it('jejak audit mencatat verifikasi dan permintaan perubahan', async () => {
    const rows = await db.execute<{ action: string }>(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tenantId} AND entity IN ('Employee', 'EmployeeChange')`);
    const acts = new Set(rows.rows.map((r) => r.action));
    for (const a of ['CREATE', 'VERIFY', 'REQUEST', 'APPROVE', 'REJECT']) expect(acts.has(a)).toBe(true);
  });
});
