/**
 * Layanan berlangganan (e2e): uji coba, lupa sandi, verifikasi email, tagihan & konfirmasi bukti
 * transfer oleh pemilik layanan, mode baca saja saat langganan tidak aktif, batas paket,
 * dan sinkron marketplace (mode simulasi).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailService } from '../src/common/mail/mail.service';
import { DB, Db } from '../src/db/db';
import { subscriptions, users } from '../src/db/schema';

describe('Langganan, email & panel admin (e2e)', () => {
  let app: INestApplication;
  let db: Db;
  let mail: MailService;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const ownerEmail = `pemilik-${stamp}@uji.id`;
  const adminEmail = `superadmin-${stamp}@sansu.id`;
  let owner: string;
  let admin: string;
  let tenantId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lastLink = (to: string, path: string) => {
    const m = [...mail.outbox].reverse().find((x) => x.to === to && x.action?.url.includes(path));
    return m ? new URL(m.action!.url).searchParams.get('token')! : '';
  };

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    mail = app.get(MailService);
    http = request(app.getHttpServer());
    const r = await http.post('/api/auth/register').send({ companyName: 'PT Uji Langganan', name: 'Bu Sari', email: ownerEmail, password: 'rahasia123' }).expect(201);
    owner = r.body.accessToken;
    tenantId = r.body.user.tenantId;
    const a = await http.post('/api/auth/register').send({ companyName: 'SANSU Pusat', name: 'Admin SANSU', email: adminEmail, password: 'rahasia123' }).expect(201);
    admin = a.body.accessToken;
  });
  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await app.close();
  });

  it('pendaftar baru mendapat uji coba & email verifikasi', async () => {
    const me = await http.get('/api/auth/me').set(as(owner)).expect(200);
    expect(me.body).toMatchObject({ emailVerified: false, isPlatformAdmin: false, subscription: { status: 'TRIAL', readOnly: false } });
    expect(me.body.subscription.daysLeft).toBeGreaterThanOrEqual(13);
    const token = lastLink(ownerEmail, '/verify-email');
    expect(token.length).toBeGreaterThan(20);
    await http.post('/api/auth/verify-email').send({ token }).expect(200);
    await http.post('/api/auth/verify-email').send({ token }).expect(400); // sekali pakai
    expect((await http.get('/api/auth/me').set(as(owner))).body.emailVerified).toBe(true);
  });

  it('lupa sandi: jawaban sama untuk email tak dikenal, token sekali pakai, sesi lama dicabut', async () => {
    const n = mail.outbox.length;
    const x = await http.post('/api/auth/forgot-password').send({ email: `tidak-ada-${stamp}@uji.id` }).expect(200);
    expect(mail.outbox.length).toBe(n);
    const y = await http.post('/api/auth/forgot-password').send({ email: ownerEmail }).expect(200);
    expect(y.body.message).toBe(x.body.message);
    const token = lastLink(ownerEmail, '/reset-password');
    await http.post('/api/auth/reset-password').send({ token, password: 'pendek' }).expect(400);
    await http.post('/api/auth/reset-password').send({ token, password: 'sandiBaru123' }).expect(200);
    await http.post('/api/auth/reset-password').send({ token, password: 'sandiBaru456' }).expect(400);
    await http.get('/api/auth/me').set(as(owner)).expect(401);
    owner = (await http.post('/api/auth/login').send({ email: ownerEmail, password: 'sandiBaru123' }).expect(200)).body.accessToken;
  });

  it('hanya pemilik layanan yang bisa membuka panel admin', async () => {
    await http.get('/api/platform-admin/overview').set(as(owner)).expect(403);
    const o = await http.get('/api/platform-admin/overview').set(as(admin)).expect(200);
    expect(o.body.tenants).toBeGreaterThanOrEqual(2);
    const list = await http.get('/api/platform-admin/tenants').query({ q: 'Uji Langganan' }).set(as(admin)).expect(200);
    expect(list.body.find((t: { id: string }) => t.id === tenantId)).toMatchObject({ state: 'TRIAL', owner_email: ownerEmail });
  });

  it('tagihan → bukti transfer → dikonfirmasi admin → langganan aktif diperpanjang', async () => {
    const ov = await http.get('/api/billing').set(as(owner)).expect(200);
    const starter = ov.body.plans.find((p: { code: string }) => p.code === 'STARTER');
    const inv = await http.post('/api/billing/invoices').set(as(owner)).send({ planId: starter.id, cycle: 'MONTHLY' }).expect(201);
    expect(inv.body).toMatchObject({ status: 'UNPAID', amount: '199000.00' });
    expect(inv.body.number).toMatch(/^SNS\/\d{4}\/\d{2}\/\d{4}$/);
    await http.post(`/api/billing/invoices/${inv.body.id}/proof`).set(as(owner)).send({ proof: 'data:text/html;base64,PHNjcmlwdD4=' }).expect(400);
    await http.post(`/api/billing/invoices/${inv.body.id}/proof`).set(as(owner)).send({ proof: 'data:image/png;base64,iVBORw0KGgo=', note: 'Transfer BCA' }).expect(200);
    await http.post(`/api/platform-admin/invoices/${inv.body.id}/confirm`).set(as(owner)).expect(403);
    await http.post(`/api/platform-admin/invoices/${inv.body.id}/confirm`).set(as(admin)).expect(200);
    const again = await http.post(`/api/platform-admin/invoices/${inv.body.id}/confirm`).set(as(admin)).expect(200);
    expect(again.body.alreadyPaid).toBe(true);
    const st = (await http.get('/api/billing').set(as(owner))).body.subscription;
    expect(st).toMatchObject({ status: 'ACTIVE', plan: { code: 'STARTER' } });
    // dibayar saat uji coba → perpanjangan dimulai setelah uji coba selesai (±14 + 30 hari)
    expect(st.daysLeft).toBeGreaterThan(40);
  });

  it('batas paket: Starter hanya 1 gudang & 3 pengguna', async () => {
    const w = await http.post('/api/warehouses').set(as(owner)).send({ code: 'GDG-02', name: 'Gudang 2' }).expect(403);
    expect(w.body.message).toContain('1 gudang');
    for (let i = 0; i < 2; i++) await http.post('/api/users').set(as(owner)).send({ name: `Staf ${i}`, email: `staf${i}-${stamp}@uji.id`, password: 'rahasia123', role: 'SALES' }).expect(201);
    await http.post('/api/users').set(as(owner)).send({ name: 'Staf 3', email: `staf3-${stamp}@uji.id`, password: 'rahasia123', role: 'SALES' }).expect(403);
  });

  it('langganan habis → baca saja, tagihan tetap bisa dibayar', async () => {
    await db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000) }).where(eq(subscriptions.tenantId, tenantId));
    await http.patch(`/api/platform-admin/tenants/${tenantId}/subscription`).set(as(admin)).send({ notes: 'uji kedaluwarsa' }).expect(200); // kosongkan cache
    const me = await http.get('/api/auth/me').set(as(owner)).expect(200);
    expect(me.body.subscription).toMatchObject({ status: 'EXPIRED', readOnly: true });
    await http.get('/api/customers').set(as(owner)).expect(200);
    const blocked = await http.post('/api/customers').set(as(owner)).send({ code: 'C-X', name: 'Pelanggan X' }).expect(402);
    expect(blocked.body.code).toBe('SUBSCRIPTION_INACTIVE');
    await http.post('/api/billing/invoices').set(as(owner)).send({ planId: me.body.subscription.plan.id, cycle: 'YEARLY' }).expect(201);
    // admin memperpanjang manual 10 hari
    await http.patch(`/api/platform-admin/tenants/${tenantId}/subscription`).set(as(admin)).send({ extendDays: 10 }).expect(200);
    await http.post('/api/customers').set(as(owner)).send({ code: 'C-X', name: 'Pelanggan X' }).expect(201);
  });

  it('ditangguhkan admin → tidak bisa mengubah data', async () => {
    await http.patch(`/api/platform-admin/tenants/${tenantId}/subscription`).set(as(admin)).send({ status: 'SUSPENDED' }).expect(200);
    await http.post('/api/customers').set(as(owner)).send({ code: 'C-Y', name: 'Y' }).expect(402);
    await http.patch(`/api/platform-admin/tenants/${tenantId}/subscription`).set(as(admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('webhook pembayaran tanpa tanda tangan sah ditolak', async () => {
    await http.post('/api/billing/webhooks/midtrans').send({ order_id: 'SNS/2026/01/0001', status_code: '200', gross_amount: '1', signature_key: 'x', transaction_status: 'settlement' }).expect(403);
    await http.post('/api/billing/webhooks/xendit').set('x-callback-token', 'palsu').send({ external_id: 'SNS/1', status: 'PAID' }).expect(403);
  });

  it('sinkron marketplace (simulasi) membuat faktur & tidak dobel', async () => {
    const wh = (await http.get('/api/warehouses').set(as(owner))).body[0];
    const prod = await http.post('/api/products').set(as(owner)).send({ sku: `SIM-${stamp}`, name: 'Produk simulasi', sellPrice: '10000' }).expect(201);
    await http
      .post('/api/inventory/adjustments')
      .set(as(owner))
      .send({ warehouseId: wh.id, reason: 'OPENING', date: '2025-12-31', lines: [{ productId: prod.body.id, qty: '500', unitCost: '7000' }] })
      .expect(201);
    const c = await http.post('/api/integrations/marketplace/connections').set(as(owner)).send({ provider: 'SIMULASI', warehouseId: wh.id }).expect(201);
    expect(c.body.connected).toBe(true);
    const r1 = await http.post(`/api/integrations/marketplace/connections/${c.body.id}/sync`).set(as(owner)).expect(200);
    expect(r1.body.fetched).toBeGreaterThan(0);
    expect(r1.body.skipped).toEqual([]);
    expect(r1.body.imported.length).toBe(r1.body.fetched);
    expect(r1.body.imported[0].invoice).toMatch(/^INV\//);
    const r2 = await http.post(`/api/integrations/marketplace/connections/${c.body.id}/sync`).set(as(owner)).expect(200);
    expect(r2.body.imported).toHaveLength(0);
    const list = await http.get('/api/integrations/marketplace/connections').set(as(owner)).expect(200);
    expect(list.body[0]).toMatchObject({ provider: 'SIMULASI', lastError: null });
    expect(JSON.stringify(list.body)).not.toContain('credentials');
    await http.post('/api/integrations/marketplace/connections').set(as(owner)).send({ provider: 'SHOPEE', warehouseId: wh.id }).expect(400);
  });

  it('pengguna dibuat admin perusahaan otomatis terverifikasi', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, `staf0-${stamp}@uji.id`));
    expect(u.emailVerifiedAt).not.toBeNull();
  });
});
