/**
 * Saldo awal: akun kontrol (piutang, utang, persediaan, ekuitas penyeimbang) tidak boleh diisi manual,
 * ringkasan kesiapan menunjukkan isi per kelompok dan peringatan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Saldo awal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  let acc: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Saldo Awal', name: 'Owner', email: `ob-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const list = (await get('/api/accounting/accounts').expect(200)).body as { code: string; id: string }[];
    acc = Object.fromEntries(list.map((a) => [a.code, a.id]));
  });
  afterAll(() => app.close());

  it('ringkasan kosong sebelum ada saldo awal', async () => {
    const s = (await get('/api/accounting/opening-balances/status').expect(200)).body;
    expect(s.openingDate).toBeNull();
    expect(s.components.cash.amount).toBe('0.00');
    expect(s.balancing).toBe('0.00');
  });

  it('menolak piutang, utang, dan ekuitas penyeimbang diisi manual', async () => {
    for (const code of ['1-1300', '2-1100']) {
      const r = await post('/api/accounting/opening-balances', { date: '2026-09-30', lines: [{ accountId: acc[code], debit: code === '1-1300' ? '1000' : '0', credit: code === '2-1100' ? '1000' : '0' }] });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/per faktur/);
    }
    const list = (await get('/api/accounting/accounts').expect(200)).body as { id: string; systemKey: string }[];
    const eq = list.find((a) => a.systemKey === 'OPENING_EQUITY')!;
    await post('/api/accounting/opening-balances', { date: '2026-09-30', lines: [{ accountId: eq.id, credit: '1000' }] }).expect(400);
  });

  it('saldo kas dan modal tercatat, penyeimbang dihitung, ringkasan akurat', async () => {
    await post('/api/accounting/opening-balances', {
      date: '2026-09-30',
      lines: [
        { accountId: acc['1-1100'], debit: '10000000' },
        { accountId: acc['1-1200'], debit: '5000000' },
      ],
    }).expect(201);
    const s = (await get('/api/accounting/opening-balances/status').expect(200)).body;
    expect(s.openingDate).toBe('2026-09-30');
    expect(s.components.cash.amount).toBe('15000000.00');
    expect(s.components.cash.accounts).toBe(2);
    expect(s.balancing).toBe('15000000.00'); // kredit ke Ekuitas Saldo Awal
    expect(s.warnings.join(' ')).not.toMatch(/kas\/bank/);
    expect(s.warnings.join(' ')).toMatch(/aset tetap/i);
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
  });

  it('memperingatkan bila sudah ada jurnal pada atau sebelum tanggal saldo awal', async () => {
    await post('/api/accounting/journals', {
      date: '2026-09-15',
      description: 'Transaksi lebih awal',
      lines: [
        { accountId: acc['1-1100'], debit: '100000' },
        { accountId: acc['3-1000'], credit: '100000' },
      ],
    }).expect(201);
    const s = (await get('/api/accounting/opening-balances/status').expect(200)).body;
    expect(s.warnings.join(' ')).toMatch(/pada\/sebelum tanggal saldo awal/);
  });

  it('hanya ADMIN/FINANCE yang dapat membaca ringkasan', async () => {
    const email = `ob-kasir-${stamp}@uji.id`;
    await post('/api/users', { name: 'Kasir', email, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    const t = (await http.post('/api/auth/login').send({ email, password: 'kasir12345' }).expect(200)).body.accessToken;
    await http.get('/api/accounting/opening-balances/status').set({ Authorization: `Bearer ${t}` }).expect(403);
  });
});
