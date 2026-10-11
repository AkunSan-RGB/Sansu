/** Notifikasi Telegram: penautan akun lewat bot, notifikasi persetujuan, pemutusan (tanpa panggilan jaringan; pesan ditampung di outbox) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { DB, Db } from '../src/db/db';
import { users } from '../src/db/schema';

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
    await db.update(users).set({ telegramLinkExpires: new Date(Date.now() - 1000) }).where(eq(users.id, ownerId));
    await start(l.code);
    expect(tg.outbox.at(-1)?.text).toMatch(/kedaluwarsa/);
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
});
