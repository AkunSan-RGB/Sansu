/**
 * Kontrol penjualan aktif (e2e): harga di bawah harga pokok butuh persetujuan (menutup celah batas diskon lewat harga yang diketik),
 * Pemilik diberi tahu (Telegram) saat Admin melewati batas, dan status "belum aktif" terbaca oleh halaman Kontrol penjualan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../src/db/db';
import { auditLogs } from '../src/db/schema';
import { TelegramService } from '../src/common/telegram/telegram.service';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kontrol penjualan aktif (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tg: TelegramService;
  let owner: string; let adm: string; let sls: string; let fin: string; let wh: string;
  let whId: string; let prod: string; let cust: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ksl3-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `ksl3-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const draft = async (t: string, qty: string, price?: string) =>
    (await post(t, '/api/sales-orders', { customerId: cust, warehouseId: whId, date: day, lines: [{ productId: prod, qty, ...(price ? { price } : {}) }] }).expect(201)).body as { id: string; number: string; lines: { id: string }[] };
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'uji-token';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tg = app.get(TelegramService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Jual 3', name: 'P', email: `ksl3-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    adm = await login('ADMIN', 'adm');
    sls = await login('SALES', 'sls');
    fin = await login('FINANCE', 'fin');
    wh = await login('WAREHOUSE', 'wh');
    const link = (await post(owner, '/api/auth/telegram/link', {})).body as { code: string };
    await tg.handleUpdate({ update_id: 1, message: { text: `/start ${link.code}`, chat: { id: 888001, type: 'private' } } });
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'KSL3-1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    cust = (await post(owner, '/api/customers', { code: 'C-KSL3', name: 'Pelanggan Tiga' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: whId, reason: 'OPENING', date: day, lines: [{ productId: prod, qty: '500', unitCost: '5000' }] }).expect(201);
  });
  afterAll(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await app.close();
  });

  it('status kebijakan terbaca halaman: belum aktif sampai ambang diisi', async () => {
    const before = (await get(owner, '/api/sales-controls').expect(200)).body.policy;
    expect(before).toMatchObject({ salesOrder: 0, salesDiscountMaxPct: 0, salesReturn: 0, salesBelowCost: false });
    await put(owner, '/api/approvals/policy', { salesOrder: 50_000_000, salesDiscountMaxPct: 15, salesReturn: 5_000_000, salesBelowCost: true }).expect(200);
    expect((await get(owner, '/api/sales-controls').expect(200)).body.policy).toMatchObject({ salesBelowCost: true, salesDiscountMaxPct: 15 });
  });

  it('harga diketik di bawah harga pokok (diskon 0%) ditahan untuk Sales; harga wajar lolos', async () => {
    const ok = await draft(sls, '2', '9000');
    await post(sls, `/api/sales-orders/${ok.id}/confirm`).expect(201);
    const rugi = await draft(sls, '2', '3000'); // pokok 5.000
    const r = await post(sls, `/api/sales-orders/${rugi.id}/confirm`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    expect((await get(owner, `/api/sales-orders/${rugi.id}`).expect(200)).body.status).toBe('CONFIRMED');
  });

  it('Admin melewati batas: tidak ditahan, tetapi Pemilik diberi tahu lewat Telegram dan tercatat', async () => {
    const rugi = await draft(adm, '2', '3000');
    const before = tg.outbox.length;
    await post(adm, `/api/sales-orders/${rugi.id}/confirm`).expect(201);
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '888001');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('tanpa persetujuan terpisah');
    expect(m[0].text).toContain('di bawah harga pokok');
    const rows = await app.get<Db>(DB).select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'CONFIRM_RISKY'));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('retur besar oleh Admin: Pemilik diberi tahu', async () => {
    const so = await draft(sls, '4', '9000');
    await post(sls, `/api/sales-orders/${so.id}/confirm`).expect(201);
    await post(wh, `/api/sales-orders/${so.id}/deliver`, {}).expect(201);
    const inv = (await post(fin, '/api/invoices', { salesOrderId: so.id, date: day }).expect(201)).body;
    const full = (await get(owner, `/api/invoices/${inv.id}`).expect(200)).body as { lines: { id: string }[] };
    await put(owner, '/api/approvals/policy', { salesReturn: 1000 }).expect(200);
    const before = tg.outbox.length;
    await post(adm, '/api/sales-returns', { invoiceId: inv.id, date: day, reason: 'Rusak', lines: [{ invoiceLineId: full.lines[0].id, qty: '1' }] }).expect(201);
    await wait();
    const m = tg.outbox.slice(before).filter((x) => x.chatId === '888001');
    expect(m.length).toBe(1);
    expect(m[0].text).toContain('Retur penjualan');
  });
});
