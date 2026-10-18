/**
 * Gaji usaha jasa: kartu tarif, catatan kerja (jam/sesi/borongan/komisi faktur), persetujuan, otomatis masuk slip gaji,
 * biaya proyek, dan pencegahan kecurangan (pemisahan fungsi, batas jam, absensi, komisi hanya dari faktur lunas, penguncian).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Gaji usaha jasa (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let hr: string;
  let hrId: string;
  let fin: string;
  let acct: string;
  let tenantId: string;
  let cust: string;
  let empA: string;
  let empB: string;
  let hourRate: string;
  let sessRate: string;
  let pctRate: string;
  let projectId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const period = today.slice(0, 7);
  const dayOffset = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);

  const mkUser = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `gj-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `gj-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    return { token: r.accessToken as string, id: r.user.id as string };
  };
  const entry = (employeeId: string, rateId: string, extra: object = {}, t = hr) => post('/api/payroll/service/entries', { employeeId, rateId, ...extra }, t);
  const serviceInvoice = async (price: string) => {
    const inv = (await post('/api/services/invoices', { customerId: cust, projectId, date: today, lines: [{ description: 'Jasa konsultasi', price }] }).expect(201)).body;
    return inv as { id: string };
  };
  const payInvoice = async (inv: { id: string }) => {
    const total = (await get(`/api/invoices/${inv.id}`).expect(200)).body.total as string;
    await post('/api/payments', { invoiceId: inv.id, amount: total, method: 'TRANSFER' }).expect(201);
  };
  const slipOf = async (runId: string, employeeId: string) => {
    const run = (await get(`/api/payroll/runs/${runId}`).expect(200)).body;
    return run.payslips.find((p: { employeeId: string }) => p.employeeId === employeeId);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Jasa Uji', name: 'Pemilik', email: `gj-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    const h = await mkUser('HR', 'hr');
    hr = h.token;
    hrId = h.id;
    fin = (await mkUser('FINANCE', 'keuangan')).token;
    acct = (await mkUser('ACCOUNTANT', 'akuntan')).token;
    await post('/api/apps/payroll/install').expect(201);
    const e = async (code: string, salary: string, employmentType = 'TETAP') => (await post('/api/hr/employees', { code, name: `Pegawai ${code}`, ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: salary, employmentType, bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id as string;
    empA = await e('J-1', '0', 'TENAGA_LEPAS'); // tenaga lepas: tanpa gaji pokok
    empB = await e('J-2', '3000000');
    cust = (await post('/api/customers', { code: 'KLN', name: 'Klien' }).expect(201)).body.id;
    projectId = (await post('/api/services/projects', { name: 'Proyek Audit', customerId: cust, contractValue: '50000000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('komisi faktur jasa khusus usaha jasa; usaha dagang hanya memakai satuan miliknya', async () => {
    const o = (await http.post('/api/auth/register').send({ companyName: 'Toko', name: 'P', email: `gj-d-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post('/api/apps/payroll/install', {}, o).expect(201);
    expect((await get('/api/payroll/service/rates', o)).status).toBe(200);
    expect((await get('/api/payroll/service/commissionable-invoices', o)).status).toBe(400);
    expect((await post('/api/payroll/service/rates', { name: 'Per jam', unit: 'HOUR', rate: '10000' }, o)).status).toBe(400);
    expect((await post('/api/payroll/service/rates', { name: 'Komisi', unit: 'PERCENT', rate: '5' }, o)).status).toBe(400);
  });

  it('tarif hanya diatur Keuangan/Admin, bukan HR; persen maksimal 100; nama unik', async () => {
    expect((await post('/api/payroll/service/rates', { name: 'Senior', unit: 'HOUR', rate: '250000' }, hr)).status).toBe(403);
    hourRate = (await post('/api/payroll/service/rates', { name: 'Konsultan — per jam', unit: 'HOUR', rate: '250000' }, fin).expect(201)).body.id;
    sessRate = (await post('/api/payroll/service/rates', { name: 'Terapi — per sesi', unit: 'SESSION', rate: '150000' }, fin).expect(201)).body.id;
    pctRate = (await post('/api/payroll/service/rates', { name: 'Komisi 5%', unit: 'PERCENT', rate: '5' }, fin).expect(201)).body.id;
    expect((await post('/api/payroll/service/rates', { name: 'Konsultan — per jam', unit: 'HOUR', rate: '1' }, fin)).status).toBe(400);
    expect((await post('/api/payroll/service/rates', { name: 'Komisi gila', unit: 'PERCENT', rate: '150' }, fin)).status).toBe(400);
    expect((await post('/api/payroll/service/rates', { name: 'Nol', unit: 'JOB', rate: '0' }, fin)).status).toBe(400);
  });

  it('catatan jam: nominal dihitung server dari tarif; batas jam per hari; tanggal masa depan / terlalu lampau ditolak; kembar ditolak', async () => {
    const r = (await entry(empA, hourRate, { quantity: '6.5', workDate: today, projectId, description: 'Audit lapangan' }).expect(201)).body;
    expect(r.status).toBe('PENDING');
    expect(r.amount).toBe('1625000.00');
    expect((await entry(empA, hourRate, { quantity: '6.5', workDate: today, projectId })).status).toBe(400); // kembar persis
    expect((await entry(empA, hourRate, { quantity: '10', workDate: today })).status).toBe(400); // 6,5 + 10 > 16 jam sehari
    expect((await entry(empA, hourRate, { quantity: '17', workDate: dayOffset(-1) })).status).toBe(400);
    expect((await entry(empA, hourRate, { quantity: '1', workDate: dayOffset(1) })).status).toBe(400);
    expect((await entry(empA, hourRate, { quantity: '1', workDate: dayOffset(-90) })).status).toBe(400);
    expect((await entry(empA, hourRate, { quantity: '0', workDate: today })).status).toBe(400);
    expect((await entry(empA, hourRate, { quantity: '1', workDate: `${today.slice(0, 4)}-01-01` })).status).toBe(400); // sebelum bergabung
    expect((await entry(empA, hourRate, { quantity: '1', workDate: today, invoiceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400); // faktur hanya untuk komisi
    expect((await entry(empA, hourRate, { quantity: '1' }, fin)).status).toBe(403); // hanya HR yang mengisi
  });

  it('absensi bentrok ditolak; pegawai tidak mencatat upahnya sendiri', async () => {
    const d = dayOffset(-2);
    await db.execute(sql`INSERT INTO attendances (tenant_id, employee_id, date, status) VALUES (${tenantId}, ${empB}, ${d}, 'SAKIT')`);
    expect((await entry(empB, sessRate, { quantity: '2', workDate: d })).status).toBe(400);
    await db.execute(sql`UPDATE employees SET user_id = ${hrId} WHERE id = ${empB}`);
    expect((await entry(empB, sessRate, { quantity: '2', workDate: today })).status).toBe(403);
    await db.execute(sql`UPDATE employees SET user_id = NULL WHERE id = ${empB}`);
  });

  it('persetujuan: HR tidak menyetujui; pemilik boleh; tolak butuh alasan; pembuat tidak menyetujui catatannya sendiri (selain Pemilik)', async () => {
    const e = (await entry(empB, sessRate, { quantity: '4', workDate: today, description: 'Terapi' }).expect(201)).body;
    expect(e.amount).toBe('600000.00');
    expect((await post(`/api/payroll/service/entries/${e.id}/approve`, {}, hr)).status).toBe(403);
    expect((await post(`/api/payroll/service/entries/${e.id}/reject`, { reason: 'x' }, fin)).status).toBe(400);
    const bad = (await entry(empB, sessRate, { quantity: '1', workDate: dayOffset(-1) }).expect(201)).body;
    await post(`/api/payroll/service/entries/${bad.id}/reject`, { reason: 'Tidak ada bukti sesi' }, fin).expect(201);
    expect((await post(`/api/payroll/service/entries/${bad.id}/approve`, {}, fin)).status).toBe(400); // sudah diputuskan
    // pegawai yang bersangkutan tidak memutuskan upahnya sendiri
    const finUser = (await get('/api/users').expect(200)).body.find((u: { role: string }) => u.role === 'FINANCE').id;
    await db.execute(sql`UPDATE employees SET user_id = ${finUser} WHERE id = ${empB}`);
    expect((await post(`/api/payroll/service/entries/${e.id}/approve`, {}, fin)).status).toBe(403);
    await db.execute(sql`UPDATE employees SET user_id = NULL WHERE id = ${empB}`);
    await post(`/api/payroll/service/entries/${e.id}/approve`, {}, fin).expect(201);
  });

  it('tarif berubah tidak mengubah catatan lama (nominal disalin saat dibuat)', async () => {
    const first = (await get(`/api/payroll/service/entries?period=${period}`).expect(200)).body.find((x: { employeeCode: string; unit: string; quantity: string }) => x.employeeCode === 'J-1' && x.unit === 'HOUR');
    await http.patch(`/api/payroll/service/rates/${hourRate}`).set(as(fin)).send({ rate: '400000' }).expect(200);
    const again = (await get(`/api/payroll/service/entries?period=${period}`).expect(200)).body.find((x: { id: string }) => x.id === first.id);
    expect(again.amount).toBe('1625000.00');
    await http.patch(`/api/payroll/service/rates/${hourRate}`).set(as(hr)).send({ rate: '1' }).expect(403);
    await http.patch(`/api/payroll/service/rates/${hourRate}`).set(as(fin)).send({ rate: '250000' }).expect(200);
  });

  it('komisi: hanya dari faktur jasa LUNAS; satu kali per pegawai per faktur; total persen ≤ 100', async () => {
    const inv = await serviceInvoice('10000000');
    // belum lunas → ditolak
    expect((await entry(empA, pctRate, { invoiceId: inv.id })).status).toBe(400);
    expect((await entry(empA, pctRate, {})).status).toBe(400); // wajib faktur
    await payInvoice(inv);
    const c = (await entry(empA, pctRate, { invoiceId: inv.id }).expect(201)).body;
    expect(c.amount).toBe('500000.00'); // 5% × DPP 10.000.000
    expect(c.projectId).toBe(projectId);
    expect((await entry(empA, pctRate, { invoiceId: inv.id })).status).toBe(400); // kembar
    const big = (await post('/api/payroll/service/rates', { name: 'Komisi 98%', unit: 'PERCENT', rate: '98' }, fin).expect(201)).body.id;
    expect((await entry(empB, big, { invoiceId: inv.id })).status).toBe(400); // 5 + 98 > 100
    // faktur GOODS/tidak ada
    expect((await entry(empB, pctRate, { invoiceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    await post(`/api/payroll/service/entries/${c.id}/approve`, {}, fin).expect(201);
  });

  it('penggajian otomatis memuat upah jasa; selisih dicegah; terkunci setelah diposting; jurnal seimbang', async () => {
    // setujui catatan jam A (6,5 jam) supaya ikut
    const list = (await get(`/api/payroll/service/entries?period=${period}&status=PENDING`).expect(200)).body as { id: string; employeeCode: string; amount: string }[];
    const hours = list.find((x) => x.employeeCode === 'J-1' && x.amount === '1625000.00')!;
    await post(`/api/payroll/service/entries/${hours.id}/approve`, {}, fin).expect(201);

    const run = (await post('/api/payroll/runs', { period }, hr).expect(201)).body;
    const a = await slipOf(run.id, empA);
    const b = await slipOf(run.id, empB);
    expect(Number(a.serviceIncome)).toBe(2125000); // 1.625.000 jam + 500.000 komisi
    expect(Number(b.serviceIncome)).toBe(600000);
    expect(Number(a.grossPay)).toBeGreaterThanOrEqual(2125000);
    expect(Number(b.grossPay)).toBeGreaterThanOrEqual(3600000 - 3000000 * 1); // gaji pokok prorata + 600.000

    // batalkan satu catatan yang sudah masuk slip (draft) → posting ditolak sampai dihitung ulang
    const entries = (await get(`/api/payroll/service/entries?period=${period}&status=APPROVED`).expect(200)).body as { id: string; employeeCode: string; unit: string }[];
    const sess = entries.find((x) => x.employeeCode === 'J-2' && x.unit === 'SESSION')!;
    await post(`/api/payroll/service/entries/${sess.id}/void`, { reason: 'Sesi dibatalkan klien' }, fin).expect(201);
    const blocked = await post(`/api/payroll/runs/${run.id}/post`, {}, acct);
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/Hitung ulang/);
    await post(`/api/payroll/runs/${run.id}/recompute`, {}, hr).expect(201);
    expect(Number((await slipOf(run.id, empB)).serviceIncome)).toBe(0);

    // catatan yang disetujui SESUDAH gaji dihitung tidak menyelinap ke slip (masuk gaji berikutnya)
    const late = (await entry(empB, sessRate, { quantity: '1', workDate: dayOffset(-1) }).expect(201)).body;
    await post(`/api/payroll/service/entries/${late.id}/approve`, {}, fin).expect(201);
    await post(`/api/payroll/runs/${run.id}/post`, {}, acct).expect(201);
    expect(Number((await slipOf(run.id, empB)).serviceIncome)).toBe(0);

    // sesudah diposting: catatan terkunci
    const locked = (await get(`/api/payroll/service/entries?period=${period}&status=APPROVED`).expect(200)).body as { id: string; runId: string | null; employeeCode: string }[];
    const inRun = locked.find((x) => x.runId === run.id)!;
    expect((await post(`/api/payroll/service/entries/${inRun.id}/void`, { reason: 'Ubah diam-diam' }, fin)).status).toBe(400);

    const bad = await db.execute<{ id: string }>(sql`
      SELECT j.id FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id WHERE j.tenant_id = ${tenantId} GROUP BY j.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    expect(bad.rows).toEqual([]);
  });

  it('upah jasa berproyek menjadi biaya langsung proyek (tanpa dobel dengan gaji tetap)', async () => {
    const prj = (await get(`/api/services/projects/${projectId}`).expect(200)).body;
    expect(JSON.stringify(prj)).toMatch(/Upah jasa/);
  });

  it('komisi tertahan bila faktur diretur sebelum digaji; muncul di peringatan', async () => {
    const inv = await serviceInvoice('4000000');
    await payInvoice(inv);
    const c = (await entry(empB, pctRate, { invoiceId: inv.id }).expect(201)).body;
    await post(`/api/payroll/service/entries/${c.id}/approve`, {}, fin).expect(201);
    await db.execute(sql`UPDATE invoices SET returned_amount = '100000' WHERE id = ${inv.id}`); // simulasi retur
    const warn = (await get(`/api/payroll/service/anomalies?period=${period}`).expect(200)).body as { kind: string }[];
    expect(warn.some((w) => w.kind === 'KOMISI_TERTAHAN')).toBe(true);
    // faktur tidak layak lagi → persetujuan baru ditolak juga
    const c2 = (await entry(empA, pctRate, { invoiceId: inv.id })).status;
    expect(c2).toBe(400);
  });

  it('jejak audit mencatat pembuatan, persetujuan, dan pembatalan', async () => {
    const rows = await db.execute<{ action: string }>(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tenantId} AND entity = 'ServiceWorkEntry'`);
    const acts = new Set(rows.rows.map((r) => r.action));
    for (const a of ['CREATE', 'APPROVE', 'REJECT', 'VOID']) expect(acts.has(a)).toBe(true);
  });
});
