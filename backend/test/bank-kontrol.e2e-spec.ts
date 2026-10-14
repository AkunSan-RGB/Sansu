/**
 * Bank: otomatisasi & anti-fraud (e2e): integritas file mutasi, anti catat ganda, aturan kategori otomatis,
 * larangan menyembunyikan uang keluar, hapus rekening koran terkontrol, pengesahan rekonsiliasi oleh orang lain, temuan kontrol.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Bank: kontrol & otomatisasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let acct: string;
  let adm: string;
  let bankId: string;
  let expenseId: string;
  let equityId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const day = (n: number) => addDays(todayJakarta(), -n);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Bank Kontrol', name: 'Pemilik', email: `bk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `bk-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `bk-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    await post(owner, '/api/users', { name: 'Akuntan', email: `bk-akn-${stamp}@uji.id`, password: 'akuntan123', role: 'ACCOUNTANT' }).expect(201);
    acct = (await http.post('/api/auth/login').send({ email: `bk-akn-${stamp}@uji.id`, password: 'akuntan123' }).expect(200)).body.accessToken;
    await post(owner, '/api/users', { name: 'Admin', email: `bk-adm-${stamp}@uji.id`, password: 'admin12345', role: 'ADMIN' }).expect(201);
    adm = (await http.post('/api/auth/login').send({ email: `bk-adm-${stamp}@uji.id`, password: 'admin12345' }).expect(200)).body.accessToken;
    const accs = (await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    bankId = accs.find((a) => a.code === '1-1200')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
  });
  afterAll(() => app.close());

  it('file yang saldonya tidak konsisten ditolak', async () => {
    const bad = await post(finance, '/api/bank/statements', { cashAccountId: bankId, openingBalance: '1000000', closingBalance: '5000000', lines: [{ date: day(20), description: 'SETOR', amount: '500000' }] }).expect(400);
    expect(bad.body.code).toBe('BANK_STATEMENT_INCONSISTENT');
    const chain = await post(finance, '/api/bank/statements', { cashAccountId: bankId, lines: [{ date: day(20), description: 'A', amount: '100000', balance: '100000' }, { date: day(19), description: 'B', amount: '100000', balance: '999999' }] }).expect(400);
    expect(chain.body.code).toBe('BANK_STATEMENT_INCONSISTENT');
  });

  it('aturan otomatis hanya akun pendapatan/beban; mutasi kecil dijurnal otomatis, besar tetap manual; impor ganda dilewati', async () => {
    await post(finance, '/api/bank/rules', { name: 'Biaya admin', keyword: 'BIAYA ADM', direction: 'OUT', accountId: expenseId }).expect(403); // staf keuangan tidak boleh membuat aturan
    await post(owner, '/api/bank/rules', { name: 'Biaya admin', keyword: 'BIAYA ADM', direction: 'OUT', accountId: bankId }).expect(400); // bukan beban
    await post(owner, '/api/bank/rules', { name: 'Biaya admin', keyword: 'BIAYA ADM', direction: 'OUT', accountId: expenseId, maxAmount: '50000' }).expect(201);
    const lines = [
      { date: day(10), description: 'BIAYA ADM BULANAN', amount: '-15000' },
      { date: day(10), description: 'BIAYA ADM BESAR SEKALI', amount: '-900000' }, // di atas batas aturan
      { date: day(9), description: 'TRSF KELUAR MISTERIUS', amount: '-2000000' },
    ];
    const st = (await post(finance, '/api/bank/statements', { cashAccountId: bankId, lines }).expect(201)).body;
    const by = (d: string) => st.lines.find((l: { description: string }) => l.description === d);
    expect(by('BIAYA ADM BULANAN').status).toBe('CREATED');
    expect(by('BIAYA ADM BULANAN').matchedBy).toBe('RULE');
    expect(by('BIAYA ADM BESAR SEKALI').status).toBe('UNMATCHED');
    expect(by('TRSF KELUAR MISTERIUS').status).toBe('UNMATCHED');
    // impor ulang file yang tumpang tindih + 1 baru: yang lama dilewati, tidak ada jurnal ganda
    const again = (await post(finance, '/api/bank/statements', { cashAccountId: bankId, lines: [...lines, { date: day(8), description: 'SETOR TUNAI', amount: '300000' }] }).expect(201)).body;
    expect(again.skippedDuplicates).toBe(3);
    expect(again.lines).toHaveLength(1);
    await post(finance, '/api/bank/statements', { cashAccountId: bankId, lines }).expect(400); // semua sudah ada
  });

  it('uang keluar tak dikenal tidak bisa disembunyikan staf; hapus rekening koran hanya Pemilik/Admin dengan alasan', async () => {
    const sts = (await get(owner, '/api/bank/statements').expect(200)).body as { id: string }[];
    const first = (await get(owner, `/api/bank/statements/${sts[sts.length - 1].id}`).expect(200)).body;
    const out = first.lines.find((l: { description: string }) => l.description === 'TRSF KELUAR MISTERIUS');
    await post(finance, `/api/bank/lines/${out.id}/ignore`, { reason: 'bukan transaksi kami' }).expect(403);
    await post(owner, `/api/bank/lines/${out.id}/ignore`, { reason: 'x' }).expect(400);
    await post(owner, `/api/bank/lines/${out.id}/ignore`, { reason: 'salah transfer, sudah dikembalikan' }).expect(201);
    const c = (await get(finance, '/api/bank/controls').expect(200)).body as { items: { key: string }[] };
    const keys = c.items.map((i) => i.key);
    expect(keys).toContain('BANK_IGNORED');
    expect(keys).toContain('BANK_OUT_UNRECORDED'); // 'BIAYA ADM BESAR SEKALI' masih belum dicatat
    await http.delete(`/api/bank/statements/${sts[0].id}`).set(as(finance)).expect(403);
    await http.delete(`/api/bank/statements/${sts[0].id}`).set(as(owner)).expect(400); // tanpa alasan
    await http.delete(`/api/bank/statements/${sts[0].id}?reason=salah%20unggah%20file`).set(as(owner)).expect(200);
  });

  it('pengesahan rekonsiliasi: Keuangan tidak boleh mengesahkan, bulan berjalan ditolak, pengimpor (Admin) tidak mengesahkan sendiri, Akuntan/Pemilik boleh', async () => {
    const d = addDays(`${todayJakarta().slice(0, 7)}-01`, -15); // pertengahan bulan lalu
    const period = d.slice(0, 7);
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: bankId, date: d, description: 'Setoran modal', reference: 'M-1', lines: [{ accountId: equityId, amount: '7000000' }] }).expect(201);
    await post(adm, '/api/bank/statements', { cashAccountId: bankId, lines: [{ date: d, description: 'SETORAN MODAL', amount: '7000000', balance: '7000000' }] }).expect(201);
    await post(finance, '/api/bank/signoffs', { cashAccountId: bankId, period }).expect(403); // pemegang uang tidak mengesahkan pembukuannya sendiri
    await post(acct, '/api/bank/signoffs', { cashAccountId: bankId, period: todayJakarta().slice(0, 7) }).expect(400);
    await post(adm, '/api/bank/signoffs', { cashAccountId: bankId, period }).expect(403); // pengimpor tidak mengesahkan sendiri
    await post(acct, '/api/bank/signoffs', { cashAccountId: bankId, period }).expect(201);
    await post(owner, '/api/bank/signoffs', { cashAccountId: bankId, period }).expect(400); // sudah
    const list = (await get(owner, `/api/bank/signoffs?cashAccountId=${bankId}`).expect(200)).body as { period: string }[];
    expect(list.map((x) => x.period)).toContain(period);
  });
});
