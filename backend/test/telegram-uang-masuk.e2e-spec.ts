/** Uang masuk di luar penjualan dikabarkan ke Keuangan lewat Telegram secara real-time (pesan ditampung di outbox saat uji) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ReminderMailer } from '../src/modules/reminders/reminder-mailer.service';
import { TelegramService } from '../src/common/telegram/telegram.service';

describe('Telegram uang masuk non-penjualan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let fin: string; let finId: string; let kasId: string; let bankId: string;
  const stamp = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Tele Kas', name: 'P', email: `tk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'fin', email: `tk-f-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `tk-f-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    finId = (await get('/api/auth/me', fin).expect(200)).body.id;
    const link = (await post('/api/auth/telegram/link', {}, fin)).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 777001, type: 'private' } } });
    const accs = (await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    kasId = accs.find((a) => a.code === '1-1100')!.id;
    bankId = accs.find((a) => a.code === '1-1200')!.id;
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('kas masuk non-penjualan oleh pemilik → Telegram Keuangan', async () => {
    expect(finId).toBeTruthy();
    const before = tg.outbox.length;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: kasId, date: today, description: 'Setoran modal', reference: 'B-1', lines: [{ source: 'OWNER_CAPITAL', amount: '2000000' }] }).expect(201);
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '777001');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Uang masuk non-penjualan');
    expect(m[0].text).toContain('2.000.000');
  });

  it('pelaku Keuangan sendiri tidak dikirimi; mutasi bank masuk yang belum cocok dikabarkan saat impor', async () => {
    let before = tg.outbox.length;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: kasId, date: today, description: 'Bunga', lines: [{ source: 'INTEREST', amount: '10000' }] }, fin).expect(201);
    await wait();
    expect(tg.outbox.slice(before).filter((x) => x.chatId === '777001').length).toBe(0);

    before = tg.outbox.length;
    await post('/api/bank/statements', { cashAccountId: bankId, fileName: 'x.csv', lines: [{ date: today, description: 'TRSF MASUK TIDAK DIKENAL', amount: '350000' }] }).expect(201);
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '777001');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('belum jelas sumbernya');
  });

  it('pembayaran pelanggan tidak bisa dibelokkan jadi pendapatan lain oleh Keuangan', async () => {
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await post('/api/products', { sku: 'A1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const cust = (await post('/api/customers', { code: 'C1', name: 'Budi Santoso' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '100', unitCost: '5000' }] }).expect(201);
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '2' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id, date: today }).expect(201)).body;
    const total = (await get(`/api/invoices/${inv.id}`).expect(200)).body.total as string;
    const other = (amount: string, description: string, t = fin) => post('/api/cash/transactions', { type: 'IN', cashAccountId: kasId, date: today, description, reference: 'Nota-1', lines: [{ source: 'OTHER_INCOME', amount }] }, t);
    // jumlah sama dengan sisa piutang → ditolak untuk Keuangan
    const r1 = await other(total, 'Terima uang');
    expect(r1.status).toBe(400);
    expect(JSON.stringify(r1.body)).toContain('Faktur & piutang');
    // menyebut nama pelanggan → ditolak
    expect((await other('12345', 'pelunasan BUDI SANTOSO')).status).toBe(400);
    // uang masuk lain yang tidak mirip → boleh
    expect((await other('12345', 'Komisi supplier')).status).toBe(201);
    // pemilik boleh, tetapi ditandai di jejak audit
    expect((await other(total, 'Terima uang', owner)).status).toBe(201);
    const audit = (await get('/api/audit?action=CASH_IN_LOOKALIKE_RECEIVABLE').then((r) => JSON.stringify(r.body)));
    expect(audit).toContain('CASH_IN_LOOKALIKE_RECEIVABLE');
  });

  it('eskalasi: uang masuk rekening >1 hari belum dijelaskan dikabarkan ke Pemilik sekali per hari', async () => {
    const tenantId = (await get('/api/auth/me').expect(200)).body.tenantId as string;
    const mailer = app.get(ReminderMailer);
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() - 2 * 86400_000));
    await post('/api/bank/statements', { cashAccountId: bankId, fileName: 'lama.csv', lines: [{ date: yesterday, description: 'SETORAN TUNAI MISTERIUS', amount: '777000' }] }).expect(201);
    expect((await mailer.runBankEscalation(tenantId)).notified).toBe(true);
    expect((await mailer.runBankEscalation(tenantId)).notified).toBe(false); // sekali per hari
  });
});
