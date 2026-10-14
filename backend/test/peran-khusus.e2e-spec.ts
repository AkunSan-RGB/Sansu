/**
 * Peran khusus (e2e): peran dasar dikurangi hak tulis tertentu. Hanya Pemilik yang mengelola, tidak pernah melebihi peran dasar,
 * ditegakkan di server (403 + izin tampilan), dan terjejak.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Peran khusus (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let owner: string;
  let admin: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const patch = (t: string, u: string, b: object = {}) => http.patch(u).set(as(t)).send(b);
  const login = async (email: string, password = 'rahasia123') => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  let adminId: string;
  let roleId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Peran Khusus', name: 'Pemilik', email: `pk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const r = await post(owner, '/api/users', { name: 'Admin Satu', email: `pk-adm-${stamp}@uji.id`, password: 'rahasia123', role: 'ADMIN' }).expect(201);
    adminId = r.body.id;
    admin = await login(`pk-adm-${stamp}@uji.id`);
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('hanya Pemilik yang mengelola peran khusus', async () => {
    await get(admin, '/api/settings/roles').expect(403);
    await post(admin, '/api/settings/roles', { name: 'X', baseRole: 'ADMIN' }).expect(403);
    expect((await get(owner, '/api/settings/roles').expect(200)).body).toEqual([]);
  });

  it('katalog hanya memuat hak tulis milik peran dasar (tanpa aksi akun sendiri)', async () => {
    const cat = (await get(owner, '/api/settings/roles/catalog?baseRole=WAREHOUSE').expect(200)).body as { key: string; group: string; label: string }[];
    expect(cat.some((c) => c.key === 'POST /inventory/adjustments')).toBe(true);
    expect(cat.some((c) => c.key === 'POST /purchase-orders')).toBe(false); // Gudang tidak memesan
    expect(cat.some((c) => c.key.includes('/auth/'))).toBe(false);
    const adm = (await get(owner, '/api/settings/roles/catalog?baseRole=ADMIN').expect(200)).body as { key: string; label: string }[];
    expect(adm.find((c) => c.key === 'POST /payments')?.label).toBe('Menerima pembayaran pelanggan');
    await get(owner, '/api/settings/roles/catalog?baseRole=OWNER').expect(400);
  });

  it('validasi: nama, peran dasar bukan Pemilik, hak di luar peran dasar ditolak, nama unik', async () => {
    await post(owner, '/api/settings/roles', { name: 'X', baseRole: 'ADMIN' }).expect(400);
    await post(owner, '/api/settings/roles', { name: 'Pemilik Palsu', baseRole: 'OWNER' }).expect(400);
    await post(owner, '/api/settings/roles', { name: 'Gudang Nakal', baseRole: 'WAREHOUSE', denied: ['POST /accounting/journals'] }).expect(400); // bukan hak Gudang
    await post(owner, '/api/settings/roles', { name: 'Kunci Ngawur', baseRole: 'ADMIN', denied: ['POST /tidak-ada'] }).expect(400);
    await post(owner, '/api/settings/roles', { name: 'Akun Sendiri', baseRole: 'ADMIN', denied: ['POST /auth/logout-all'] }).expect(400);
    const r = await post(owner, '/api/settings/roles', { name: 'Admin Tanpa Bayar', baseRole: 'ADMIN', denied: ['POST /payments', 'POST /purchase-invoices/payments', 'POST /accounting/journals'] }).expect(201);
    roleId = r.body.id;
    await post(owner, '/api/settings/roles', { name: 'admin tanpa bayar', baseRole: 'ADMIN' }).expect(400);
  });

  it('hanya Pemilik yang menetapkan peran khusus ke pengguna; harus turunan peran dasar yang sama', async () => {
    await patch(admin, `/api/users/${adminId}`, { customRoleId: roleId }).expect(403);
    const sales = (await post(owner, '/api/users', { name: 'Sales', email: `pk-s-${stamp}@uji.id`, password: 'rahasia123', role: 'SALES' }).expect(201)).body;
    await patch(owner, `/api/users/${sales.id}`, { customRoleId: roleId }).expect(400); // peran dasar berbeda
    await post(owner, '/api/users', { name: 'Salah', email: `pk-x-${stamp}@uji.id`, password: 'rahasia123', role: 'SALES', customRoleId: roleId }).expect(400);
    await post(admin, '/api/users', { name: 'Y', email: `pk-y-${stamp}@uji.id`, password: 'rahasia123', role: 'ADMIN', customRoleId: roleId }).expect(403);
  });

  it('peran khusus ditolak pada hak yang dicabut (403 menyebut nama), sisanya tetap jalan; izin tampilan ikut', async () => {
    await patch(owner, `/api/users/${adminId}`, { customRoleId: roleId }).expect(200);
    const t = await login(`pk-adm-${stamp}@uji.id`);
    const r = await post(t, '/api/payments', {}).expect(403);
    expect(r.body.message).toMatch(/Admin Tanpa Bayar/);
    await post(t, '/api/accounting/journals', {}).expect(403);
    await post(t, '/api/purchase-invoices/payments', {}).expect(403);
    // hak yang tidak dicabut tetap berjalan (400 validasi, bukan 403)
    expect((await post(t, '/api/customers', {})).status).toBe(400);
    const perms = (await get(t, '/api/auth/permissions').expect(200)).body.allow as string[];
    expect(perms).not.toContain('POST /payments');
    expect(perms).not.toContain('POST /accounting/journals');
    expect(perms).toContain('POST /customers');
    expect((await get(t, '/api/auth/me').expect(200)).body.roleLabel).toBe('Admin Tanpa Bayar');
    // membaca tidak dibatasi
    await get(t, '/api/accounting/journals').expect(200);
    // Pemilik tidak pernah dibatasi
    expect((await post(owner, '/api/payments', {})).status).toBe(400);
  });

  it('Admin tidak bisa melepas batasnya sendiri atau mengubah peran pengguna berperan khusus; Pemilik bisa', async () => {
    const t = await login(`pk-adm-${stamp}@uji.id`);
    await patch(t, `/api/users/${adminId}`, { customRoleId: null }).expect(403);
    const other = (await post(owner, '/api/users', { name: 'Admin Dua', email: `pk-adm2-${stamp}@uji.id`, password: 'rahasia123', role: 'ADMIN' }).expect(201)).body;
    const admin2 = await login(`pk-adm2-${stamp}@uji.id`);
    await patch(owner, `/api/users/${other.id}`, { customRoleId: roleId }).expect(200);
    await patch(admin2, `/api/users/${other.id}`, { role: 'FINANCE' }).expect(401); // sesi lama dicabut saat peran berubah
    const admin2b = await login(`pk-adm2-${stamp}@uji.id`);
    await patch(admin2b, `/api/users/${other.id}`, { role: 'FINANCE' }).expect(400); // tidak boleh ubah diri sendiri
    const third = (await post(owner, '/api/users', { name: 'Admin Tiga', email: `pk-adm3-${stamp}@uji.id`, password: 'rahasia123', role: 'ADMIN' }).expect(201)).body;
    await patch(owner, `/api/users/${third.id}`, { customRoleId: roleId }).expect(200);
    await patch(t, `/api/users/${third.id}`, { role: 'FINANCE' }).expect(403); // Admin tidak bisa melepas batas pengguna lain
    // Pemilik mengubah peran dasar: peran khusus lama dilepas otomatis
    await patch(owner, `/api/users/${third.id}`, { role: 'FINANCE' }).expect(200);
    const row = (await get(owner, '/api/users').expect(200)).body.find((u: { id: string }) => u.id === third.id);
    expect(row).toMatchObject({ role: 'FINANCE', customRoleId: null });
  });

  it('mengubah daftar hak langsung berlaku; hapus ditolak selama dipakai; semua terjejak', async () => {
    const t = await login(`pk-adm-${stamp}@uji.id`);
    await patch(owner, `/api/settings/roles/${roleId}`, { denied: ['POST /accounting/journals'] }).expect(200);
    expect((await post(t, '/api/payments', {})).status).toBe(400); // pembayaran kini boleh
    await post(t, '/api/accounting/journals', {}).expect(403);
    await patch(owner, `/api/settings/roles/${roleId}`, { denied: ['POST /payments'] }).expect(200);
    await http.delete(`/api/settings/roles/${roleId}`).set(as(owner)).expect(400);
    const list = (await get(owner, '/api/settings/roles').expect(200)).body as { id: string; users: number }[];
    expect(list.find((r) => r.id === roleId)!.users).toBeGreaterThan(0);
    const logs = (await pool.query(`SELECT action FROM audit_logs WHERE entity = 'CustomRole' AND entity_id = $1 ORDER BY id`, [roleId])).rows.map((r) => r.action);
    expect(logs).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
    // lepas dari semua pengguna lalu hapus
    const users = (await get(owner, '/api/users').expect(200)).body as { id: string; customRoleId: string | null }[];
    for (const u of users.filter((x) => x.customRoleId === roleId)) await patch(owner, `/api/users/${u.id}`, { customRoleId: null }).expect(200);
    await http.delete(`/api/settings/roles/${roleId}`).set(as(owner)).expect(200);
    expect((await get(owner, '/api/settings/roles').expect(200)).body).toEqual([]);
  });

  it('perpindahan Keuangan ↔ Akuntan tetap terdeteksi memakai peran dasar (peran khusus tidak mengaburkan)', async () => {
    const f = (await post(owner, '/api/users', { name: 'Fin', email: `pk-f-${stamp}@uji.id`, password: 'rahasia123', role: 'FINANCE' }).expect(201)).body;
    await patch(owner, `/api/users/${f.id}`, { role: 'ACCOUNTANT' }).expect(200);
    const checks = (await get(owner, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(checks.find((c) => c.key === 'sod-role-change')!.status).toBe('WARN');
  });
});
