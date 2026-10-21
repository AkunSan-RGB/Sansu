/**
 * Pengingat otomatis: daftar hal yang perlu ditindaklanjuti dihitung dari data, disaring menurut peran,
 * bisa ditunda per pengguna, dan ambangnya diatur per perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailService, type Mail } from '../src/common/mail/mail.service';
import { sql } from 'drizzle-orm';
import { DB, Db } from '../src/db/db';
import { ReminderMailer, customerStage } from '../src/modules/reminders/reminder-mailer.service';

const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

describe('Pengingat otomatis (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let mail: MailService;
  const sent: Mail[] = [];
  let warehouseUser: string;
  let financeUser: string;
  const stamp = Date.now();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}, t = owner) => http.post(u).set(as(t)).send(b);
  const keys = async (t = owner) => ((await get('/api/reminders', t).expect(200)).body.items as { key: string }[]).map((i) => i.key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    // surat tidak benar-benar dikirim: ditangkap supaya isinya bisa diperiksa
    mail = app.get(MailService);
    jest.spyOn(mail, 'send').mockImplementation(async (m: Mail) => {
      sent.push(m);
      return true;
    });
    owner = (await http.post('/api/auth/register').send({ companyName: 'CV Pengingat', name: 'Pemilik', email: `rm-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    for (const [role, email] of [['WAREHOUSE', `rm-w-${stamp}@uji.id`], ['FINANCE', `rm-f-${stamp}@uji.id`]] as const) {
      await post('/api/users', { name: role, email, password: 'rahasia123', role });
    }
    warehouseUser = (await http.post('/api/auth/login').send({ email: `rm-w-${stamp}@uji.id`, password: 'rahasia123' }).expect(200)).body.accessToken;
    financeUser = (await http.post('/api/auth/login').send({ email: `rm-f-${stamp}@uji.id`, password: 'rahasia123' }).expect(200)).body.accessToken;

    const wh = (await get('/api/warehouses')).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S1', name: 'PT Pemasok Lama', paymentTermDays: 30 }).expect(201)).body.id;
    const cust = (await post('/api/customers', { code: 'C1', name: 'Toko Pelanggan Lambat', paymentTermDays: 30 }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'R1', name: 'Barang R', sellPrice: '20000' }).expect(201)).body.id;
    const buy = async (date: string, qty: string, receiveOnly = false) => {
      const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, date, lines: [{ productId: prod, qty, price: '10000' }] }).expect(201)).body;
      await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
      if (receiveOnly) await post(`/api/purchase-orders/${po.id}/receipts`, { date }).expect(201);
      return po;
    };
    // utang supplier lewat jatuh tempo: faktur 40 hari lalu, tempo 30 hari → lewat 10 hari
    const apPo = await buy(shift(today, -40), '20');
    await post('/api/purchase-invoices', { purchaseOrderId: apPo.id, supplierInvoiceNo: `AP-${stamp}`, date: shift(today, -40) }).expect(201);
    // barang diterima 20 hari lalu belum difakturkan
    await buy(shift(today, -20), '5', true);
    // pesanan terkonfirmasi 20 hari lalu belum diterima
    await buy(shift(today, -20), '5');
    // piutang pelanggan lewat jatuh tempo 40 hari
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: shift(today, -70), lines: [{ productId: prod, qty: '3' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so.id, date: shift(today, -70) }).expect(201);
  });
  afterAll(() => app.close());

  it('pemilik melihat pengingat piutang, utang, penerimaan belum difakturkan, dan pesanan belum diterima', async () => {
    const r = (await get('/api/reminders').expect(200)).body;
    const by = Object.fromEntries((r.items as { key: string; level: string; title: string; detail: string; category: string }[]).map((i) => [i.key, i]));
    expect(by['ar-overdue']).toMatchObject({ level: 'error', category: 'PIUTANG' });
    expect(by['ar-overdue'].title).toContain('1 faktur pelanggan lewat jatuh tempo');
    expect(by['ar-overdue'].detail).toContain('Toko Pelanggan Lambat');
    expect(by['ap-overdue'].detail).toContain('PT Pemasok Lama');
    expect(by['grni-old'].title).toContain('1 penerimaan barang belum difakturkan');
    expect(by['po-not-received'].title).toContain('1 pesanan pembelian belum diterima');
    expect(r.counts.error).toBeGreaterThanOrEqual(2);
    // yang paling mendesak tampil lebih dulu
    expect(r.items[0].level).toBe('error');
  });

  it('daftar disaring menurut peran', async () => {
    const wh = await keys(warehouseUser);
    expect(wh).toEqual(expect.arrayContaining(['po-not-received']));
    expect(wh).not.toContain('ar-overdue');
    expect(wh).not.toContain('ap-overdue');
    const fin = await keys(financeUser);
    expect(fin).toEqual(expect.arrayContaining(['ar-overdue', 'ap-overdue', 'grni-old']));
    expect(fin).not.toContain('approvals');
  });

  it('tunda per pengguna: hilang dari daftar, muncul lagi bila dipulihkan, tidak memengaruhi pengguna lain', async () => {
    await post('/api/reminders/snooze', { key: 'ar-overdue', days: 3 }).expect(201);
    expect(await keys()).not.toContain('ar-overdue');
    expect(await keys(financeUser)).toContain('ar-overdue');
    const all = (await get('/api/reminders?all=true').expect(200)).body;
    expect(all.snoozedCount).toBe(1);
    expect(all.snoozed[0]).toMatchObject({ key: 'ar-overdue', snoozedUntil: shift(today, 3) });
    await post('/api/reminders/snooze', { key: 'tidak-ada', days: 3 }).expect(400);
    await post('/api/reminders/snooze', { key: 'ar-overdue', days: 2 }).expect(400); // hanya 1/3/7/30 hari
    await post('/api/reminders/unsnooze', { key: 'ar-overdue' }).expect(201);
    await post('/api/reminders/snooze', { key: '%00', days: 3 }).expect(400); // kunci tidak valid ditolak, bukan error server
    expect(await keys()).toContain('ar-overdue');
  });

  it('ambang diatur per perusahaan; hanya admin yang boleh mengubah; dimatikan = daftar kosong', async () => {
    expect((await get('/api/settings/reminders').expect(200)).body).toMatchObject({ enabled: true, grniDays: 14, apLeadDays: 7 });
    await http.put('/api/settings/reminders').set(as(financeUser)).send({ grniDays: 60 }).expect(403);
    await http.put('/api/settings/reminders').set(as(owner)).send({ grniDays: 60, poDays: 60 }).expect(200);
    const k = await keys();
    expect(k).not.toContain('grni-old'); // baru 20 hari
    expect(k).not.toContain('po-not-received');
    await http.put('/api/settings/reminders').set(as(owner)).send({ grniDays: 0 }).expect(400); // di luar batas
    await http.put('/api/settings/reminders').set(as(owner)).send({ grniDays: 14, poDays: 14 }).expect(200);
    expect(await keys()).toContain('grni-old');
    await http.put('/api/settings/reminders').set(as(owner)).send({ enabled: false }).expect(200);
    expect(await keys()).toEqual([]);
    await http.put('/api/settings/reminders').set(as(owner)).send({ enabled: true }).expect(200);
  });

  it('ringkasan harian: terkirim sekali sehari ke pemilik dan keuangan, hanya bila ada pengingat mendesak', async () => {
    sent.length = 0;
    const first = (await post('/api/reminders/digest/send').expect(201)).body;
    expect(first.sent).toBeGreaterThanOrEqual(2); // pemilik dan keuangan
    const toOwner = sent.find((m) => m.to === `rm-${stamp}@uji.id`)!;
    expect(toOwner.subject).toContain('hal perlu perhatian');
    expect(toOwner.paragraphs.join('\n')).toContain('faktur pelanggan lewat jatuh tempo');
    expect(sent.some((m) => m.to === `rm-w-${stamp}@uji.id`)).toBe(false); // gudang tidak menerima ringkasan
    // pengiriman terjadwal tidak mengulang pada hari yang sama
    sent.length = 0;
    const { ReminderMailer } = await import('../src/modules/reminders/reminder-mailer.service');
    const tenantId = (await get('/api/auth/me').expect(200)).body.tenantId;
    const again = await app.get(ReminderMailer).sendDigest(tenantId);
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(0);
    // matikan ringkasan email
    await http.put('/api/settings/reminders').set(as(owner)).send({ emailDigest: false }).expect(200);
    expect((await app.get(ReminderMailer).sendDigest(tenantId, { force: true })).sent).toBe(0);
    await http.put('/api/settings/reminders').set(as(owner)).send({ emailDigest: true }).expect(200);
    // contoh ke email sendiri
    sent.length = 0;
    const t = (await post('/api/reminders/digest/test').expect(201)).body;
    expect(t).toMatchObject({ sent: true, to: `rm-${stamp}@uji.id` });
  });

  it('pengingat tagihan ke pelanggan: tahap per selisih hari, otomatis sekali per tahap, manual sekali sehari', async () => {
    const cfg = { customerLeadDays: 3, customerRepeatDays: 7, customerMaxOverdue: 3 };
    expect([-5, -3, -1, 0, 1, 7, 8, 15, 22, 40].map((d) => customerStage(d, cfg))).toEqual([null, 'BEFORE', 'BEFORE', 'DUE', 'OVERDUE-1', 'OVERDUE-1', 'OVERDUE-2', 'OVERDUE-3', null, null]);
    expect(customerStage(-2, { ...cfg, customerLeadDays: 0 })).toBeNull();

    const tenantId = (await get('/api/auth/me').expect(200)).body.tenantId;
    const { ReminderMailer } = await import('../src/modules/reminders/reminder-mailer.service');
    const mailer = app.get(ReminderMailer);
    const inv = ((await get('/api/invoices').expect(200)).body as { id: string; customer: { name: string } }[])[0];
    // pelanggan belum punya email → ditolak dengan petunjuk
    const noMail = await post(`/api/reminders/invoices/${inv.id}/customer`);
    expect(noMail.status).toBe(400);
    expect(noMail.body.message).toContain('belum punya alamat email');
    const cust = ((await get('/api/customers').expect(200)).body as { id: string; code: string }[]).find((c) => c.code === 'C1')!;
    await http.patch(`/api/customers/${cust.id}`).set(as(owner)).send({ email: 'keuangan@pelanggan.co.id' }).expect(200);
    await http.patch(`/api/customers/${cust.id}`).set(as(owner)).send({ email: 'bukan-email' }).expect(400);

    // otomatis mati bawaan; setelah diaktifkan terkirim satu kali untuk tahap tunggakan saat ini
    sent.length = 0;
    expect((await mailer.runCustomerReminders(tenantId)).sent).toBe(0);
    await http.put('/api/settings/reminders').set(as(owner)).send({ customerReminders: true, customerMaxOverdue: 10 }).expect(200);
    const run1 = await mailer.runCustomerReminders(tenantId);
    expect(run1.sent).toBe(1);
    const toCust = sent.find((m) => m.to === 'keuangan@pelanggan.co.id')!;
    expect(toCust.subject).toContain('lewat jatuh tempo');
    expect(toCust.paragraphs.join(' ')).toContain('Yth. Toko Pelanggan Lambat');
    expect((await mailer.runCustomerReminders(tenantId)).sent).toBe(0); // tahap yang sama tidak dikirim ulang

    // manual: sekali sehari per faktur
    sent.length = 0;
    expect((await post(`/api/reminders/invoices/${inv.id}/customer`).expect(201)).body).toMatchObject({ sent: true, to: 'keuangan@pelanggan.co.id' });
    const dup = await post(`/api/reminders/invoices/${inv.id}/customer`);
    expect(dup.status).toBe(400);
    expect(dup.body.message).toContain('sudah dikirim hari ini');
    // bagian warehouse tidak boleh mengirim
    await http.post(`/api/reminders/invoices/${inv.id}/customer`).set(as(warehouseUser)).send({}).expect(403);
    await http.put('/api/settings/reminders').set(as(owner)).send({ customerReminders: false }).expect(200);
  });

  it('penjadwal melewati perusahaan demo (alamat fiktif, data sementara)', async () => {
    const db = app.get<Db>(DB);
    const tenantId = (await get('/api/auth/me').expect(200)).body.tenantId;
    const ids = async () => (await app.get(ReminderMailer).schedulableTenants()).map((r) => r.id);
    try {
      expect(await ids()).toContain(tenantId);
      await db.execute(sql`UPDATE tenants SET settings = settings || '{"demo": true}'::jsonb WHERE id = ${tenantId}`);
      expect(await ids()).not.toContain(tenantId);
    } finally {
      await db.execute(sql`UPDATE tenants SET settings = settings - 'demo' WHERE id = ${tenantId}`);
    }
    expect(await ids()).toContain(tenantId);
  });
});
