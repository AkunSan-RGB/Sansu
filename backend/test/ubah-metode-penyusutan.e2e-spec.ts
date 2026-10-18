/**
 * Ubah metode penyusutan (e2e): berlaku ke depan saja, persetujuan staf, pratinjau, ubah per kategori, jurnal bulan lalu tak berubah.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Ubah metode penyusutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let acct: string; let categoryId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const cur = day.slice(0, 7);
  const prev = addDays(`${cur}-01`, -1).slice(0, 7);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  type Detail = { method: string; methodChanges: { from: string; prevMethod: string }[]; schedule: { period: string; amount: string; posted: boolean }[] };
  const detail = async (id: string) => (await get(owner, `/api/assets/${id}`).expect(200)).body as Detail;
  const newAsset = async (name: string) =>
    (await post(owner, '/api/assets', { name, categoryId, acquisitionDate: addDays(`${cur}-01`, -150), cost: '4800000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'EXISTING' }).expect(201)).body.id as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Ubah Metode', name: 'P', email: `um-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'akn', email: `um-akn-${stamp}@uji.id`, password: 'rahasia12345', role: 'ACCOUNTANT' }).expect(201);
    acct = (await http.post('/api/auth/login').send({ email: `um-akn-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; method: string; accumulatedAccountId: string | null }[];
    categoryId = cats.find((c) => c.method !== 'NONE' && c.accumulatedAccountId)!.id;
  });
  afterAll(async () => { await app.close(); });

  it('berlaku ke depan: bulan yang sudah diposting tidak berubah, bulan berlaku memakai metode baru', async () => {
    const id = await newAsset('Mesin A');
    await post(owner, '/api/assets/depreciation/run', { period: prev }).expect(201);
    const before = await detail(id);
    const postedBefore = before.schedule.filter((s) => s.posted).map((s) => `${s.period}:${s.amount}`);
    expect(postedBefore.length).toBeGreaterThan(0);

    const pv = (await get(owner, `/api/assets/${id}/method-preview?method=DECLINING_BALANCE&effectiveMonth=${cur}`).expect(200)).body as { rows: unknown[]; total12: { current: string; proposed: string } };
    expect(pv.rows.length).toBe(12);
    expect(pv.total12.proposed).not.toBe(pv.total12.current);

    await post(owner, `/api/assets/${id}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: prev, reason: 'Ganti ke saldo menurun' }).expect(400); // mundur ditolak
    await post(owner, `/api/assets/${id}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: cur, reason: 'x' }).expect(400); // alasan pendek
    await post(owner, `/api/assets/${id}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: cur, reason: 'Pola pemakaian menurun' }).expect(201);
    await post(owner, `/api/assets/${id}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: cur, reason: 'Sama saja' }).expect(400); // sama dengan sekarang

    const after = await detail(id);
    expect(after.method).toBe('DECLINING_BALANCE');
    expect(after.methodChanges).toHaveLength(1);
    expect(after.schedule.filter((s) => s.posted).map((s) => `${s.period}:${s.amount}`)).toEqual(postedBefore); // riwayat sama
    const now = after.schedule.find((s) => s.period === cur)!;
    expect(Number(now.amount)).toBeGreaterThan(100_000); // garis lurus 4,8jt/48 = 100rb; saldo menurun lebih besar di awal
    // menjalankan penyusutan bulan berlaku memposting jumlah yang sama dengan jadwal
    await post(owner, '/api/assets/depreciation/run', { period: cur }).expect(201);
    const done = await detail(id);
    expect(done.schedule.find((s) => s.period === cur)).toMatchObject({ amount: now.amount, posted: true });
    // retro setelah diposting ditolak
    await post(owner, `/api/assets/${id}/change-method`, { method: 'SUM_OF_YEARS', effectiveMonth: cur, reason: 'Coba mundur' }).expect(400);
    // neraca saldo tetap seimbang
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  });

  it('Akuntan: menunggu persetujuan; setelah disetujui metode berubah', async () => {
    const id = await newAsset('Mesin B');
    const r = await post(acct, `/api/assets/${id}/change-method`, { method: 'SUM_OF_YEARS', effectiveMonth: cur, reason: 'Sesuai kebijakan baru' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    expect((await detail(id)).method).toBe('STRAIGHT_LINE');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    expect((await detail(id)).method).toBe('SUM_OF_YEARS');
  });

  it('ubah per kategori: semua aset aktif ikut berubah, kategori jadi bawaan aset baru', async () => {
    const a1 = await newAsset('Mesin C');
    const a2 = await newAsset('Mesin D');
    const r = (await post(owner, `/api/assets/categories/${categoryId}/change-method`, { method: 'DECLINING_BALANCE_150', effectiveMonth: cur, reason: 'Standarisasi kategori' }).expect(201)).body as { changed: string[]; skipped: unknown[] };
    expect(r.changed.length).toBeGreaterThanOrEqual(2);
    expect((await detail(a1)).method).toBe('DECLINING_BALANCE_150');
    expect((await detail(a2)).method).toBe('DECLINING_BALANCE_150');
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; method: string }[];
    expect(cats.find((c) => c.id === categoryId)?.method).toBe('DECLINING_BALANCE_150');
  });
});
