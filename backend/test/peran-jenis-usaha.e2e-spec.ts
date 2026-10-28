/**
 * Peran per jenis usaha + penyesuaian per perusahaan + akses operasional Jasa.
 * Penyesuaian hanya mengubah sebutan/peran yang ditawarkan di perusahaan itu; hak akses tetap dari kode.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Peran per jenis usaha & penyesuaian perusahaan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let jasa = ''; let dagang = ''; let dagang2 = '';
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const reg = async (model: string, tag: string) => (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `pj-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
  const mkUser = (t: string, role: string, tag: string) => http.post('/api/users').set(as(t)).send({ name: `${tag} ${role}`, email: `pj-${tag}-${role}-${stamp}@uji.id`, password: 'rahasia12345', role });
  const login = async (tag: string, role: string) => (await http.post('/api/auth/login').send({ email: `pj-${tag}-${role}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    jasa = await reg('JASA', 'jasa');
    dagang = await reg('DAGANG', 'dagang');
    dagang2 = await reg('DAGANG', 'dagang2');
  });
  afterAll(() => app.close());

  describe('katalog & penawaran peran', () => {
    it('Jasa memakai sebutan jasa; Dagang tetap bawaan', async () => {
      const j = (await http.get('/api/settings/customization/roles').set(as(jasa)).expect(200)).body;
      expect(j.model).toBe('JASA');
      expect(j.catalog.find((r: { role: string }) => r.role === 'WAREHOUSE').label).toBe('Koordinator lapangan');
      const d = (await http.get('/api/settings/customization/roles').set(as(dagang)).expect(200)).body;
      expect(d.catalog.find((r: { role: string }) => r.role === 'WAREHOUSE').label).toBe('Gudang');
    });

    it('daftar bawaan jenis usaha hanya menyederhanakan pilihan: Kasir tidak ditampilkan di Dagang tetapi alur lama tetap dapat dipakai', async () => {
      const d = (await http.get('/api/settings/customization/roles').set(as(dagang)).expect(200)).body;
      expect(d.catalog.find((r: { role: string }) => r.role === 'CASHIER').offered).toBe(false);
      expect((await mkUser(dagang, 'CASHIER', 'dagang')).status).toBe(201);
    });
  });

  describe('penyesuaian per perusahaan', () => {
    it('hanya Admin/Pemilik yang dapat mengubah; masukan salah ditolak', async () => {
      await mkUser(jasa, 'SALES', 'jasa').expect(201);
      const sales = await login('jasa', 'SALES');
      const put = (t: string, b: object) => http.put('/api/settings/customization/roles').set(as(t)).send(b);
      expect((await put(sales, { labels: { SALES: 'Marketing' } })).status).toBe(403);
      expect((await put(jasa, { hidden: ['OWNER'] })).status).toBe(400);
      expect((await put(jasa, { hidden: ['ADMIN'] })).status).toBe(400);
      expect((await put(jasa, { labels: { SALES: 'X' } })).status).toBe(400);
      expect((await put(jasa, { labels: { SALES: 'Marketing', WAREHOUSE: 'marketing' } })).status).toBe(400);
      expect((await put(jasa, { hidden: ['HR'], extra: ['HR'] })).status).toBe(400);
      expect((await put(jasa, { hidden: ['BOSS'] })).status).toBe(400);
    });

    it('sebutan dan peran tersembunyi berlaku untuk perusahaan itu saja; perusahaan lain tidak terpengaruh', async () => {
      const r = (await http.put('/api/settings/customization/roles').set(as(dagang)).send({ labels: { SALES: 'Admin penjualan' }, hidden: ['PURCHASING'] }).expect(200)).body;
      expect(r.catalog.find((x: { role: string }) => x.role === 'SALES').label).toBe('Admin penjualan');
      expect(r.catalog.find((x: { role: string }) => x.role === 'PURCHASING').offered).toBe(false);
      expect((await mkUser(dagang, 'PURCHASING', 'dagang')).status).toBe(400);
      expect((await http.get('/api/auth/me').set(as(dagang)).expect(200)).body.roleCustomization.labels.SALES).toBe('Admin penjualan');
      // perusahaan Dagang lain dan perusahaan Jasa tidak berubah
      const other = (await http.get('/api/settings/customization/roles').set(as(dagang2)).expect(200)).body;
      expect(other.catalog.find((x: { role: string }) => x.role === 'SALES').label).toBe('Penjualan');
      expect((await mkUser(dagang2, 'PURCHASING', 'dagang2')).status).toBe(201);
      expect((await http.get('/api/auth/me').set(as(dagang2)).expect(200)).body.roleCustomization).toEqual({});
    });

    it('menambahkan peran ke daftar pilihan; hak akses peran tidak berubah', async () => {
      const r = (await http.put('/api/settings/customization/roles').set(as(dagang2)).send({ extra: ['CASHIER'] }).expect(200)).body;
      expect(r.catalog.find((x: { role: string }) => x.role === 'CASHIER').offered).toBe(true);
      expect((await mkUser(dagang2, 'CASHIER', 'dagang2')).status).toBe(201);
      const cashier = await login('dagang2', 'CASHIER');
      // Kasir tetap tidak boleh membuka jurnal walau sebutan/penawarannya disesuaikan
      expect((await http.get('/api/accounting/journals').set(as(cashier))).status).toBe(403);
    });

    it('pengguna yang sudah memegang peran tersembunyi tidak berubah; kembali ke jenis usaha dengan reset; tercatat di audit', async () => {
      const t = dagang;
      await http.put('/api/settings/customization/roles').set(as(t)).send({ hidden: ['CASHIER'] }).expect(200);
      const users = (await http.get('/api/users').set(as(t)).expect(200)).body as { role: string; isActive: boolean }[];
      expect(users.find((u) => u.role === 'CASHIER')?.isActive).toBe(true);
      const r = (await http.delete('/api/settings/customization/roles').set(as(t)).expect(200)).body;
      expect(r.customization).toEqual({});
      expect(r.catalog.find((x: { role: string }) => x.role === 'SALES').label).toBe('Penjualan');
      const audit = (await http.get('/api/audit-logs?category=settings').set(as(t))).body;
      expect(JSON.stringify(audit)).toMatch(/penyesuaian peran/);
    });
  });

  describe('akses operasional Jasa (Sales / Koordinator lapangan)', () => {
    let sales = ''; let koord = ''; let kasir = '';
    let cust = ''; let contract = ''; let post1 = ''; let emp = ''; let kelas = '';
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

    beforeAll(async () => {
      await http.post('/api/apps/hr/install').set(as(jasa)).send({}).expect(201);
      await mkUser(jasa, 'WAREHOUSE', 'jasa').expect(201);
      await mkUser(jasa, 'CASHIER', 'jasa').expect(201);
      sales = await login('jasa', 'SALES'); koord = await login('jasa', 'WAREHOUSE'); kasir = await login('jasa', 'CASHIER');
      cust = (await http.post('/api/customers').set(as(jasa)).send({ code: 'K1', name: 'Gedung A', paymentTermDays: 14 }).expect(201)).body.id;
      emp = (await http.post('/api/hr/employees').set(as(jasa)).send({ code: 'P1', name: 'Petugas Satu', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '3600000' }).expect(201)).body.id;
      contract = (await http.post('/api/services/sites').set(as(jasa)).send({ customerId: cust, siteName: 'Gedung A', title: 'Kebersihan', startDate: addDays(`${prev}-01`, -5), posts: [{ name: 'Cleaning', headcount: 1, monthlyRate: '3000000' }] }).expect(201)).body.id;
      post1 = (await http.get('/api/services/sites').set(as(jasa)).expect(200)).body[0].posts[0].id;
      kelas = (await http.post('/api/services/education/classes').set(as(jasa)).send({ code: 'K-1', name: 'Kelas satu', monthlyFee: '100000', startDate: addDays(`${prev}-01`, -5) }).expect(201)).body.id;
    });

    it('Koordinator lapangan dan Sales melihat kontrak dan mengatur jadwal jaga', async () => {
      for (const t of [koord, sales]) expect((await http.get('/api/services/sites').set(as(t))).status).toBe(200);
      expect((await http.post(`/api/services/sites/${contract}/roster`).set(as(koord)).send({ postId: post1, employeeId: emp, from: `${prev}-01`, to: `${prev}-03` })).status).toBe(201);
      const duty = (await http.get(`/api/services/sites/${contract}/coverage?from=${prev}-01&to=${prev}-03`).set(as(sales)).expect(200)).body.posts[0].duty[0].id;
      expect((await http.delete(`/api/services/sites/${contract}/roster/${duty}`).set(as(sales))).status).toBe(200);
    });

    it('menagih, membuat/mengubah kontrak tetap hanya Admin/Keuangan; Kasir tidak punya akses', async () => {
      for (const t of [koord, sales]) {
        expect((await http.post(`/api/services/sites/${contract}/bill`).set(as(t)).send({ period: prev })).status).toBe(403);
        expect((await http.post('/api/services/sites').set(as(t)).send({})).status).toBe(403);
        expect((await http.put(`/api/services/sites/${contract}`).set(as(t)).send({ isActive: false, reason: 'tidak boleh' })).status).toBe(403);
      }
      expect((await http.get('/api/services/sites').set(as(kasir))).status).toBe(403);
      expect((await http.post('/api/services/education/bill').set(as(sales)).send({ period: prev })).status).toBe(403);
    });

    it('Sales mendaftarkan peserta; mengatur kelas tidak boleh; Koordinator lapangan tidak punya akses SPP', async () => {
      const e = await http.post('/api/services/education/enrollments').set(as(sales)).send({ classId: kelas, customerId: cust, studentName: 'Andi', enrolledOn: `${prev}-02` });
      expect(e.status).toBe(201);
      expect((await http.get('/api/services/education/enrollments').set(as(sales))).status).toBe(200);
      expect((await http.post('/api/services/education/classes').set(as(sales)).send({ code: 'X', name: 'Xx', monthlyFee: '1', startDate: today })).status).toBe(403);
      expect((await http.get('/api/services/education/classes').set(as(koord))).status).toBe(403);
    });

    it('pemilih petugas hanya id, kode, dan nama: tanpa gaji dan data SDM', async () => {
      const staff = (await http.get('/api/services/sites/staff').set(as(koord)).expect(200)).body as Record<string, unknown>[];
      expect(staff.length).toBeGreaterThan(0);
      expect(Object.keys(staff[0]).sort()).toEqual(['code', 'id', 'name']);
      expect(JSON.stringify(staff)).not.toMatch(/baseSalary|3600000|ptkp/);
      // Koordinator lapangan tetap tidak boleh membuka data karyawan lengkap
      expect((await http.get('/api/hr/employees').set(as(koord))).status).toBe(403);
    });
  });
});
