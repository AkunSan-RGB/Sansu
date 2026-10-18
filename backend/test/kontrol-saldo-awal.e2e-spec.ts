/**
 * Kontrol saldo awal (e2e): Pemilik diberi tahu bila saldo awal dicatat orang lain, tercatat di jejak audit,
 * dan cek kesehatan menandai saldo awal yang dicatat berkali-kali (kondisi 'jauh setelah transaksi berjalan' tidak diuji karena jurnal tidak bisa diubah tanggal buatnya).
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

describe('Kontrol saldo awal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let acct: string; let cash: string; let equity: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const check = async () => ((await get(owner, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[]).find((c) => c.key === 'opening-balance');
  const open = () => post(acct, '/api/accounting/opening-balances', { date: addDays(todayJakarta(), -100), lines: [{ accountId: cash, debit: '5000000' }] }).expect(201);
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Saldo Awal', name: 'P', email: `sa-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'akn', email: `sa-akn-${stamp}@uji.id`, password: 'rahasia12345', role: 'ACCOUNTANT' }).expect(201);
    acct = (await http.post('/api/auth/login').send({ email: `sa-akn-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 999003, type: 'private' } } });
    const accs = (await get(owner, '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    cash = accs.find((a) => a.code === '1-1100')!.id;
    equity = accs.find((a) => a.code === '3-1000')!.id;
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('saldo awal oleh Akuntan: Pemilik diberi tahu, tercatat di audit, cek kesehatan OK', async () => {
    const before = tg.outbox.length;
    await open();
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '999003');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Saldo awal');
    const tenantId = (await get(owner, '/api/auth/me').expect(200)).body.tenantId;
    const rows = (await app.get<Db>(DB).execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'OpeningBalance' AND tenant_id = ${tenantId}`)).rows;
    expect(rows[0].n).toBe(1);
    expect((await check())?.status).toBe('OK');
  });

  it('saldo awal dicatat berkali-kali ditandai', async () => {
    await open();
    expect((await check())?.status).toBe('OK'); // dua kali masih wajar (koreksi)
    await open();
    expect((await check())?.status).toBe('WARN');
  });
});
