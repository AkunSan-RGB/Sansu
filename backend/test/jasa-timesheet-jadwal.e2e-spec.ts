/**
 * Jasa: lembar waktu yang dapat ditagih (tarif, persetujuan, penagihan atomik, kontrol) dan penjadwalan sumber daya
 * (bentrok ditolak, termasuk saat pemesanan bersamaan).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Jasa: lembar waktu + penjadwalan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner = ''; let fin = ''; let adm = ''; let staff = ''; let staff2 = ''; let acct = ''; let other = '';
  let empA = ''; let empB = ''; let cust = ''; let cust2 = ''; let proj = '';
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    const r = (await post(owner, '/api/users', { name: n, email: `js-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201)).body;
    return { token: await login(`js-${n}-${stamp}@uji.id`), id: r.id as string };
  };
  const entry = (t: string, b: object) => post(t, '/api/timesheets/entries', { workDate: today, hours: '2', description: 'Konsultasi', customerId: cust, ...b });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Konsultan Waktu', name: 'Pemilik', email: `js-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/payroll/install').expect(201); // SDM (karyawan) dibutuhkan lembar waktu
    const f = await mk('FINANCE', 'fin'); fin = f.token;
    const a = await mk('ADMIN', 'adm'); adm = a.token;
    const s1 = await mk('SALES', 'staf1'); staff = s1.token;
    const s2 = await mk('SALES', 'staf2'); staff2 = s2.token;
    acct = (await mk('ACCOUNTANT', 'akt')).token;
    const mkEmp = async (code: string, name: string, userId?: string) => {
      const id = (await post(owner, '/api/hr/employees', { code, name, ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000' }).expect(201)).body.id as string;
      if (userId) await db.execute(sql`UPDATE employees SET user_id = ${userId} WHERE id = ${id}`);
      return id;
    };
    empA = await mkEmp('E-A', 'Dewi Konsultan', s1.id);
    empB = await mkEmp('E-B', 'Eko Analis', s2.id);
    cust = (await post(owner, '/api/customers', { code: 'JS1', name: 'PT Klien Satu', paymentTermDays: 14 }).expect(201)).body.id;
    cust2 = (await post(owner, '/api/customers', { code: 'JS2', name: 'PT Klien Dua' }).expect(201)).body.id;
    proj = (await post(owner, '/api/services/projects', { name: 'Audit Sistem', customerId: cust, contractValue: '0' }).expect(201)).body.id;
    other = (await http.post('/api/auth/register').send({ companyName: 'Jasa Lain', name: 'Lain', email: `js-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  describe('lembar waktu', () => {
    let noRate = '';
    it('pencatatan: hanya diri sendiri, batas jam, tanggal, batas harian', async () => {
      // sebelum ada tarif: tercatat tanpa tarif
      const e0 = await entry(staff, { hours: '1' }).expect(201);
      noRate = e0.body.id;
      expect(e0.body.rate).toBeNull();
      expect((await entry(staff, { employeeId: empB, hours: '1' })).status).toBe(403); // untuk orang lain
      expect((await entry(staff, { hours: '0' })).status).toBe(400);
      expect((await entry(staff, { hours: '17' })).status).toBe(400);
      expect((await entry(staff, { hours: '1.234' })).status).toBe(400);
      expect((await entry(staff, { workDate: addDays(today, 1) })).status).toBe(400); // masa depan
      expect((await entry(staff, { workDate: addDays(today, -40) })).status).toBe(403); // mundur > 31 hari
      expect((await entry(adm, { employeeId: empA, workDate: addDays(today, -40), hours: '1', description: 'Koreksi catatan lama' })).status).toBe(201); // Admin boleh
      expect((await entry(staff, { projectId: proj, customerId: cust2 })).status).toBe(400); // proyek milik pelanggan lain
      expect((await post(staff, '/api/timesheets/entries', { workDate: today, hours: '1', description: 'Tanpa klien' })).status).toBe(400);
      // batas 16 jam per hari: sudah 1 jam hari ini → 15 jam boleh, 16 tidak
      expect((await entry(staff, { hours: '16' })).status).toBe(400);
      const day = await entry(staff, { hours: '14', description: 'Lembur proyek' }).expect(201);
      expect((await entry(staff, { hours: '2' })).status).toBe(400); // 1 + 14 + 2 = 17
      await post(staff, `/api/timesheets/entries/${day.body.id}/approve`).expect(403);
      // akun yang tidak terhubung ke karyawan tidak bisa mencatat untuk diri sendiri
      expect((await entry(fin, { hours: '1' })).status).toBe(400);
    });

    it('tarif: paling spesifik menang; tidak bisa disetujui tanpa tarif; Keuangan membuat tarif, Staf tidak', async () => {
      await post(fin, `/api/timesheets/entries/${noRate}/approve`).expect(400); // belum diajukan
      await post(staff, '/api/timesheets/submit', { ids: [noRate] }).expect(201);
      await post(adm, `/api/timesheets/entries/${noRate}/approve`).expect(400); // belum ada tarif
      await post(staff, '/api/timesheets/rates', { rate: '100000', validFrom: '2025-01-01' }).expect(403);
      await post(fin, '/api/timesheets/rates', { rate: '300000', validFrom: '2025-01-01' }).expect(201); // umum
      await post(fin, '/api/timesheets/rates', { employeeId: empA, rate: '450000', validFrom: '2025-01-01' }).expect(201);
      await post(fin, '/api/timesheets/rates', { projectId: proj, rate: '400000', validFrom: '2025-01-01' }).expect(201);
      await post(fin, '/api/timesheets/rates', { projectId: proj, employeeId: empA, rate: '500000', validFrom: '2025-01-01' }).expect(201);
      await post(fin, '/api/timesheets/rates', { rate: '0', validFrom: '2025-01-01' }).expect(400);
      const a = (await entry(staff2, { workDate: addDays(today, -1), hours: '1' }).expect(201)).body; // Eko, tanpa proyek → umum
      const b = (await entry(staff, { workDate: addDays(today, -1), hours: '1' }).expect(201)).body; // Dewi, tanpa proyek → tarif karyawan
      const c = (await entry(staff2, { workDate: addDays(today, -2), hours: '1', projectId: proj }).expect(201)).body; // Eko, proyek → tarif proyek
      const d = (await entry(staff, { workDate: addDays(today, -2), hours: '1', projectId: proj }).expect(201)).body; // Dewi, proyek → proyek+karyawan
      expect([a.rate, b.rate, c.rate, d.rate].map(Number)).toEqual([300000, 450000, 400000, 500000]);
      // catatan lama yang belum bertarif memakai tarif saat disetujui
      const ok = (await post(fin, `/api/timesheets/entries/${noRate}/approve`).expect(201)).body;
      expect(Number(ok.rate)).toBe(450000);
    });

    it('persetujuan: bukan pencatat/karyawannya sendiri; ubah tarif hanya Admin dengan alasan', async () => {
      const own = (await entry(staff, { workDate: addDays(today, -3), hours: '2', description: 'Workshop' }).expect(201)).body;
      await post(staff, '/api/timesheets/submit', { ids: [own.id] }).expect(201);
      await post(staff2, '/api/timesheets/submit', { ids: [own.id] }).expect(403); // milik orang lain
      await post(staff, `/api/timesheets/entries/${own.id}/approve`).expect(403); // staf tidak berwenang
      await put(staff, `/api/timesheets/entries/${own.id}`, { hours: '1' }).expect(400); // sudah diajukan
      await post(fin, `/api/timesheets/entries/${own.id}/approve`, { rate: '600000', rateNote: 'Tarif khusus' }).expect(403); // Keuangan tidak boleh ubah tarif
      await post(adm, `/api/timesheets/entries/${own.id}/approve`, { rate: '600000' }).expect(400); // tanpa alasan
      const ok = (await post(adm, `/api/timesheets/entries/${own.id}/approve`, { rate: '600000', rateNote: 'Tarif khusus workshop' }).expect(201)).body;
      expect(Number(ok.rate)).toBe(600000);
      await post(fin, `/api/timesheets/entries/${own.id}/approve`).expect(400); // sudah diputuskan
      // ditolak lalu diperbaiki dan diajukan ulang
      const rej = (await entry(staff2, { workDate: addDays(today, -4), hours: '3', description: 'Rapat' }).expect(201)).body;
      await post(staff2, '/api/timesheets/submit', { ids: [rej.id] }).expect(201);
      await post(fin, `/api/timesheets/entries/${rej.id}/reject`, { reason: 'x' }).expect(400);
      await post(fin, `/api/timesheets/entries/${rej.id}/reject`, { reason: 'Deskripsi kurang jelas' }).expect(201);
      await put(staff2, `/api/timesheets/entries/${rej.id}`, { description: 'Rapat koordinasi dengan klien', hours: '2.5' }).expect(200);
      await post(staff2, '/api/timesheets/submit', { ids: [rej.id] }).expect(201);
      await post(fin, `/api/timesheets/entries/${rej.id}/approve`).expect(201);
    });

    let billIds: string[] = [];
    it('penagihan: faktur jasa jam × tarif, catatan menjadi tertagih satu transaksi; tidak bisa dua kali; campur pelanggan ditolak', async () => {
      const approved = (await get(fin, '/api/timesheets/entries?status=APPROVED').expect(200)).body as { id: string; customerId: string; hours: string; rate: string; projectId: string | null }[];
      const noProj = approved.filter((x) => !x.projectId);
      expect(noProj.length).toBeGreaterThanOrEqual(3);
      billIds = noProj.map((x) => x.id);
      const other2 = (await entry(adm, { employeeId: empB, customerId: cust2, workDate: addDays(today, -5), hours: '1', description: 'Klien lain' }).expect(201)).body;
      await post(adm, '/api/timesheets/submit', { ids: [other2.id] }).expect(201);
      await post(fin, `/api/timesheets/entries/${other2.id}/approve`).expect(201);
      await post(fin, '/api/timesheets/bill', { customerId: cust, entryIds: [...billIds, other2.id] }).expect(400); // pelanggan berbeda
      const pe = (await entry(adm, { employeeId: empB, projectId: proj, workDate: addDays(today, -5), hours: '1', description: 'Proyek audit' }).expect(201)).body;
      await post(adm, '/api/timesheets/submit', { ids: [pe.id] }).expect(201);
      await post(fin, `/api/timesheets/entries/${pe.id}/approve`).expect(201);
      const mixedProj = pe.id as string;
      await post(fin, '/api/timesheets/bill', { customerId: cust, entryIds: [billIds[0], mixedProj] }).expect(400); // proyek campur
      await post(staff, '/api/timesheets/bill', { customerId: cust, entryIds: billIds }).expect(403);
      await post(acct, '/api/timesheets/bill', { customerId: cust, entryIds: billIds }).expect(403);
      const expected = noProj.reduce((a, x) => a + Number(x.hours) * Number(x.rate), 0);
      const inv = (await post(fin, '/api/timesheets/bill', { customerId: cust, entryIds: billIds, withVat: false }).expect(201)).body;
      expect(inv.entries).toBe(billIds.length);
      expect(Number(inv.amount)).toBe(expected);
      const invoice = (await get(owner, `/api/invoices/${inv.id}`).expect(200)).body;
      expect(Number(invoice.subtotal)).toBe(expected);
      const billed = (await get(fin, '/api/timesheets/entries?status=BILLED').expect(200)).body as { invoiceId: string }[];
      expect(billed.every((b) => b.invoiceId === inv.id)).toBe(true);
      expect(billed.length).toBe(billIds.length);
      await post(fin, '/api/timesheets/bill', { customerId: cust, entryIds: billIds }).expect(400); // sudah tertagih
      await put(staff, `/api/timesheets/entries/${billIds[0]}`, { hours: '1' }).expect(400); // tertagih tidak bisa diubah
      const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
      expect(tb.balanced).toBe(true);
    });

    it('penagihan bersamaan: hanya satu yang berhasil, tidak ada faktur ganda', async () => {
      const ids: string[] = [];
      for (const h of ['1', '1.5']) {
        const e = (await entry(adm, { employeeId: empB, workDate: addDays(today, -6), hours: h, description: `Balapan ${h}` }).expect(201)).body;
        await post(adm, '/api/timesheets/submit', { ids: [e.id] }).expect(201);
        await post(fin, `/api/timesheets/entries/${e.id}/approve`).expect(201);
        ids.push(e.id);
      }
      const before = (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM invoices WHERE kind = 'SERVICE'`)).rows[0].n;
      const rs = await Promise.all([1, 2, 3].map(() => post(fin, '/api/timesheets/bill', { customerId: cust, entryIds: ids, withVat: false })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      const after = (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM invoices WHERE kind = 'SERVICE'`)).rows[0].n;
      expect(after).toBe(before + 1);
    });

    it('hapus-tagih: hanya Admin dengan alasan, hanya yang disetujui belum tertagih', async () => {
      const e = (await entry(staff, { workDate: addDays(today, -7), hours: '1', description: 'Tidak jadi ditagih' }).expect(201)).body;
      await post(staff, '/api/timesheets/submit', { ids: [e.id] }).expect(201);
      await post(fin, `/api/timesheets/entries/${e.id}/approve`).expect(201);
      await post(fin, `/api/timesheets/entries/${e.id}/write-off`, { reason: 'Kebijakan niat baik' }).expect(403);
      await post(adm, `/api/timesheets/entries/${e.id}/write-off`, { reason: 'x' }).expect(400);
      await post(adm, `/api/timesheets/entries/${e.id}/write-off`, { reason: 'Gratis sebagai niat baik' }).expect(201);
      await post(adm, `/api/timesheets/entries/${billIds[0]}/write-off`, { reason: 'Sudah ditagih' }).expect(400);
    });

    it('kontrol dan laporan; visibilitas staf hanya catatan sendiri; isolasi antar perusahaan', async () => {
      await db.execute(sql`UPDATE time_entries SET decided_at = now() - interval '40 days' WHERE status = 'APPROVED'`);
      const p = (await entry(staff2, { workDate: addDays(today, -8), hours: '1', description: 'Menunggu lama' }).expect(201)).body;
      await post(staff2, '/api/timesheets/submit', { ids: [p.id] }).expect(201);
      await db.execute(sql`UPDATE time_entries SET submitted_at = now() - interval '5 days' WHERE id = ${p.id}`);
      const c = (await get(acct, '/api/timesheets/controls').expect(200)).body;
      expect(c.approvedUnbilledOver30Days.length).toBeGreaterThanOrEqual(1);
      expect(c.submittedOver3Days.length).toBeGreaterThanOrEqual(1);
      expect(c.rateOverrides.length).toBeGreaterThanOrEqual(1);
      expect(c.writtenOff.length).toBeGreaterThanOrEqual(1);
      expect(c.longDays.length).toBeGreaterThanOrEqual(1); // 1 + 14 jam hari ini
      const u = (await get(acct, '/api/timesheets/utilization').expect(200)).body;
      expect(u.rows.length).toBeGreaterThanOrEqual(2);
      const mine = (await get(staff, '/api/timesheets/entries').expect(200)).body as { employeeId: string }[];
      expect(mine.every((x) => x.employeeId === empA)).toBe(true);
      expect((await get(other, '/api/timesheets/entries').expect(200)).body).toHaveLength(0);
      expect((await get(other, '/api/timesheets/rates').expect(200)).body).toHaveLength(0);
      const un = (await get(fin, '/api/timesheets/unbilled').expect(200)).body as { customerName: string }[];
      expect(un.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('penjadwalan', () => {
    let room = ''; let person = ''; let b1 = '';
    // hari kerja bawaan sumber daya Senin–Sabtu: hindari Minggu agar slot kosong tidak bergantung pada tanggal tes dijalankan
    const day = new Date(`${addDays(today, 3)}T12:00:00+07:00`).getUTCDay() === 0 ? addDays(today, 4) : addDays(today, 3);
    const at =(h: number, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
    const book = (t: string, rid: string, s: string, e: string, extra: object = {}) => post(t, '/api/scheduling/bookings', { resourceId: rid, title: 'Rapat klien', startsAt: s, endsAt: e, ...extra });

    it('sumber daya: hanya Admin; nama unik; orang dapat dikaitkan ke karyawan', async () => {
      await post(fin, '/api/scheduling/resources', { name: 'Ruang A', kind: 'ROOM' }).expect(403);
      room = (await post(adm, '/api/scheduling/resources', { name: 'Ruang Rapat A', kind: 'ROOM' }).expect(201)).body.id;
      await post(adm, '/api/scheduling/resources', { name: 'ruang rapat a', kind: 'ROOM' }).expect(400); // nama kembar
      await post(adm, '/api/scheduling/resources', { name: 'Proyektor', kind: 'EQUIPMENT', employeeId: empA }).expect(400);
      person = (await post(adm, '/api/scheduling/resources', { name: 'Dewi (konsultan)', kind: 'PERSON', employeeId: empA }).expect(201)).body.id;
      expect((await get(staff, '/api/scheduling/resources').expect(200)).body).toHaveLength(2);
    });

    it('bentrok ditolak; bersebelahan boleh; pindah dan batal menghormati bentrok', async () => {
      b1 = (await book(fin, room, at(9), at(11)).expect(201)).body.id;
      const clash = await book(fin, room, at(10), at(12));
      expect(clash.status).toBe(409);
      expect((await book(fin, room, at(8), at(9.5 as unknown as number))).status).toBeGreaterThanOrEqual(400);
      await book(fin, room, at(11), at(12)).expect(201); // tepat bersebelahan
      await book(fin, room, at(7), at(9)).expect(201); // berakhir tepat saat b1 mulai
      expect((await book(fin, room, at(9), at(9))).status).toBe(400); // durasi nol
      expect((await book(fin, room, at(12), at(10))).status).toBe(400); // terbalik
      expect((await book(acct, room, at(14), at(15))).status).toBe(403); // Akuntan hanya melihat
      expect((await book(fin, room, `${day}T14:00:00+07:00`, `${addDays(day, 30)}T14:00:00+07:00`)).status).toBe(400); // terlalu panjang
      // pindah ke slot bentrok ditolak; ke slot kosong diizinkan
      expect((await put(fin, `/api/scheduling/bookings/${b1}`, { startsAt: at(11, 30), endsAt: at(12, 30) })).status).toBe(409);
      await put(fin, `/api/scheduling/bookings/${b1}`, { startsAt: at(13), endsAt: at(14) }).expect(200);
      // batal membebaskan slot
      await post(fin, `/api/scheduling/bookings/${b1}/cancel`, { reason: 'x' }).expect(400);
      await post(fin, `/api/scheduling/bookings/${b1}/cancel`, { reason: 'Klien menunda' }).expect(201);
      await book(fin, room, at(13), at(14)).expect(201);
      await post(fin, `/api/scheduling/bookings/${b1}/cancel`, { reason: 'Klien menunda' }).expect(400); // sudah batal
    });

    it('pemesanan bersamaan untuk slot yang sama: tepat satu berhasil', async () => {
      const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => book(fin, room, at(15), at(17), { title: `Balapan ${i}` })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
      const n = (await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM resource_bookings WHERE resource_id = ${room} AND status = 'BOOKED' AND starts_at = ${at(15)}::timestamptz`)).rows[0].n;
      expect(n).toBe(1);
    });

    it('slot kosong menghitung celah jam kerja dari pemesanan yang ada', async () => {
      const slots = (await get(staff, `/api/scheduling/free-slots?resourceId=${room}&from=${day}&to=${day}&minutes=60`).expect(200)).body as { startsAt: string; endsAt: string }[];
      // pemesanan hari itu: 07–09, 11–12, 13–14, 15–17 → celah 09–11? (b1 pindah/batal; 09–11 sudah bebas), 12–13, 14–15
      const hm = (s: string) => new Date(s).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
      expect(slots.map((s) => `${hm(s.startsAt)}-${hm(s.endsAt)}`)).toEqual(['09:00-11:00', '12:00-13:00', '14:00-15:00']);
      const long = (await get(staff, `/api/scheduling/free-slots?resourceId=${room}&from=${day}&to=${day}&minutes=180`).expect(200)).body;
      expect(long).toHaveLength(0);
    });

    it('pemesanan orang → catatan waktu draf (sekali saja); kontrol beban dan pemesanan lewat', async () => {
      const cu = cust;
      const past = new Date(Date.now() - 3 * 3600_000);
      const s = past.toISOString();
      const e = new Date(past.getTime() + 2 * 3600_000).toISOString();
      await db.execute(sql`DELETE FROM time_entries WHERE employee_id = ${empA}`); // agar tes tidak bergantung jam (tanggal kerja bisa sama dengan catatan tes lain)
      await db.execute(sql`INSERT INTO resource_bookings (tenant_id, resource_id, customer_id, title, starts_at, ends_at, created_by_id) SELECT tenant_id, id, ${cu}, 'Sesi konsultasi lalu', ${s}, ${e}, '00000000-0000-0000-0000-000000000000' FROM scheduling_resources WHERE id = ${person}`);
      const id = (await get(fin, `/api/scheduling/bookings?resourceId=${person}`).expect(200)).body[0].id;
      const te = (await post(fin, `/api/scheduling/bookings/${id}/time-entry`).expect(201)).body;
      expect(Number(te.hours)).toBe(2);
      expect(te.status).toBe('DRAFT');
      await post(fin, `/api/scheduling/bookings/${id}/time-entry`).expect(400); // sudah
      expect((await post(fin, `/api/scheduling/bookings/${(await get(fin, `/api/scheduling/bookings?resourceId=${room}`).expect(200)).body[0].id}/time-entry`)).status).toBe(400); // ruang bukan orang
      // beban berlebih: 11 jam untuk satu orang dalam sehari
      await book(fin, person, at(6), at(11)).expect(201);
      await book(fin, person, at(11), at(17)).expect(201);
      const c = (await get(acct, '/api/scheduling/controls').expect(200)).body;
      expect(c.overloadedPeople.length).toBeGreaterThanOrEqual(1);
      // pemesanan yang sudah lewat > 1 hari belum diselesaikan
      await db.execute(sql`UPDATE resource_bookings SET starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 hour' WHERE resource_id = ${room} AND status = 'BOOKED' AND starts_at = ${at(13)}::timestamptz`);
      expect((await get(acct, '/api/scheduling/controls').expect(200)).body.notCompleted.length).toBeGreaterThanOrEqual(1);
    });

    it('isolasi: perusahaan lain tidak melihat jadwal dan tidak bisa memesan sumber daya kita', async () => {
      expect((await get(other, '/api/scheduling/resources').expect(200)).body).toHaveLength(0);
      expect((await get(other, '/api/scheduling/bookings').expect(200)).body).toHaveLength(0);
      const o = (await post(other, '/api/scheduling/resources', { name: 'Ruang X', kind: 'ROOM' }).expect(201)).body.id;
      expect((await book(other, room, at(9), at(10))).status).toBe(400);
      expect((await book(other, o, at(9), at(10))).status).toBe(201); // sumber daya milik perusahaan itu sendiri tetap bisa dipesan
    });
  });
});
