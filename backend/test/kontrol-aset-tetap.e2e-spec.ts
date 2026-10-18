/**
 * Kontrol aset tetap lanjutan (e2e): metode penyusutan baru, banner pengaman, pelepasan janggal, pemberitahuan Pemilik, jejak audit perubahan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, type Db } from '../src/db/db';

describe('Kontrol aset tetap lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let acct: string; let categoryId: string; let tenantId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const wait = () => new Promise((r) => setTimeout(r, 400));
  const newAsset = async (name: string, extra: object = {}) =>
    (await post(owner, '/api/assets', { name, categoryId, acquisitionDate: addDays(day, -20), cost: '6000000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'EXISTING', ...extra }).expect(201)).body.id as string;
  const items = async () => (await get(owner, '/api/assets/controls').expect(200)).body as { items: { key: string; assetIds: string[] }[]; setup: { active: boolean; recommended: object } };

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Aset Lanjut', name: 'P', email: `at-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    tenantId = (await get(owner, '/api/auth/me').expect(200)).body.tenantId;
    await post(owner, '/api/users', { name: 'akn', email: `at-akn-${stamp}@uji.id`, password: 'rahasia12345', role: 'ACCOUNTANT' }).expect(201);
    acct = (await http.post('/api/auth/login').send({ email: `at-akn-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 999004, type: 'private' } } });
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; method: string; accumulatedAccountId: string | null }[];
    categoryId = cats.find((c) => c.method !== 'NONE' && c.accumulatedAccountId)!.id;
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('metode penyusutan baru diterima; metode asing ditolak', async () => {
    await newAsset('Mesin Jumlah Angka Tahun', { method: 'SUM_OF_YEARS' });
    await newAsset('Mesin Saldo 1,5', { method: 'DECLINING_BALANCE_150' });
    await post(owner, '/api/assets', { name: 'X', categoryId, acquisitionDate: day, cost: '1000000', method: 'ASAL', funding: 'EXISTING' }).expect(400);
  });

  it('pelepasan janggal oleh Akuntan: Pemilik diberi tahu; muncul sebagai temuan', async () => {
    const id = await newAsset('Laptop Dilepas Cepat');
    const before = tg.outbox.length;
    await post(acct, `/api/assets/${id}/dispose`, { date: day, price: '0' }).expect(201);
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '999004');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Aset dilepas');
    const k = (await items()).items.map((i) => i.key);
    expect(k).toEqual(expect.arrayContaining(['DISPOSE_QUICK', 'DISPOSE_LOW_PRICE']));
  });

  it('banner pengaman belum aktif; setelah rekomendasi, pelepasan oleh Akuntan menunggu persetujuan', async () => {
    const c = await items();
    expect(c.setup.active).toBe(false);
    await http.put('/api/approvals/policy').set(as(owner)).send(c.setup.recommended).expect(200);
    expect((await items()).setup.active).toBe(true);
    const id = await newAsset('Mesin Dilepas Setelah Aktif');
    const r = await post(acct, `/api/assets/${id}/dispose`, { date: day, price: '5000000' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
  });

  it('perubahan penanggung jawab tercatat di jejak audit (dari → ke)', async () => {
    const id = await newAsset('Mesin Berpindah Tangan');
    await http.patch(`/api/assets/${id}`).set(as(acct)).send({ custodian: 'Budi' }).expect(200);
    await http.patch(`/api/assets/${id}`).set(as(acct)).send({ custodian: 'Sari' }).expect(200);
    const rows = (await app.get<Db>(DB).execute<{ data: { custodian: { from: string | null; to: string } } }>(sql`
      SELECT data FROM audit_logs WHERE tenant_id = ${tenantId} AND entity = 'FixedAsset' AND entity_id = ${id} AND action = 'UPDATE' ORDER BY created_at`)).rows;
    expect(rows.length).toBe(2);
    expect(rows[1].data.custodian).toEqual({ from: 'Budi', to: 'Sari' });
  });
});
