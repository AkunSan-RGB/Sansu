/** Notifikasi Telegram: penautan akun lewat bot, notifikasi persetujuan, pemutusan (tanpa panggilan jaringan; pesan ditampung di outbox) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { verifyApprovalLink } from '../src/common/approvals/approval-link';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { DB, Db } from '../src/db/db';
import { auditLogs, users } from '../src/db/schema';

describe('Notifikasi Telegram (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let db: Db;
  let owner: string;
  let ownerId: string;
  let finance: string;
  let wh: string;
  let sup: string;
  let prod: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const start = (code: string, chat = 555, type = 'private') => tg.handleUpdate({ update_id: Math.floor(Math.random() * 1e9), message: { text: `/start ${code}`, chat: { id: chat, type } } });
  const approvalPing = async (finTotal: number) => {
    const po = (await post(finance, '/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '1', price: String(finTotal) }] }).expect(201)).body;
    const before = tg.outbox.length;
    await post(finance, `/api/purchase-orders/${po.id}/confirm`).expect(409);
    await new Promise((r) => setTimeout(r, 400)); // notifikasi dikirim di latar belakang
    return tg.outbox.slice(before);
  };

  beforeAll(async () => {
    process.env.TEST_THROTTLE = '1'; // batas laju aktif untuk menguji pembatasan pembuatan tautan
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    process.env.TELEGRAM_BOT_USERNAME = '@sansu_uji_bot';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Telegram', name: 'Pemilik', email: `tg-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    ownerId = (await get(owner, '/api/auth/me').expect(200)).body.id;
    await post(owner, '/api/users', { name: 'Keuangan', email: `tg-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `tg-f-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    sup = (await post(owner, '/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    prod = (await post(owner, '/api/products', { sku: 'MIE', name: 'Mie', sellPrice: '3500' }).expect(201)).body.id;
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 1_000_000 }).expect(200);
  });
  afterAll(async () => {
    delete process.env.TEST_THROTTLE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    await app.close();
  });

  it('belum terhubung: tidak ada notifikasi Telegram (email tetap jalur utama)', async () => {
    expect((await get(owner, '/api/auth/telegram').expect(200)).body).toEqual({ enabled: true, botUsername: 'sansu_uji_bot', linked: false });
    expect(await approvalPing(2_000_000)).toHaveLength(0);
  });

  it('menghubungkan: tautan t.me berisi kode; kode salah, grup, dan kedaluwarsa ditolak; kode sekali pakai', async () => {
    const l = (await post(owner, '/api/auth/telegram/link').expect(201)).body;
    expect(l.url).toBe(`https://t.me/sansu_uji_bot?start=${l.code}`);
    expect(l.code.length).toBeLessThanOrEqual(64);
    await start(l.code, 777, 'group'); // grup diabaikan
    expect((await get(owner, '/api/auth/telegram')).body.linked).toBe(false);
    await start('kode-salah');
    expect(tg.outbox.at(-1)?.text).toMatch(/tidak valid/);
    // kode disimpan sebagai hash, bukan teks asli
    const [row] = await db.select({ c: users.telegramLinkCode }).from(users).where(eq(users.id, ownerId));
    expect(row.c).not.toBe(l.code);
    expect(row.c).toMatch(/^[0-9a-f]{64}$/);
    await db.update(users).set({ telegramLinkExpires: new Date(Date.now() - 1000) }).where(eq(users.id, ownerId));
    await start(l.code);
    expect(tg.outbox.at(-1)?.text).toMatch(/tidak valid atau sudah kedaluwarsa/);
    const l2 = (await post(owner, '/api/auth/telegram/link').expect(201)).body;
    await start(l2.code, 555);
    expect(tg.outbox.at(-1)).toMatchObject({ chatId: '555' });
    expect(tg.outbox.at(-1)?.text).toMatch(/Terhubung/);
    expect((await get(owner, '/api/auth/telegram')).body.linked).toBe(true);
    await start(l2.code, 556); // kode sudah terpakai
    expect(tg.outbox.at(-1)?.text).toMatch(/tidak valid/);
    expect((await get(owner, '/api/auth/telegram')).body.linked).toBe(true);
  });

  it('permintaan persetujuan: pemberi persetujuan yang terhubung mendapat pesan dengan tautan pribadi; pemohon tidak', async () => {
    const msgs = await approvalPing(3_000_000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].chatId).toBe('555');
    expect(msgs[0].text).toMatch(/Perlu persetujuan/);
    expect(msgs[0].text).toMatch(/\/approve\/[\w-]+\.[\w-]+/);
    // finance tidak punya Telegram terhubung dan bukan pemberi persetujuan: tidak ada pesan lain
    expect(msgs.every((m) => m.chatId === '555')).toBe(true);
  });

  it('putuskan lewat aplikasi atau /stop: notifikasi berhenti', async () => {
    await http.delete('/api/auth/telegram').set(as(owner)).expect(200);
    expect((await get(owner, '/api/auth/telegram')).body.linked).toBe(false);
    expect(await approvalPing(4_000_000)).toHaveLength(0);
    const l = (await post(owner, '/api/auth/telegram/link').expect(201)).body;
    await start(l.code, 555);
    await tg.handleUpdate({ update_id: 1, message: { text: '/stop', chat: { id: 555, type: 'private' } } });
    expect((await get(owner, '/api/auth/telegram')).body.linked).toBe(false);
    expect(await approvalPing(5_000_000)).toHaveLength(0);
  });

  it('masa berlaku tautan Telegram mengikuti pengaturan perusahaan (1–72 jam); validasi rentang', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ telegramLinkHours: 0 }).expect(400);
    await http.put('/api/approvals/policy').set(as(owner)).send({ telegramLinkHours: 73 }).expect(400);
    await http.put('/api/approvals/policy').set(as(owner)).send({ telegramLinkHours: 6 }).expect(200);
    expect((await get(owner, '/api/approvals/policy').expect(200)).body.telegramLinkHours).toBe(6);
    const l = (await post(owner, '/api/auth/telegram/link').expect(201)).body;
    await start(l.code, 888);
    const msgs = await approvalPing(6_000_000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toMatch(/berlaku 6 jam/);
    const token = msgs[0].text.match(/\/approve\/([\w.-]+)/)![1];
    const p = verifyApprovalLink(token)!;
    const hours = (p.exp - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(5.9);
    expect(hours).toBeLessThanOrEqual(6);
    // pengaturan 72 jam = bawaan
    await http.put('/api/approvals/policy').set(as(owner)).send({ telegramLinkHours: 72 }).expect(200);
    const again = await approvalPing(7_000_000);
    expect(again[0].text).toMatch(/berlaku 72 jam/);
  });

  it('keamanan: percobaan kode salah dibatasi per chat, nonaktif/ganti peran/reset sandi memutus Telegram, tautan dibatasi laju, jejak audit', async () => {
    const before = tg.outbox.length;
    for (let i = 0; i < 12; i++) await start(`salah-${i}`, 999);
    expect(tg.outbox.length - before).toBe(8); // setelah 8 percobaan salah bot diam
    // pengguna keuangan menghubungkan lalu dinonaktifkan: chat diputus
    const fin = (await get(owner, '/api/users').expect(200)).body.find((u: { role: string }) => u.role === 'FINANCE');
    await db.update(users).set({ telegramChatId: '321' }).where(eq(users.id, fin.id));
    await http.patch(`/api/users/${fin.id}`).set(as(owner)).send({ role: 'WAREHOUSE' }).expect(200);
    const [after] = await db.select({ c: users.telegramChatId }).from(users).where(eq(users.id, fin.id));
    expect(after.c).toBeNull();
    // penghubungan dan pemutusan tercatat di jejak audit
    const l = (await post(owner, '/api/auth/telegram/link').expect(201)).body;
    await start(l.code, 654);
    await http.delete('/api/auth/telegram').set(as(owner)).expect(200);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.userId, ownerId))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['TELEGRAM_LINK', 'TELEGRAM_UNLINK']));
    // pembuatan tautan dibatasi laju
    let limited = 0;
    for (let i = 0; i < 8; i++) if ((await post(owner, '/api/auth/telegram/link')).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});
