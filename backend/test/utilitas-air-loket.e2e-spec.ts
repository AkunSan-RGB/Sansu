/**
 * Utilitas air: pendapatan air vs non-air, beberapa loket, penerimaan non-tunai (tanpa setoran kas), rekap harian per loket.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Utilitas air: loket & layanan non-air (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let fin: string; let fin2: string; let customer: string; let tariff: string;
  let connId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const put = (url: string, body: object = {}, t = owner) => http.put(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Air Loket', name: 'Pemilik', email: `air-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `air-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `air-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    fin2 = await mk('FINANCE', 'fin2');
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Siti', paymentTermDays: 20 }).expect(201)).body.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    connId = (await post('/api/utility/connections', { customerId: customer, tariffId: tariff, address: 'Blok 1', meterNo: 'MA-1', installedAt: `${month(4)}-05`, initialReading: '0' }, fin).expect(201)).body.id;
  });
  afterAll(() => app.close());

  let invoiceId: string;
  it('mode non-tunai bawaan: tunai ditolak, setoran kas ditolak', async () => {
    expect((await get('/api/utility/rules').expect(200)).body.cashless).toBe(true);
    await post('/api/utility/readings', { connectionId: connId, period: month(3), current: '10' }).expect(201);
    const ents = (await get(`/api/utility/readings?period=${month(3)}&status=ENTERED`, fin).expect(200)).body as { id: string }[];
    for (const e of ents) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/utility/billing/run', { period: month(3) }, fin).expect(201);
    const found = (await get('/api/utility/counter/search?q=Siti', fin).expect(200)).body as { invoiceId: string }[];
    invoiceId = found[0].invoiceId;
    expect((await post('/api/utility/counter/pay', { invoiceId, amount: '1000', method: 'CASH' }, fin)).status).toBe(400);
    expect((await post('/api/utility/counter/remit', { counted: '0' }, fin)).status).toBe(400);
  });

  let l1: string; let l2: string;
  it('master loket: beberapa lokasi, kode unik, hanya Admin/Keuangan', async () => {
    l1 = (await post('/api/utility/counters', { code: 'lkt-01', name: 'Loket Kantor Pusat', location: 'Jl. Merdeka 1' }, fin).expect(201)).body.id;
    l2 = (await post('/api/utility/counters', { code: 'LKT-02', name: 'Loket Pasar' }, fin).expect(201)).body.id;
    expect((await post('/api/utility/counters', { code: 'LKT-01', name: 'Dobel' }, fin)).status).toBe(409);
    expect((await get('/api/utility/counters', fin).expect(200)).body).toHaveLength(2);
  });

  it('penerimaan non-tunai wajib memilih loket; kanal dicatat; rekap per loket per hari', async () => {
    expect((await post('/api/utility/counter/pay', { invoiceId, amount: '1000' }, fin)).status).toBe(400); // loket belum dipilih
    const r1 = (await post('/api/utility/counter/pay', { invoiceId, amount: '5000', counterId: l1, channel: 'QRIS' }, fin).expect(201)).body;
    expect(r1.channel).toBe('QRIS');
    await post('/api/utility/counter/pay', { invoiceId, amount: '3000', counterId: l2, channel: 'VA' }, fin).expect(201);
    const recap = (await get(`/api/utility/counter/recap?from=${today}&to=${today}`, fin).expect(200)).body;
    expect(recap.days).toHaveLength(1);
    expect(recap.days[0].counters).toHaveLength(2);
    expect(Number(recap.total)).toBe(8000);
    const s = (await get('/api/utility/summary', fin).expect(200)).body;
    expect(Number(s.receiptsToday)).toBe(8000);
    expect(s.counters).toBe(2);
  });

  it('konfirmasi rekap: bukan oleh penerima; satu kali; sengketa wajib catatan', async () => {
    expect((await post('/api/utility/counter/close-day', { counterId: l1, date: today }, fin)).status).toBe(403);
    expect((await post('/api/utility/counter/close-day', { counterId: l1, date: today, dispute: true }, fin2)).status).toBe(400);
    await post('/api/utility/counter/close-day', { counterId: l1, date: today }, fin2).expect(201);
    expect((await post('/api/utility/counter/close-day', { counterId: l1, date: today }, fin2)).status).toBe(409);
    const recap = (await get(`/api/utility/counter/recap?from=${today}&to=${today}`, fin).expect(200)).body;
    const c1 = recap.days[0].counters.find((c: { counterId: string }) => c.counterId === l1);
    expect(c1.closing.status).toBe('CONFIRMED');
  });

  it('layanan non-air: katalog bawaan, terbitkan faktur ke akun pendapatan non-air, tampil di laporan', async () => {
    const list = (await get('/api/utility/charges', fin).expect(200)).body as { id: string; name: string; revenueKey: string }[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    const sambung = list.find((c) => c.revenueKey === 'UTILITY_CONNECTION_REVENUE')!;
    const inv = (await post('/api/utility/charges/issue', { chargeId: sambung.id, customerId: customer, connectionId: connId }, fin).expect(201)).body;
    expect(Number(inv.amount)).toBeGreaterThan(0);
    const rep = (await get(`/api/accounting/support/utility?from=${month(4)}-01&to=${today}`, fin).expect(200)).body;
    const split = rep.sections.find((x: { key: string }) => x.key === 'util-revenue-split');
    expect(split).toBeTruthy();
    const nonAir = split.tables[1].rows.find((r: unknown[]) => r[0] === 'Biaya sambung baru');
    expect(Number(nonAir[1])).toBeGreaterThan(0);
    const air = split.tables[0].rows.reduce((a: number, r: unknown[]) => a + Number(r[1]), 0);
    expect(air).toBeGreaterThan(0);
    expect(rep.sections.find((x: { key: string }) => x.key === 'util-counters').tables[0].rows.length).toBe(2);
    const s = (await get('/api/utility/summary', fin).expect(200)).body;
    expect(Number(s.revenueAir)).toBeGreaterThanOrEqual(0);
  });

  it('mode tunai dapat diaktifkan kembali oleh Admin saja', async () => {
    expect((await put('/api/utility/rules', { cashless: false }, fin)).status).toBe(403);
    await put('/api/utility/rules', { cashless: false }).expect(200);
    expect((await get('/api/utility/rules').expect(200)).body.cashless).toBe(false);
  });
});
