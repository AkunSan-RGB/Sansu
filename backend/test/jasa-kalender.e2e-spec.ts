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

describe('Tautan kalender jadwal Jasa (e2e)', () => {
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
    const r = (await post(owner, '/api/users', { name: n, email: `kal-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201)).body;
    return { token: await login(`kal-${n}-${stamp}@uji.id`), id: r.id as string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Konsultan Kalender', name: 'Pemilik', email: `kal-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
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

  describe('tautan iCal', () => {
    const mon = nextMonday(today);
    const at = (d: string, h: number) => `${d}T${String(h).padStart(2, '0')}:00:00+07:00`;
    let r1 = ''; let r2 = ''; let token = ''; let feedId = ''; let path = '';
    it('hanya Admin yang membuat/mencabut; token tampil sekali dan tidak tersimpan polos', async () => {
      r1 = (await post(owner, '/api/scheduling/resources', { name: 'Dewi', kind: 'PERSON' }).expect(201)).body.id;
      r2 = (await post(owner, '/api/scheduling/resources', { name: 'Ruang B', kind: 'ROOM' }).expect(201)).body.id;
      await post(fin, '/api/scheduling/bookings', { resourceId: r1, title: 'Sesi Dewi', startsAt: at(mon, 9), endsAt: at(mon, 10), customerId: cust }).expect(201);
      await post(fin, '/api/scheduling/bookings', { resourceId: r2, title: 'Rapat; "ruang", B', startsAt: at(mon, 11), endsAt: at(mon, 12), customerId: cust }).expect(201);
      const dead = (await post(fin, '/api/scheduling/bookings', { resourceId: r2, title: 'Batal', startsAt: at(mon, 13), endsAt: at(mon, 14) }).expect(201)).body.id;
      await post(fin, `/api/scheduling/bookings/${dead}/cancel`, { reason: 'klien batal' }).expect(201);
      expect((await post(fin, '/api/scheduling/feeds', { name: 'Tim' })).status).toBe(403);
      expect((await post(staff, '/api/scheduling/feeds', { name: 'Tim' })).status).toBe(403);
      expect((await post(owner, '/api/scheduling/feeds', { name: 'x' })).status).toBe(400);
      expect((await post(owner, '/api/scheduling/feeds', { name: 'Tim', resourceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      const f = (await post(owner, '/api/scheduling/feeds', { name: 'Kalender tim' }).expect(201)).body;
      token = f.token; feedId = f.id; path = f.path;
      expect(token).toMatch(/^cal_/);
      const stored = (await db.execute(sql`SELECT token_hash FROM scheduling_feeds WHERE id = ${feedId}`)).rows[0] as { token_hash: string };
      expect(stored.token_hash).not.toContain(token);
      const list = (await get(owner, '/api/scheduling/feeds').expect(200)).body as Record<string, unknown>[];
      expect(JSON.stringify(list)).not.toContain(token);
    });
    it('tanpa login: isi kalender benar, tanpa nama pelanggan dan tanpa pemesanan batal', async () => {
      const res = await http.get(path).expect(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.headers['cache-control']).toContain('no-store');
      const t = res.text;
      expect(t.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(t).toContain('SUMMARY:Sesi Dewi (Dewi)');
      expect(t).toContain('SUMMARY:Rapat\\; "ruang"\\, B (Ruang B)');
      expect(t).not.toContain('Batal');
      expect(t).not.toContain('PT Klien');
      expect(t).toContain(`DTSTART:${new Date(at(mon, 9)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
      expect(t.split('BEGIN:VEVENT').length - 1).toBe(2);
      for (const line of t.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    });
    it('tautan per sumber daya hanya memuat sumber daya itu', async () => {
      const f = (await post(owner, '/api/scheduling/feeds', { name: 'Dewi saja', resourceId: r1 }).expect(201)).body;
      const t = (await http.get(f.path).expect(200)).text;
      expect(t).toContain('Sesi Dewi');
      expect(t).not.toContain('Rapat');
    });
    it('token salah/rusak → 404; dicabut → 404; jejak audit ada', async () => {
      expect((await http.get('/api/calendar/cal_salahsalahsalahsalahsalah.ics')).status).toBe(404);
      expect((await http.get('/api/calendar/abc.ics')).status).toBe(404);
      expect((await post(fin, `/api/scheduling/feeds/${feedId}/revoke`)).status).toBe(403);
      await post(owner, `/api/scheduling/feeds/${feedId}/revoke`).expect(201);
      expect((await http.get(path)).status).toBe(404);
      expect((await post(owner, `/api/scheduling/feeds/${feedId}/revoke`)).status).toBe(404);
      const a = (await db.execute(sql`SELECT action FROM audit_logs WHERE entity = 'SchedulingFeed' AND entity_id = ${feedId} ORDER BY created_at`)).rows.map((x) => (x as { action: string }).action);
      expect(a).toEqual(['CREATE', 'REVOKE']);
    });
    it('isolasi: perusahaan lain tidak melihat/mencabut tautan', async () => {
      const other = (await http.post('/api/auth/register').send({ companyName: 'Jasa Lain', name: 'Lain', email: `kal-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
      expect((await get(other, '/api/scheduling/feeds').expect(200)).body).toHaveLength(0);
      expect((await post(other, `/api/scheduling/feeds/${feedId}/revoke`)).status).toBe(404);
    });
  });
});
