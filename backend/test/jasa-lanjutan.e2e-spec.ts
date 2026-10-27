/**
 * Jasa lanjutan: jam kerja per sumber daya, cuti memblokir pemesanan, jadwal berulang (semua-atau-tidak-sama-sekali),
 * timer jam kerja, dan retainer bulanan (satu faktur per periode).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

/** Hari kerja Senin berikutnya (≥ 4 hari dari hari ini) agar jadwal selalu di masa depan */
const nextMonday = (from: string) => {
  let d = addDays(from, 4);
  while (new Date(`${d}T12:00:00+07:00`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
};

describe('Jasa lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner = ''; let fin = ''; let adm = ''; let staff = ''; let staff2 = ''; let acct = '';
  let empA = ''; let empB = ''; let cust = '';
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    const r = (await post(owner, '/api/users', { name: n, email: `jl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201)).body;
    return { token: await login(`jl-${n}-${stamp}@uji.id`), id: r.id as string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Konsultan Lanjutan', name: 'Pemilik', email: `jl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/payroll/install').expect(201);
    fin = (await mk('FINANCE', 'fin')).token;
    adm = (await mk('ADMIN', 'adm')).token;
    const s1 = await mk('SALES', 'staf1'); staff = s1.token;
    const s2 = await mk('SALES', 'staf2'); staff2 = s2.token;
    acct = (await mk('ACCOUNTANT', 'akt')).token;
    const mkEmp = async (code: string, name: string, userId: string) => {
      const id = (await post(owner, '/api/hr/employees', { code, name, ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000' }).expect(201)).body.id as string;
      await db.execute(sql`UPDATE employees SET user_id = ${userId} WHERE id = ${id}`);
      return id;
    };
    empA = await mkEmp('E-A', 'Dewi Konsultan', s1.id);
    empB = await mkEmp('E-B', 'Eko Analis', s2.id);
    cust = (await post(owner, '/api/customers', { code: 'JL1', name: 'PT Klien Lanjutan', paymentTermDays: 14 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  describe('jam kerja sumber daya, cuti, jadwal berulang', () => {
    const mon = nextMonday(today);
    const at = (d: string, h: number, m = 0) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
    let person = ''; let room = '';
    const book = (rid: string, s: string, e: string, extra: object = {}) => post(fin, '/api/scheduling/bookings', { resourceId: rid, title: 'Sesi konsultasi', startsAt: s, endsAt: e, customerId: cust, ...extra });
    const list = async (rid: string) => (await get(fin, `/api/scheduling/bookings?resourceId=${rid}&from=${today}&to=${addDays(mon, 70)}`).expect(200)).body as { id: string; status: string; seriesId: string | null; offHours: boolean; startsAt: string }[];

    it('jam & hari kerja per sumber daya: validasi, slot kosong, penandaan di luar jam', async () => {
      expect((await post(adm, '/api/scheduling/resources', { name: 'Salah', kind: 'ROOM', workStart: 15, workEnd: 9 })).status).toBe(400);
      expect((await post(adm, '/api/scheduling/resources', { name: 'Salah2', kind: 'ROOM', workDays: '1,9' })).status).toBe(400);
      room = (await post(adm, '/api/scheduling/resources', { name: 'Ruang Sempit', kind: 'ROOM', workStart: 9, workEnd: 15, workDays: '1,2,3,4,5' }).expect(201)).body.id;
      person = (await post(adm, '/api/scheduling/resources', { name: 'Dewi (lanjutan)', kind: 'PERSON', employeeId: empA }).expect(201)).body.id;
      const res = (await get(staff, '/api/scheduling/resources').expect(200)).body.find((r: { id: string }) => r.id === room);
      expect(res).toMatchObject({ workStart: 9, workEnd: 15, workDays: '1,2,3,4,5' });
      // mengubah status aktif tanpa mengirim jam kerja tidak boleh mengembalikan jam ke bawaan
      await put(adm, `/api/scheduling/resources/${room}`, { name: 'Ruang Sempit', kind: 'ROOM', isActive: true }).expect(200);
      expect((await get(staff, '/api/scheduling/resources').expect(200)).body.find((r: { id: string }) => r.id === room)).toMatchObject({ workStart: 9, workEnd: 15, workDays: '1,2,3,4,5' });
      // Senin–Minggu: hanya Senin–Jumat; jam 09–15
      const slots = (await get(staff, `/api/scheduling/free-slots?resourceId=${room}&from=${mon}&to=${addDays(mon, 6)}&minutes=60`).expect(200)).body as { date: string; startsAt: string; endsAt: string }[];
      expect(new Set(slots.map((s) => s.date)).size).toBe(5);
      const hm = (s: string) => new Date(s).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
      expect(slots.filter((s) => s.date === mon).map((s) => `${hm(s.startsAt)}-${hm(s.endsAt)}`)).toEqual(['09:00-15:00']);
      // pemesanan di luar jam kerja ditandai (tidak diblokir); di dalam jam tidak
      const inside = (await book(room, at(mon, 10), at(mon, 11)).expect(201)).body;
      const outside = (await book(room, at(mon, 7), at(mon, 8)).expect(201)).body;
      expect(inside.offHours).toBe(false);
      expect(outside.offHours).toBe(true);
      const sat = (await book(room, at(addDays(mon, 5), 10), at(addDays(mon, 5), 11)).expect(201)).body; // Sabtu: bukan hari kerja ruang ini
      expect(sat.offHours).toBe(true);
      const ctl = (await get(fin, '/api/scheduling/controls').expect(200)).body;
      expect(ctl.offHours.length).toBeGreaterThanOrEqual(2);
    });

    it('cuti disetujui memblokir pemesanan orang dan slot kosong; cuti menunggu tidak', async () => {
      const d = addDays(mon, 1); // Selasa
      await db.execute(sql`INSERT INTO leave_requests (tenant_id, employee_id, type, start_date, end_date, days, status) SELECT tenant_id, id, 'ANNUAL', ${d}, ${d}, 1, 'APPROVED' FROM employees WHERE id = ${empA}`);
      const w = addDays(mon, 2);
      await db.execute(sql`INSERT INTO leave_requests (tenant_id, employee_id, type, start_date, end_date, days, status) SELECT tenant_id, id, 'ANNUAL', ${w}, ${w}, 1, 'PENDING' FROM employees WHERE id = ${empA}`);
      const blocked = await book(person, at(d, 9), at(d, 10));
      expect(blocked.status).toBe(409);
      expect(blocked.body.leaves[0]).toMatchObject({ type: 'ANNUAL' });
      await book(person, at(w, 9), at(w, 10)).expect(201); // cuti baru diajukan: belum memblokir
      const slots = (await get(staff, `/api/scheduling/free-slots?resourceId=${person}&from=${mon}&to=${addDays(mon, 3)}&minutes=60`).expect(200)).body as { date: string }[];
      expect(slots.some((s) => s.date === d)).toBe(false); // hari cuti dilewati
      expect(slots.some((s) => s.date === mon)).toBe(true);
      // memindahkan ke hari cuti juga ditolak
      const b = (await book(person, at(mon, 9), at(mon, 10)).expect(201)).body;
      expect((await put(fin, `/api/scheduling/bookings/${b.id}`, { startsAt: at(d, 9), endsAt: at(d, 10) })).status).toBe(409);
      // ruang tidak terkait karyawan: cuti tidak relevan
      await book(room, at(d, 10), at(d, 11)).expect(201);
    });

    it('jadwal berulang: semua-atau-tidak-sama-sekali, seri dapat dibatalkan', async () => {
      const base = { resourceId: room, title: 'Sesi mingguan', startsAt: at(addDays(mon, 14), 12), endsAt: at(addDays(mon, 14), 13), customerId: cust };
      expect((await post(fin, '/api/scheduling/bookings/recurring', { ...base, repeat: 'WEEKLY', count: 1 })).status).toBe(400);
      expect((await post(fin, '/api/scheduling/bookings/recurring', { ...base, repeat: 'WEEKLY', count: 27 })).status).toBe(400);
      expect((await post(fin, '/api/scheduling/bookings/recurring', { ...base, repeat: 'MONTHLY', count: 3 })).status).toBe(400);
      expect((await post(acct, '/api/scheduling/bookings/recurring', { ...base, repeat: 'WEEKLY', count: 3 })).status).toBe(403);
      // kejadian ke-3 (mon+28 jam 12–13) sudah terisi → tidak ada yang dibuat
      await book(room, at(addDays(mon, 28), 12, 30), at(addDays(mon, 28), 13, 30)).expect(201);
      const before = (await list(room)).length;
      const bad = await post(fin, '/api/scheduling/bookings/recurring', { ...base, repeat: 'WEEKLY', count: 4 });
      expect(bad.status).toBe(409);
      expect(bad.body.occurrences.map((o: { index: number }) => o.index)).toEqual([3]);
      expect((await list(room)).length).toBe(before);
      // tanpa bentrok: terbuat semua dengan satu seri
      const ok = (await post(fin, '/api/scheduling/bookings/recurring', { ...base, repeat: 'WEEKLY', count: 2, title: 'Sesi A' }).expect(201)).body;
      expect(ok.count).toBe(2);
      const series = (await post(fin, '/api/scheduling/bookings/recurring', { ...base, startsAt: at(addDays(mon, 35), 9), endsAt: at(addDays(mon, 35), 10), repeat: 'WEEKLY', count: 4, title: 'Sesi B' }).expect(201)).body;
      expect(new Set(series.bookings.map((x: { seriesId: string }) => x.seriesId)).size).toBe(1);
      // batalkan dari kejadian ke-2: kejadian 1 tetap, 2–4 batal
      const second = series.bookings[1].id;
      expect((await post(fin, `/api/scheduling/bookings/${second}/cancel-series`, { reason: 'x' })).status).toBe(400); // alasan terlalu pendek
      expect((await post(fin, `/api/scheduling/bookings/${second}/cancel-series`, { reason: 'Klien menunda proyek' }).expect(201)).body.cancelled).toBe(3);
      const after = (await list(room)).filter((x) => x.seriesId === series.seriesId);
      expect(after.map((x) => x.status)).toEqual(['BOOKED', 'CANCELLED', 'CANCELLED', 'CANCELLED']);
      // bukan seri
      const single = (await list(room))[0];
      expect((await post(fin, `/api/scheduling/bookings/${single.id}/cancel-series`, { reason: 'Tidak ada seri' })).status).toBe(400);
      // pemesanan bersamaan pada slot yang sama: hanya satu yang lolos
      const racing = await Promise.all([1, 2].map(() => post(fin, '/api/scheduling/bookings/recurring', { ...base, startsAt: at(addDays(mon, 50), 10), endsAt: at(addDays(mon, 50), 11), repeat: 'DAILY', count: 3, title: 'Balapan' })));
      expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe('timer jam kerja', () => {
    const timer = (t: string) => get(t, '/api/timesheets/timer');
    it('mulai → berjalan → hentikan menjadi draf catatan waktu (jam dibulatkan ke atas, tidak diketik)', async () => {
      expect((await timer(staff)).body).toEqual({}); // belum ada
      expect((await post(staff, '/api/timesheets/timer/start', { description: 'ab', customerId: cust })).status).toBe(400); // uraian pendek
      expect((await post(staff, '/api/timesheets/timer/start', { description: 'Analisis laporan', customerId: cust, employeeId: empB })).status).toBe(403); // untuk orang lain
      await post(staff, '/api/timesheets/timer/start', { description: 'Analisis laporan', customerId: cust }).expect(201);
      expect((await post(staff, '/api/timesheets/timer/start', { description: 'Lagi', customerId: cust })).status).toBe(400); // satu timer per karyawan
      expect((await timer(staff)).body).toMatchObject({ description: 'Analisis laporan', employeeId: empA });
      // geser waktu mulai 100 menit ke belakang → dibulatkan ke 1,75 jam
      await db.execute(sql`UPDATE time_timers SET started_at = now() - interval '100 minutes' WHERE employee_id = ${empA}`);
      const e = (await post(staff, '/api/timesheets/timer/stop').expect(201)).body;
      expect(Number(e.hours)).toBe(1.75);
      expect(e.status).toBe('DRAFT');
      expect((await post(staff, '/api/timesheets/timer/stop')).status).toBe(400); // sudah berhenti
      expect((await timer(staff)).body).toEqual({});
      // Admin boleh menjalankan untuk karyawan lain; staf lain tidak bisa menghentikannya
      await post(adm, '/api/timesheets/timer/start', { description: 'Bantu rekan', customerId: cust, employeeId: empB }).expect(201);
      expect((await post(staff, '/api/timesheets/timer/stop', { employeeId: empB })).status).toBe(403);
      await post(adm, '/api/timesheets/timer/stop', { employeeId: empB }).expect(201);
    });

    it('timer terlalu lama ditolak (tidak hilang); buang wajib alasan; gagal catat tidak menghilangkan timer', async () => {
      await post(staff2, '/api/timesheets/timer/start', { description: 'Lupa menghentikan', customerId: cust }).expect(201);
      await db.execute(sql`UPDATE time_timers SET started_at = now() - interval '20 hours' WHERE employee_id = ${empB}`);
      expect((await post(staff2, '/api/timesheets/timer/stop')).status).toBe(400);
      expect((await timer(staff2)).body).toMatchObject({ description: 'Lupa menghentikan' }); // tetap ada
      expect((await post(staff2, '/api/timesheets/timer/discard', { reason: 'x' })).status).toBe(400);
      await post(staff2, '/api/timesheets/timer/discard', { reason: 'Lupa menghentikan, dicatat manual' }).expect(201);
      expect((await timer(staff2)).body).toEqual({});
      // hari penuh 16 jam: menghentikan timer ditolak, timer dikembalikan
      await post(staff2, '/api/timesheets/timer/start', { description: 'Setelah hari penuh', customerId: cust }).expect(201);
      await post(adm, '/api/timesheets/entries', { employeeId: empB, workDate: todayJakarta(), hours: '15.75', description: 'Hari penuh', customerId: cust }).expect(201);
      expect((await post(staff2, '/api/timesheets/timer/stop')).status).toBe(400);
      expect((await timer(staff2)).body).toMatchObject({ description: 'Setelah hari penuh' });
    });
  });

  describe('retainer bulanan', () => {
    const ym = (d: string) => d.slice(0, 7);
    const start = `${ym(addDays(today, -62))}-01`; // ±2–3 bulan lalu
    let rid = '';
    it('buat: Admin/Keuangan saja; validasi; periode terlewat tampil sebagai belum ditagih', async () => {
      const body = { customerId: cust, title: 'Retainer konsultasi pajak', monthlyFee: '5000000', startDate: start };
      expect((await post(staff, '/api/retainers', body)).status).toBe(403);
      expect((await post(acct, '/api/retainers', body)).status).toBe(403);
      expect((await post(fin, '/api/retainers', { ...body, monthlyFee: '0' })).status).toBe(400);
      expect((await post(fin, '/api/retainers', { ...body, endDate: addDays(start, -1) })).status).toBe(400);
      rid = (await post(fin, '/api/retainers', body).expect(201)).body.id;
      const row = (await get(acct, '/api/retainers').expect(200)).body.find((r: { id: string }) => r.id === rid);
      expect(row.unbilledPeriods.length).toBeGreaterThanOrEqual(3);
      expect(row.unbilledPeriods[row.unbilledPeriods.length - 1]).toBe(ym(today));
    });

    it('tagih: satu faktur per periode, bukan masa depan, bukan sebelum mulai; dua penagihan bersamaan hanya satu', async () => {
      const first = row0(start);
      const inv = (await post(fin, `/api/retainers/${rid}/bill`, { period: first }).expect(201)).body;
      expect(inv.number).toBeTruthy();
      const detail = (await get(fin, `/api/invoices/${inv.id}`).expect(200)).body;
      expect(Number(detail.subtotal)).toBe(5000000);
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: first })).status).toBe(400); // sudah
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: ym(addDays(today, 40)) })).status).toBe(400); // masa depan
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: ym(addDays(start, -40)) })).status).toBe(400); // sebelum mulai
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: '2026-13' })).status).toBe(400);
      expect((await post(staff, `/api/retainers/${rid}/bill`, { period: ym(today) })).status).toBe(403);
      const cur = ym(today);
      const race = await Promise.all([1, 2].map(() => post(fin, `/api/retainers/${rid}/bill`, { period: cur })));
      expect(race.filter((r) => r.status === 201)).toHaveLength(1);
      expect(race.find((r) => r.status !== 201)?.status).toBeGreaterThanOrEqual(400);
      // tidak ada faktur yatim: jumlah faktur retainer = jumlah periode tercatat
      const cnt = (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM invoices WHERE customer_id = ${cust} AND description LIKE 'Retainer konsultasi pajak%'`)).rows[0].n;
      const rec = (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM service_retainer_invoices WHERE retainer_id = ${rid}`)).rows[0].n;
      expect(cnt).toBe(rec);
      expect(rec).toBe(2);
    });

    it('ubah biaya: hanya Admin dengan alasan, berlaku untuk periode berikutnya; nonaktif tidak bisa ditagih', async () => {
      expect((await put(fin, `/api/retainers/${rid}`, { monthlyFee: '6000000', reason: 'Naik tarif' })).status).toBe(403);
      expect((await put(adm, `/api/retainers/${rid}`, { monthlyFee: '6000000' })).status).toBe(400); // tanpa alasan
      await put(adm, `/api/retainers/${rid}`, { monthlyFee: '6000000', reason: 'Penyesuaian tarif tahunan' }).expect(200);
      const next = (await get(fin, '/api/retainers').expect(200)).body.find((r: { id: string }) => r.id === rid).unbilledPeriods[0] as string;
      const inv = (await post(fin, `/api/retainers/${rid}/bill`, { period: next }).expect(201)).body;
      expect(Number((await get(fin, `/api/invoices/${inv.id}`).expect(200)).body.subtotal)).toBe(6000000);
      await put(adm, `/api/retainers/${rid}`, { isActive: false, reason: 'Kontrak berakhir' }).expect(200);
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: ym(today) })).status).toBe(400);
    });

    it('isolasi: perusahaan lain tidak melihat retainer', async () => {
      const other = (await http.post('/api/auth/register').send({ companyName: 'Jasa Lain', name: 'Lain', email: `jl-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
      expect((await get(other, '/api/retainers').expect(200)).body).toHaveLength(0);
      expect((await post(other, `/api/retainers/${rid}/bill`, { period: ym(start) })).status).toBe(404);
    });
    const row0 = (s: string) => ym(s);
  });

  describe('retainer berjatah jam', () => {
    let c2 = ''; let rid = ''; const ids: string[] = [];
    const cur = today.slice(0, 7);
    it('jam termasuk wajib disertai tarif kelebihan', async () => {
      c2 = (await post(owner, '/api/customers', { code: 'JL2', name: 'PT Klien Berjatah', paymentTermDays: 14 }).expect(201)).body.id;
      const body = { customerId: c2, title: 'Retainer berjatah', monthlyFee: '4000000', startDate: `${cur}-01`, includedHours: '10' };
      expect((await post(fin, '/api/retainers', body)).status).toBe(400);
      rid = (await post(fin, '/api/retainers', { ...body, overageRate: '300000' }).expect(201)).body.id;
      const row = (await get(fin, '/api/retainers').expect(200)).body.find((r: { id: string }) => r.id === rid);
      expect(Number(row.includedHours)).toBe(10);
    });

    it('catatan waktu yang belum disetujui menahan penagihan', async () => {
      for (const h of ['6', '7']) ids.push((await post(adm, '/api/timesheets/entries', { employeeId: empA, workDate: `${cur}-01`, hours: h, description: 'Pendampingan', customerId: c2 }).expect(201)).body.id);
      expect((await post(fin, `/api/retainers/${rid}/bill`, { period: cur })).status).toBe(400);
    });

    it('hanya kelebihan jam yang ditagih tambahan, dan jam tercakup tidak dapat ditagih ulang lewat timesheet', async () => {
      await post(fin, '/api/timesheets/rates', { rate: '250000', validFrom: '2025-01-01' }).expect(201);
      await post(adm, '/api/timesheets/submit', { ids }).expect(201);
      for (const id of ids) await post(fin, `/api/timesheets/entries/${id}/approve`).expect(201);
      const inv = (await post(fin, `/api/retainers/${rid}/bill`, { period: cur }).expect(201)).body;
      const detail = (await get(fin, `/api/invoices/${inv.id}`).expect(200)).body;
      // 13 jam terpakai dari jatah 10: kelebihan 3 jam × 300.000 = 900.000, di atas biaya bulanan 4.000.000
      expect(Number(detail.subtotal)).toBe(4900000);
      const st = await db.execute<{ status: string; invoice_id: string }>(sql`SELECT status, invoice_id FROM time_entries WHERE customer_id = ${c2}`);
      expect(st.rows.every((r) => r.status === 'BILLED' && r.invoice_id === inv.id)).toBe(true);
    });
  });

  describe('anggaran biaya proyek', () => {
    it('anggaran dipantau terhadap biaya langsung; negatif ditolak', async () => {
      const p = (await post(fin, '/api/services/projects', { name: 'Proyek beranggaran', customerId: cust, contractValue: '20000000', costBudget: '1000000' }).expect(201)).body;
      expect(p.costBudget).toBe('1000000.00');
      expect(p.budget).toMatchObject({ status: 'OK', usedPct: 0 });
      expect((await post(fin, '/api/services/projects', { name: 'Proyek negatif', customerId: cust, contractValue: '1', costBudget: '-5' })).status).toBe(400);
      const upd = (await http.patch(`/api/services/projects/${p.id}`).set(as(fin)).send({ costBudget: '0' }).expect(200)).body;
      expect(upd.budget.status).toBe('NONE');
    });
  });
});
