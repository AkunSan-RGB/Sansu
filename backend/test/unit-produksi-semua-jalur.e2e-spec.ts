/**
 * Unit produksi lewat semua jalur pendaftaran aset: faktur pembelian, kas keluar, dari jurnal, dan impor aset lama.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Unit produksi: semua jalur pendaftaran aset (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let categoryId: string; let catName: string; let assetAccountId: string; let supplierId: string;
  let bankId: string; let cashCounter: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const assets = async () => (await get('/api/assets').expect(200)).body as { id: string; code: string; name: string; method: string; totalUnits: string | null; unitLabel: string | null }[];
  let n = 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Unit Semua Jalur', name: 'P', email: `us-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const cats = (await get('/api/assets/categories').expect(200)).body as { id: string; name: string; method: string; accumulatedAccountId: string | null; assetAccountId: string }[];
    const c = cats.find((x) => x.method !== 'NONE' && x.accumulatedAccountId)!;
    categoryId = c.id; catName = c.name; assetAccountId = c.assetAccountId;
    await http.patch(`/api/assets/categories/${categoryId}`).set(as()).send({ method: 'UNITS_OF_PRODUCTION' }).expect(200);
    supplierId = (await post('/api/suppliers', { code: 'SUP-US', name: 'Dealer Truk' }).expect(201)).body.id;
    bankId = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1200')!.id;
    cashCounter = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: bankId, date: addDays(day, -40), description: 'Modal', reference: 'M-1', lines: [{ accountId: cashCounter, amount: '900000000' }] }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('faktur pembelian: wajib total unit per baris aset; tiap unit mewarisi kapasitas', async () => {
    const line = (extra: object = {}) => ({ type: 'ASSET', description: 'Truk Box', assetCategoryId: categoryId, price: '300000000', qty: '2', ...extra });
    const bill = (lines: object[]) => post('/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `US-${stamp}-${++n}`, date: day, lines });
    await bill([line()]).expect(400);
    await bill([line({ totalUnits: '250000', unitLabel: 'km' })]).expect(201);
    const trucks = (await assets()).filter((a) => a.name.startsWith('Truk Box'));
    expect(trucks).toHaveLength(2);
    expect(trucks.every((a) => a.method === 'UNITS_OF_PRODUCTION' && Number(a.totalUnits) === 250000 && a.unitLabel === 'km')).toBe(true);
  });

  it('kas keluar ke akun aset: wajib total unit', async () => {
    const out = (extra: object = {}) => post('/api/cash/transactions', { type: 'OUT', cashAccountId: bankId, date: day, description: 'Beli forklift', reference: `KW-${++n}`, lines: [{ accountId: assetAccountId, amount: '120000000', assetCategoryId: categoryId, assetName: 'Forklift', ...extra }] });
    await out().expect(400);
    await out({ assetTotalUnits: '30000', assetUnitLabel: 'jam' }).expect(201);
    const f = (await assets()).find((a) => a.name === 'Forklift')!;
    expect(f).toMatchObject({ method: 'UNITS_OF_PRODUCTION', unitLabel: 'jam' });
    expect(Number(f.totalUnits)).toBe(30000);
  });

  it('dari jurnal: wajib total unit', async () => {
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const equity = accs.find((a) => a.code === '3-1000')!.id;
    const j = (await post('/api/accounting/journals', { date: day, description: 'Beli generator lama', controlOverrideReason: 'Uji daftar dari jurnal', lines: [{ accountId: assetAccountId, debit: '50000000' }, { accountId: equity, credit: '50000000' }] }).expect(201)).body;
    const reg = (extra: object = {}) => post('/api/assets/from-journal', { journalId: j.id, accountId: assetAccountId, name: 'Generator', ...extra });
    await reg().expect(400);
    await reg({ totalUnits: '40000', unitLabel: 'jam' }).expect(201);
    const g = (await assets()).find((a) => a.name === 'Generator')!;
    expect(g).toMatchObject({ method: 'UNITS_OF_PRODUCTION', unitLabel: 'jam' });
  });

  it('impor aset lama: kolom Total unit wajib untuk kategori unit produksi', async () => {
    const imp = (rows: object[], extra: object = {}) => http.post('/api/imports').set(as()).send({ kind: 'assets', rows, date: addDays(day, -60), ...extra });
    const row = { nama: 'Crane Lama', kategori: catName, tanggal_perolehan: '2022-03-15', harga_perolehan: 400000000, akumulasi_penyusutan: 100000000 };
    const bad = (await imp([row]).expect(200)).body;
    expect(bad.summary.errors).toBe(1);
    expect(JSON.stringify(bad.results)).toMatch(/Total unit/);
    const ok = (await imp([{ ...row, total_unit: 100000, satuan_unit: 'jam' }]).expect(200)).body;
    expect(ok.summary.errors).toBe(0);
    await imp([{ ...row, total_unit: 100000, satuan_unit: 'jam' }], { dryRun: false }).expect(200);
    const c = (await assets()).find((a) => a.name === 'Crane Lama')!;
    expect(c).toMatchObject({ method: 'UNITS_OF_PRODUCTION', unitLabel: 'jam' });
    expect(Number(c.totalUnits)).toBe(100000);
  });
});
