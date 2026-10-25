/**
 * Konkurensi (e2e): puluhan permintaan tulis serentak (lebih banyak dari isi kolam koneksi, 10) tidak boleh membuat server macet
 * (kebuntuan kolam: tiap transaksi memegang satu koneksi sambil meminta koneksi kedua) dan nomor dokumen tidak boleh ganda.
 * Dibuat setelah uji beban menemukan 100 kas keluar serentak membekukan server.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Konkurensi kolam koneksi (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let fin: string;
  let acc: string;
  let cashId: string;
  let expA: string;
  let expB: string;
  let assetCat: string;
  const N = 40;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const all = <T>(fn: (i: number) => Promise<T>) => Promise.all(Array.from({ length: N }, (_, i) => fn(i)));
  // Semua permintaan dijawab (tidak menggantung) dan tidak ada galat server; yang ditolak aturan bisnis (4xx) boleh
  const expectNoHang = (rs: { status: number; body?: { message?: unknown } }[], ok = N) => {
    const codes = rs.map((r) => r.status);
    expect(rs).toHaveLength(N);
    expect(codes.filter((c) => c >= 500)).toEqual([]);
    expect(codes.filter((c) => c === 201).length).toBeGreaterThanOrEqual(ok);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Serentak', name: 'Pemilik', email: `kk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    for (const [role, tag] of [['FINANCE', 'f'], ['ACCOUNTANT', 'a']]) await post(owner, '/api/users', { name: role, email: `kk-${tag}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const login = async (tag: string) => (await http.post('/api/auth/login').send({ email: `kk-${tag}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    fin = await login('f');
    acc = await login('a');
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    cashId = (await http.get('/api/cash/accounts').set(as(fin)).expect(200)).body[0].id;
    const coa = (await http.get('/api/accounting/accounts').set(as(acc)).expect(200)).body as { id: string; type: string; parentId: string | null }[];
    const leaf = coa.filter((x) => x.type === 'EXPENSE' && !coa.some((y) => y.parentId === x.id));
    expA = leaf[0].id;
    expB = leaf[1].id;
    assetCat = ((await http.get('/api/assets/categories').set(as(acc)).expect(200)).body as { id: string }[])[0].id;
  });
  afterAll(() => app.close());

  it('kas keluar serentak: semua berhasil, nomor tidak ganda, saldo = jumlah', async () => {
    const rs = await all((i) => post(fin, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: todayJakarta(), description: `serentak ${i}`, lines: [{ accountId: expA, amount: '1000' }] }));
    expectNoHang(rs);
    const numbers = rs.map((r) => r.body.number as string);
    expect(new Set(numbers).size).toBe(N);
    const bal = (await http.get('/api/cash/accounts').set(as(fin)).expect(200)).body.find((a: { id: string }) => a.id === cashId).balance;
    expect(Number(bal)).toBe(-1000 * N);
  });

  it('setoran pajak serentak tidak membekukan server', async () => {
    const rs = await all(() => post(fin, '/api/tax/payments', { type: 'PPH21', period: todayJakarta().slice(0, 7), amount: '1000', date: todayJakarta(), cashAccountId: cashId }));
    expectNoHang(rs, 1);
  });

  it('uang muka pemasok serentak', async () => {
    const sup = (await post(owner, '/api/suppliers', { code: 'SUP-KK', name: 'Pemasok Serentak' }).expect(201)).body.id;
    const rs = await all(() => post(owner, '/api/supplier-advances', { supplierId: sup, cashAccountId: cashId, amount: '1000', date: todayJakarta() }));
    expectNoHang(rs);
  });

  it('jurnal manual dan pembelian aset serentak', async () => {
    const j = await all((i) => post(acc, '/api/accounting/journals', { date: todayJakarta(), description: `jm ${i}`, confirmDuplicate: true, lines: [{ accountId: expA, debit: String(1000 + i) }, { accountId: expB, credit: String(1000 + i) }] }));
    expectNoHang(j, 1);
    const a = await all((i) => post(acc, '/api/assets', { name: `Aset ${i}`, categoryId: assetCat, acquisitionDate: todayJakarta(), cost: '1000000', funding: 'CASH', cashAccountId: cashId }));
    expectNoHang(a); // semua 40 aset berhasil: kode berurutan tidak bentrok (409 sebelum perbaikan)
    const codes = a.filter((r) => r.status === 201).map((r) => r.body.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('server tetap sehat sesudahnya', async () => {
    await http.get('/api/health').expect(200);
    await http.get('/api/dashboard').set(as(owner)).expect(200);
  });

  it('larangan saldo negatif tetap berlaku saat pengeluaran serentak (tanpa kunci, 24 dari 100 lolos pada saldo yang hanya cukup untuk 15)', async () => {
    const t = (await http.post('/api/auth/register').send({ companyName: 'PT Saldo Serentak', name: 'Pemilik', email: `ks-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    const cash = (await http.get('/api/cash/accounts').set(as(t)).expect(200)).body[0].id as string;
    const coa = (await http.get('/api/accounting/accounts').set(as(t)).expect(200)).body as { id: string; type: string; parentId: string | null }[];
    const e = coa.filter((x) => x.type === 'EXPENSE' && !coa.some((y) => y.parentId === x.id))[0].id;
    await post(t, '/api/cash/transactions', { type: 'IN', cashAccountId: cash, date: todayJakarta(), description: 'modal', reference: 'MD-1', lines: [{ source: 'OWNER_CAPITAL', amount: '5000000' }] }).expect(201);
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => post(t, '/api/cash/transactions', { type: 'OUT', cashAccountId: cash, date: todayJakarta(), description: `serentak ${i}`, lines: [{ accountId: e, amount: '1000000' }] })));
    expect(rs.filter((r) => r.status >= 500)).toEqual([]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    const bal = (await http.get('/api/cash/accounts').set(as(t)).expect(200)).body.find((a: { id: string }) => a.id === cash).balance;
    expect(Number(bal)).toBe(0);
  });
});
