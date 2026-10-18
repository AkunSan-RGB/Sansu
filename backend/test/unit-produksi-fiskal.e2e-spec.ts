/**
 * Metode unit produksi (pemakaian per bulan) dan bukti bahwa koreksi fiskal ikut otomatis saat metode komersial diubah.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Unit produksi & koreksi fiskal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let categoryId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const cur = day.slice(0, 7);
  const prev = addDays(`${cur}-01`, -1).slice(0, 7);
  const prev2 = addDays(`${prev}-01`, -1).slice(0, 7);
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const put = (u: string, b: object = {}) => http.put(u).set(as()).send(b);
  const base = (extra: object = {}) => ({ name: 'Truk Uji', categoryId, acquisitionDate: addDays(`${prev2}-01`, 0), cost: '100000000', residualValue: '10000000', method: 'UNITS_OF_PRODUCTION', funding: 'EXISTING', ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Unit Produksi', name: 'P', email: `up-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const cats = (await get('/api/assets/categories').expect(200)).body as { id: string; method: string; accumulatedAccountId: string | null }[];
    categoryId = cats.find((c) => c.method !== 'NONE' && c.accumulatedAccountId)!.id;
  });
  afterAll(async () => { await app.close(); });

  it('unit produksi: wajib total unit; penyusutan mengikuti pemakaian; tidak bisa diubah setelah diposting', async () => {
    await post('/api/assets', base()).expect(400); // tanpa total unit
    const id = (await post('/api/assets', base({ totalUnits: '200000', unitLabel: 'km' })).expect(201)).body.id as string;
    await put(`/api/assets/${id}/usage`, { period: prev2, units: '5000' }).expect(200);
    await put(`/api/assets/${id}/usage`, { period: prev, units: '0' }).expect(200);
    await put(`/api/assets/${id}/usage`, { period: cur, units: '300000' }).expect(400); // melebihi kapasitas
    await put(`/api/assets/${id}/usage`, { period: addDays(`${cur}-28`, 10).slice(0, 7), units: '1' }).expect(400); // bulan depan

    await post('/api/assets/depreciation/run', { period: prev }).expect(201);
    const d = (await get(`/api/assets/${id}`).expect(200)).body as { accumulated: string; schedule: { period: string; amount: string; posted: boolean }[] };
    expect(d.schedule.find((s) => s.period === prev2)).toMatchObject({ amount: '2250000.00', posted: true }); // 90 jt × 5.000 / 200.000
    expect(Number(d.accumulated)).toBe(2_250_000);
    await put(`/api/assets/${id}/usage`, { period: prev2, units: '6000' }).expect(400); // sudah diposting
    // metode tidak bisa dipindah dari/ke unit produksi
    await post(`/api/assets/${id}/change-method`, { method: 'STRAIGHT_LINE', effectiveMonth: cur, reason: 'Coba pindah' }).expect(400);
    const sl = (await post('/api/assets', base({ method: 'STRAIGHT_LINE', usefulLifeMonths: 48 })).expect(201)).body.id as string;
    await post(`/api/assets/${sl}/change-method`, { method: 'UNITS_OF_PRODUCTION', effectiveMonth: cur, reason: 'Coba pindah ke unit' }).expect(400);
    // pemakaian bulan lalu kosong → temuan
    const k = ((await get('/api/assets/controls').expect(200)).body.items as { key: string }[]).map((i) => i.key);
    expect(k).not.toContain('USAGE_MISSING'); // prev diisi 0 → dianggap sudah diisi
    const usage = (await get(`/api/assets/${id}/usage`).expect(200)).body as { usedUnits: string; remainingUnits: string };
    expect(Number(usage.usedUnits)).toBe(5000);
    expect(Number(usage.remainingUnits)).toBe(195000);
    expect((await get('/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  });

  it('koreksi fiskal ikut otomatis: penyusutan komersial berubah, fiskal tetap', async () => {
    const id = (await post('/api/assets', base({ method: 'STRAIGHT_LINE', usefulLifeMonths: 48, acquisitionDate: `${cur}-01`, cost: '4800000', residualValue: '0' })).expect(201)).body.id as string;
    const year = Number(cur.slice(0, 4));
    const fiscal = async () => ((await get(`/api/assets/reports/fiscal?year=${year}`).expect(200)).body as { id: string; commercial: string; fiscal: string; difference: string }[]).find((r) => r.id === id)!;
    await post('/api/assets/depreciation/run', { period: cur }).expect(201);
    const before = await fiscal();
    await post(`/api/assets/${id}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: `${addDays(`${cur}-28`, 5).slice(0, 7)}`, reason: 'Uji' }).expect(400); // bulan depan ditolak
    // ubah di bulan berlaku bulan ini ditolak karena sudah diposting; tes memakai aset terpisah yang belum diposting
    const id2 = (await post('/api/assets', base({ method: 'STRAIGHT_LINE', usefulLifeMonths: 48, acquisitionDate: `${cur}-01`, cost: '4800000', residualValue: '0' })).expect(201)).body.id as string;
    await post(`/api/assets/${id2}/change-method`, { method: 'DECLINING_BALANCE', effectiveMonth: cur, reason: 'Pola pemakaian menurun' }).expect(201);
    await post('/api/assets/depreciation/run', { period: cur }).expect(201);
    const rows = (await get(`/api/assets/reports/fiscal?year=${year}`).expect(200)).body as { id: string; commercial: string; fiscal: string }[];
    const r1 = rows.find((r) => r.id === id)!;
    const r2 = rows.find((r) => r.id === id2)!;
    expect(r1.fiscal).toBe(r2.fiscal); // fiskal sama (aturan Pasal 11, tidak ikut metode komersial)
    expect(Number(r2.commercial)).toBeGreaterThan(Number(r1.commercial)); // komersial mengikuti metode baru
    expect(r1.commercial).toBe(before.commercial);
  });
});
