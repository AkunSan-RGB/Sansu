/** Saklar langganan (mati selama tahap uji) dan pantauan penggunaan di Panel SANSU */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Panel SANSU: langganan dimatikan & pantauan uji (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const adminEmail = `panel-admin-${stamp}@sansu.id`;
  let admin: string;
  let owner: string;
  let tenantId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const setBilling = (enabled: boolean) => http.put('/api/platform-admin/settings').set(as(admin)).send({ enabled }).expect(200);

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    admin = (await http.post('/api/auth/register').send({ companyName: 'SANSU Pusat', name: 'Admin', email: adminEmail, password: 'rahasia123' }).expect(201)).body.accessToken;
    await setBilling(false);
    const r = await http.post('/api/auth/register').send({ companyName: 'PT Penguji', name: 'Penguji', email: `panel-${stamp}@uji.id`, password: 'rahasia123' }).expect(201);
    owner = r.body.accessToken;
    tenantId = r.body.user.tenantId;
  });
  afterAll(async () => {
    await setBilling(false);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await app.close();
  });

  it('langganan mati: pendaftar baru tanpa trial, tanpa batas, tanpa mode baca saja; tagihan ditolak', async () => {
    const me = (await http.get('/api/auth/me').set(as(owner)).expect(200)).body;
    expect(me.subscription).toMatchObject({ enabled: false, status: 'ACTIVE', readOnly: false, plan: null, daysLeft: null });
    const r = await http.post('/api/billing/invoices').set(as(owner)).send({ planId: '00000000-0000-0000-0000-000000000000', cycle: 'MONTHLY' }).expect(400);
    expect(r.body.message).toMatch(/belum diaktifkan/i);
    expect((await http.get('/api/platform-admin/overview').set(as(admin)).expect(200)).body.billingEnabled).toBe(false);
  });

  it('penangguhan lama tidak mengunci selama saklar mati, dan berlaku lagi saat dinyalakan', async () => {
    await setBilling(true);
    const plans = (await http.get('/api/platform-admin/plans').set(as(admin)).expect(200)).body as { id: string }[];
    await http.patch(`/api/platform-admin/tenants/${tenantId}/subscription`).set(as(admin)).send({ planId: plans[0].id, status: 'SUSPENDED' }).expect(200);
    const blocked = await http.post('/api/products').set(as(owner)).send({ sku: 'A1', name: 'Barang', sellPrice: '1000' });
    expect(blocked.status).toBe(402);
    await setBilling(false);
    await http.post('/api/products').set(as(owner)).send({ sku: 'A1', name: 'Barang', sellPrice: '1000' }).expect(201);
    expect((await http.get('/api/auth/me').set(as(owner))).body.subscription).toMatchObject({ enabled: false, readOnly: false });
  });

  it('pantauan: ukuran pemakaian, dokumen 7 hari, aktivitas harian, perusahaan teraktif, jejak terbaru; hanya pemilik layanan', async () => {
    await http.get('/api/platform-admin/pulse').set(as(owner)).expect(403);
    const p = (await http.get('/api/platform-admin/pulse').set(as(admin)).expect(200)).body;
    expect(p.users).toBeGreaterThanOrEqual(2);
    expect(p.tenants).toBeGreaterThanOrEqual(2);
    expect(p.d7).toBeGreaterThanOrEqual(1); // pengguna yang baru mencatat aktivitas dihitung aktif walau belum login ulang
    expect(p.tenants7).toBeGreaterThanOrEqual(1);
    expect(p.docs.map((d: { label: string }) => d.label)).toEqual(expect.arrayContaining(['Sales order', 'Faktur penjualan', 'Jurnal']));
    expect(Array.isArray(p.daily)).toBe(true);
    expect(p.recent.length).toBeGreaterThan(0);
    expect(p.recent[0]).toEqual(expect.objectContaining({ tenant: expect.any(String), action: expect.any(String), entity: expect.any(String) }));
    expect(Array.isArray(p.top)).toBe(true);
    if (p.top.length) expect(p.top[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), events: expect.any(Number) }));
  });
});
