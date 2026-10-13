/**
 * Pembelian aset yang sudah dijurnal tetapi belum menjadi kartu aset (mis. kas keluar sebelum pendaftaran otomatis):
 * dapat didaftarkan langsung dari jurnalnya, tanpa jurnal baru, sehingga daftar aset = buku besar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Daftarkan aset dari jurnal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let assetAccountId: string;
  let cashId: string;
  const day = todayJakarta();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(auth());
  const post = (u: string, b: object = {}) => http.post(u).set(auth()).send(b);
  type Un = { journalId: string; accountId: string; remaining: string; journalNumber: string };
  const orphans = async () => (await get('/api/assets/unregistered').expect(200)).body as Un[];
  const mismatched = async () => ((await get(`/api/assets/reconciliation?asOf=${day}`).expect(200)).body as { mismatched: number }).mismatched;
  const buy = (amount: string, description: string) =>
    post('/api/accounting/journals', { date: day, description, controlOverrideReason: 'Menyiapkan pembelian lama tanpa kartu aset', lines: [{ accountId: assetAccountId, debit: amount }, { accountId: cashId, credit: amount }] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Aset Jurnal', name: 'Pemilik', email: `aj-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const cats = (await get('/api/assets/categories').expect(200)).body as { assetAccountId: string; method: string }[];
    assetAccountId = cats.find((c) => c.method !== 'NONE')!.assetAccountId;
    cashId = ((await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
  });
  afterAll(() => app.close());

  it('pembelian tanpa kartu aset terdeteksi dan memicu selisih', async () => {
    expect(await orphans()).toHaveLength(0);
    const j = (await buy('500000000', 'KK/2026/10/0001 Pembelian Mobil').expect(201)).body as { id: string };
    const list = await orphans();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ journalId: j.id, remaining: '500000000.00' });
    expect(await mismatched()).toBeGreaterThan(0);
  });

  it('didaftarkan sebagian lalu sisanya; tidak melebihi sisa; tanpa jurnal baru; selisih menjadi nol', async () => {
    const [o] = await orphans();
    const journalsBefore = ((await get('/api/accounting/journals').expect(200)).body as unknown[]).length;
    await post('/api/assets/from-journal', { journalId: o.journalId, accountId: o.accountId, name: 'Mobil', amount: '600000000' }).expect(400);
    await post('/api/assets/from-journal', { journalId: o.journalId, accountId: o.accountId, name: 'Mobil A', amount: '200000000', usefulLifeMonths: 96, location: 'Kantor' }).expect(201);
    expect((await orphans())[0].remaining).toBe('300000000.00');
    await post('/api/assets/from-journal', { journalId: o.journalId, accountId: o.accountId, name: 'Mobil B' }).expect(201);
    expect(await orphans()).toHaveLength(0);
    await post('/api/assets/from-journal', { journalId: o.journalId, accountId: o.accountId, name: 'Lagi' }).expect(400);
    expect(((await get('/api/accounting/journals').expect(200)).body as unknown[]).length).toBe(journalsBefore);
    expect(await mismatched()).toBe(0);
    const assets = (await get('/api/assets').expect(200)).body as { name: string; cost: string; acquisitionJournalId: string }[];
    expect(assets.map((a) => a.name).sort()).toEqual(['Mobil A', 'Mobil B']);
    expect(assets.every((a) => a.acquisitionJournalId === o.journalId)).toBe(true);
  });

  it('jurnal yang sudah dibalik tidak muncul; kategori yang tidak sesuai ditolak', async () => {
    const j = (await buy('120000', 'Pembelian salah').expect(201)).body as { id: string };
    expect(await orphans()).toHaveLength(1);
    await post(`/api/accounting/journals/${j.id}/reverse`).expect(201);
    expect(await orphans()).toHaveLength(0);
    const k = (await buy('130000', 'Pembelian lain').expect(201)).body as { id: string };
    const [o] = await orphans();
    expect(o.journalId).toBe(k.id);
    await post('/api/assets/from-journal', { journalId: o.journalId, accountId: o.accountId, name: 'X', categoryId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });
});
