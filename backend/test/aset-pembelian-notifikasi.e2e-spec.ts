/**
 * Aset: Pemilik diberi tahu bila aset besar didaftarkan/dibeli orang lain, dan pembelian berulang tepat di bawah batas kapitalisasi ditandai.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Aset: pemberitahuan pembelian & pemecahan di bawah batas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let acct: string; let fin: string; let supplierId: string; let categoryId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const wait = () => new Promise((r) => setTimeout(r, 400));
  let n = 0;
  const bill = (t: string, lines: object[]) => post(t, '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `AP-${stamp}-${++n}`, date: day, lines });
  const line = (description: string, price: string) => ({ type: 'ASSET', description, assetCategoryId: categoryId, price, qty: '1' });
  const toOwner = (from: number) => tg.outbox.slice(from).filter((x) => x.chatId === '999005');

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Beli Aset', name: 'P', email: `ba-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'akn', email: `ba-akn-${stamp}@uji.id`, password: 'rahasia12345', role: 'ACCOUNTANT' }).expect(201);
    acct = (await http.post('/api/auth/login').send({ email: `ba-akn-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    await post(owner, '/api/users', { name: 'fin', email: `ba-fin-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `ba-fin-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 999005, type: 'private' } } });
    supplierId = (await post(owner, '/api/suppliers', { code: 'SUP-BA', name: 'Toko Elektronik' }).expect(201)).body.id;
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; name: string; method: string; accumulatedAccountId: string | null }[];
    categoryId = cats.find((c) => c.name === 'Inventaris Kantor' || (c.method !== 'NONE' && c.accumulatedAccountId))!.id;
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('aset ≥ Rp5 juta didaftarkan Akuntan: Pemilik diberi tahu; yang kecil tidak', async () => {
    const before = tg.outbox.length;
    await post(acct, '/api/assets', { name: 'Mesin Besar', categoryId, acquisitionDate: day, cost: '8000000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'PAYABLE' }).expect(201);
    await post(acct, '/api/assets', { name: 'Rak Kecil', categoryId, acquisitionDate: day, cost: '1000000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'PAYABLE' }).expect(201);
    await wait();
    const m = toOwner(before);
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Mesin Besar');
  });

  it('faktur pembelian dengan aset besar oleh Keuangan: Pemilik diberi tahu; Pemilik sendiri tidak', async () => {
    const before = tg.outbox.length;
    await bill(owner, [line('Laptop Direktur', '9000000')]).expect(201);
    await wait();
    expect(toOwner(before).length).toBe(0);
    await bill(fin, [line('Laptop Staf', '9500000')]).expect(201);
    await wait();
    const m = toOwner(before);
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Laptop Staf');
  });

  it('pembelian berulang tepat di bawah batas kapitalisasi pada pemasok yang sama ditandai', async () => {
    await http.patch('/api/settings/reporting').set(as(owner)).send({ capitalizationThreshold: 3_000_000 }).expect(200);
    const keys = async () => ((await get(owner, '/api/assets/controls').expect(200)).body.items as { key: string }[]).map((i) => i.key);
    await bill(owner, [line('Printer A', '2800000')]).expect(201);
    expect(await keys()).not.toContain('ASSET_SPLIT'); // baru satu
    await bill(owner, [line('Printer B', '2900000')]).expect(201);
    expect(await keys()).toContain('ASSET_SPLIT');
  });
});
