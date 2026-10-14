/**
 * Peralihan ke peran Akuntan (e2e): pengguna Keuangan lama tidak berpindah diam-diam, Pemilik diberi tahu lewat Cek kesehatan,
 * perpindahan Keuangan ↔ Akuntan terjejak dan ditandai, serta pesan 403 menyebut peran yang berhak.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Check = { key: string; status: string; message: string; detail?: { label: string; value: string }[] };

describe('Peralihan ke peran Akuntan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const addUser = async (name: string, role: string) => {
    const email = `pp-${name.toLowerCase()}-${stamp}@uji.id`;
    const r = await http.post('/api/users').set(as(owner)).send({ name, email, password: 'rahasia123', role }).expect(201);
    return { id: r.body.id as string, email };
  };
  const health = async (key: string) => ((await http.get('/api/accounting/health').set(as(owner)).expect(200)).body.checks as Check[]).find((c) => c.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Peralihan Peran', name: 'Pemilik', email: `pp-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  it('hanya Pemilik/Admin: pemisahan fungsi bersifat informasi', async () => {
    const c = await health('sod-roles');
    expect(c.status).toBe('INFO');
  });

  let finId: string;
  let finEmail: string;
  it('ada Keuangan tetapi belum ada Akuntan: Pemilik/Admin dianggap akuntan (informasi) dan Keuangan tidak bisa membukukan', async () => {
    const fin = await addUser('Fina', 'FINANCE');
    finId = fin.id;
    finEmail = fin.email;
    const c = await health('sod-roles');
    expect(c.status).toBe('INFO');
    expect(c.message).toMatch(/Belum ada pengguna Akuntan: Pemilik\/Admin bertindak sebagai akuntan/);
    const t = await login(fin.email, 'rahasia123');
    const r = await http.post('/api/accounting/journals').set(as(t)).send({}).expect(403);
    expect(r.body.message).toMatch(/Keuangan/);
    expect(r.body.message).toMatch(/Yang berhak: .*Akuntan/);
  });

  it('setelah ada Akuntan: pemisahan berjalan (OK)', async () => {
    await addUser('Akun', 'ACCOUNTANT');
    expect((await health('sod-roles')).status).toBe('OK');
    expect((await health('sod-role-change')).status).toBe('OK');
  });

  it('memindahkan pengguna Keuangan menjadi Akuntan tercatat (peran lama) dan ditandai di Cek kesehatan', async () => {
    await http.patch(`/api/users/${finId}`).set(as(owner)).send({ role: 'ACCOUNTANT' }).expect(200);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const rows = (await pool.query(`SELECT data FROM audit_logs WHERE entity = 'User' AND entity_id = $1 AND action = 'UPDATE'`, [finId])).rows as { data: { previousRole?: string; role?: string } }[];
    await pool.end();
    expect(rows.some((r) => r.data?.previousRole === 'FINANCE' && r.data?.role === 'ACCOUNTANT')).toBe(true);
    const c = await health('sod-role-change');
    expect(c.status).toBe('WARN');
    expect(c.detail?.[0]).toMatchObject({ value: 'Keuangan → Akuntan' });
    expect(c.detail?.[0].label).toMatch(/Fina/);
    // pengguna yang dipindah langsung kehilangan sesi lama dan hak Keuangan
    const t = await login(finEmail, 'rahasia123');
    await http.post('/api/cash/transactions').set(as(t)).send({}).expect(403);
  });

  it('perubahan peran lain (mis. ke Sales) tidak ditandai sebagai perpindahan Keuangan ↔ Akuntan', async () => {
    const x = await addUser('Sasa', 'SALES');
    await http.patch(`/api/users/${x.id}`).set(as(owner)).send({ role: 'WAREHOUSE' }).expect(200);
    const c = await health('sod-role-change');
    expect(c.detail?.length).toBe(1);
  });
});
