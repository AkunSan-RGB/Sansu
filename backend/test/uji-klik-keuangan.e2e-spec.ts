/**
 * Temuan uji klik keuangan (e2e): tanggal pembukuan yang salah ketik (tahun/bulan jauh ke depan) ditolak di kas, jurnal manual,
 * setoran pajak, kurs, dan perolehan aset; kunci periode tidak bisa dipasang ke masa depan (membekukan pembukuan).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Temuan uji klik keuangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let acc: string;
  let fin: string;
  let cashId: string;
  let expA: string;
  let expB: string;
  let catId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const FAR = '2099-01-01';
  const SOON = () => addDays(todayJakarta(), 3);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Tanggal Keuangan', name: 'Pemilik', email: `tk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    for (const [role, tag] of [['ACCOUNTANT', 'a'], ['FINANCE', 'f']]) {
      await post(owner, '/api/users', { name: role, email: `tk-${tag}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    }
    const login = async (tag: string) => (await http.post('/api/auth/login').send({ email: `tk-${tag}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    acc = await login('a');
    fin = await login('f');
    cashId = (await http.get('/api/cash/accounts').set(as(fin)).expect(200)).body[0].id;
    const coa = (await http.get('/api/accounting/accounts').set(as(acc)).expect(200)).body as { id: string; type: string; parentId: string | null }[];
    const leaf = coa.filter((x) => x.type === 'EXPENSE' && !coa.some((y) => y.parentId === x.id));
    expA = leaf[0].id;
    expB = leaf[1].id;
    catId = ((await http.get('/api/assets/categories').set(as(acc)).expect(200)).body as { id: string }[])[0].id;
  });
  afterAll(() => app.close());

  it('bawaan: kas keluar melebihi saldo ditolak; bisa dimatikan Pemilik lewat pengaturan', async () => {
    const big = (amount: string) => post(fin, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: todayJakarta(), description: 'Uji saldo', lines: [{ accountId: expA, amount }] });
    const r = await big('5000000').expect(400);
    expect(r.body.message).toContain('tidak cukup');
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200);
    await big('5000000').expect(201);
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: true }).expect(200);
    await big('5000000').expect(400);
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200);
  });

  it('bawaan: pembelian aset dari kas/bank melebihi saldo ditolak; bisa dimatikan', async () => {
    const asset = () => post(acc, '/api/assets', { name: 'Mesin Uji Saldo', categoryId: catId, acquisitionDate: todayJakarta(), cost: '9000000000', funding: 'CASH', cashAccountId: cashId });
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: true }).expect(200);
    expect((await asset().expect(400)).body.message).toContain('tidak cukup');
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200);
    await asset().expect(201);
  });

  it('bawaan: uang muka pemasok dan setoran pajak melebihi saldo ditolak; bisa dimatikan', async () => {
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: true }).expect(200);
    const sup = (await post(owner, '/api/suppliers', { code: 'SUP-TK', name: 'Pemasok Uji' }).expect(201)).body.id;
    const advance = () => post(owner, '/api/supplier-advances', { supplierId: sup, cashAccountId: cashId, amount: '8000000000', date: todayJakarta() });
    const tax = () => post(fin, '/api/tax/payments', { type: 'PPH21', period: todayJakarta().slice(0, 7), amount: '8000000000', date: todayJakarta(), cashAccountId: cashId });
    expect((await advance().expect(400)).body.message).toContain('tidak cukup');
    expect((await tax().expect(400)).body.message).toContain('tidak cukup');
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200);
    await advance().expect(201);
    await tax().expect(201);
  });

  const cashOut = (date: string) => post(fin, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date, description: 'Uji tanggal', lines: [{ accountId: expA, amount: '1000' }] });

  it('kas keluar: tahun salah ketik ditolak; beberapa hari ke depan masih wajar', async () => {
    const r = await cashOut('2099-01-01').expect(400);
    expect(JSON.stringify(r.body)).toContain('ke depan');
    await cashOut(SOON()).expect(201);
    await cashOut(todayJakarta()).expect(201);
  });

  it('jurnal manual: tanggal jauh ke depan ditolak', async () => {
    const body = (date: string) => ({ date, description: 'Uji', lines: [{ accountId: expA, debit: '1000' }, { accountId: expB, credit: '1000' }] });
    expect(JSON.stringify((await post(acc, '/api/accounting/journals', body(FAR)).expect(400)).body)).toContain('ke depan');
    await post(acc, '/api/accounting/journals', body(todayJakarta())).expect(201);
  });

  it('setoran pajak, kurs, dan perolehan aset bertanggal jauh ke depan ditolak', async () => {
    expect((await post(fin, '/api/tax/payments', { type: 'PPH21', period: '2026-09', amount: '1000', date: FAR }).expect(400)).body.message).toContain('ke depan');
    expect((await http.put('/api/fx/rates').set(as(fin)).send({ currency: 'USD', rate: '16000', date: FAR }).expect(400)).body.message).toContain('ke depan');
    expect((await post(acc, '/api/assets', { name: 'Uji aset', categoryId: catId, acquisitionDate: FAR, cost: '1000000', funding: 'CASH', cashAccountId: cashId }).expect(400)).body.message).toContain('ke depan');
    await http.put('/api/fx/rates').set(as(fin)).send({ currency: 'USD', rate: '16000', date: todayJakarta() }).expect(200);
  });

  it('kunci periode tidak bisa dipasang ke masa depan; kunci sampai kemarin berjalan', async () => {
    const r = await post(acc, '/api/accounting/period/lock', { until: '2099-12-31' }).expect(400);
    expect(r.body.message).toContain('belum berakhir');
    await post(acc, '/api/accounting/period/lock', { until: addDays(todayJakarta(), -400) }).expect(201);
  });

  it('tutup buku tahun berjalan atau tahun depan ditolak (jurnal penutup tidak boleh bertanggal masa depan)', async () => {
    const year = Number(todayJakarta().slice(0, 4));
    for (const y of [year, year + 1]) {
      const r = await post(acc, '/api/accounting/period/close-year', { year: y, lock: true }).expect(400);
      expect(r.body.message).toContain('belum berakhir');
    }
    expect((await http.get('/api/accounting/period').set(as(acc)).expect(200)).body.closings).toEqual([]);
  });
});
