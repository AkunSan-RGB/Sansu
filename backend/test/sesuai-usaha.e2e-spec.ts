/**
 * Fitur kontrol menyesuaikan jenis usaha (e2e): aturan bank bawaan, akun anggaran yang disarankan, dan ambang temuan kontrol
 * berbeda untuk ritel vs jasa.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol sesuai jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);

  const tenant = async (model: string, tag: string) => {
    const owner = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `su-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
    await post(owner, '/api/users', { name: 'Keuangan', email: `su-f-${tag}-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    const finance = (await http.post('/api/auth/login').send({ email: `su-f-${tag}-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken as string;
    const accs = (await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    return { owner, finance, bankId: accs.find((a) => a.code === '1-1200')!.id };
  };
  let ritel: Awaited<ReturnType<typeof tenant>>;
  let jasa: Awaited<ReturnType<typeof tenant>>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    ritel = await tenant('RITEL', 'ritel');
    jasa = await tenant('JASA', 'jasa');
  });
  afterAll(() => app.close());

  it('aturan bank bawaan berbeda per usaha; hanya Admin/Pemilik; tidak ganda', async () => {
    await post(ritel.finance, '/api/bank/rules/defaults').expect(403);
    const r = (await post(ritel.owner, '/api/bank/rules/defaults').expect(201)).body;
    expect(r.model).toBe('RITEL');
    expect(r.added).toBeGreaterThanOrEqual(4);
    expect((await post(ritel.owner, '/api/bank/rules/defaults').expect(201)).body.added).toBe(0);
    const rr = ((await get(ritel.owner, '/api/bank/rules').expect(200)).body as { keyword: string }[]).map((x) => x.keyword);
    expect(rr).toContain('MDR');
    await post(jasa.owner, '/api/bank/rules/defaults').expect(201);
    const jr = ((await get(jasa.owner, '/api/bank/rules').expect(200)).body as { keyword: string }[]).map((x) => x.keyword);
    expect(jr).not.toContain('MDR');
    expect(jr).toContain('SUBSCRIPTION');
    // aturan bawaan bekerja: biaya MDR toko langsung dijurnal
    const st = (await post(ritel.finance, '/api/bank/statements', { cashAccountId: ritel.bankId, lines: [{ date: addDays(todayJakarta(), -3), description: 'MDR QRIS SETTLEMENT', amount: '-21000' }] }).expect(201)).body;
    expect(st.lines[0].status).toBe('CREATED');
  });

  it('akun anggaran yang disarankan mengikuti jenis usaha', async () => {
    const names = async (t: { owner: string }) => {
      const sug = (await get(t.owner, '/api/budgets/suggested').expect(200)).body as { model: string; accountIds: string[] };
      const grid = (await get(t.owner, `/api/budgets/${new Date().getFullYear()}`).expect(200)).body as { accounts: { id: string; code: string }[] };
      return { model: sug.model, codes: grid.accounts.filter((a) => sug.accountIds.includes(a.id)).map((a) => a.code) };
    };
    const r = await names(ritel);
    const j = await names(jasa);
    expect(r.model).toBe('RITEL');
    expect(r.codes).toEqual(expect.arrayContaining(['5-1000', '6-2450']));
    expect(r.codes).not.toContain('5-1600');
    expect(j.codes).toEqual(expect.arrayContaining(['5-1600', '5-1700']));
    expect(j.codes).not.toContain('6-2450');
  });

  it('ambang temuan kontrol berbeda: uang keluar bank 3 hari belum tercatat dilaporkan toko, belum untuk jasa', async () => {
    const line = [{ date: addDays(todayJakarta(), -3), description: 'TRSF KELUAR TAK DIKENAL', amount: '-750000' }];
    await post(jasa.finance, '/api/bank/statements', { cashAccountId: jasa.bankId, lines: line }).expect(201);
    await post(ritel.finance, '/api/bank/statements', { cashAccountId: ritel.bankId, lines: line }).expect(201);
    const keys = async (t: { owner: string }) => ((await get(t.owner, '/api/bank/controls').expect(200)).body as { items: { key: string }[] }).items.map((i) => i.key);
    expect(await keys(ritel)).toContain('BANK_OUT_UNRECORDED'); // toko: > 2 hari
    expect(await keys(jasa)).not.toContain('BANK_OUT_UNRECORDED'); // jasa: > 5 hari
    // kontrol pembelian untuk jasa tidak memuat temuan stok/pengiriman
    const pj = ((await get(jasa.owner, '/api/purchase-controls').expect(200)).body as { items: { key: string }[] }).items.map((i) => i.key);
    expect(pj).not.toContain('ADJ_OUT_REPEAT');
    expect(pj).not.toContain('DELIVERY_NOT_BILLED');
    expect(pj).not.toContain('GRNI_OLD');
  });
});
