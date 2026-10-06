/**
 * Peringatan ambang pajak: batas PKP / PPh final Rp4,8 miliar, fasilitas Pasal 31E, kriteria UMKM,
 * termasuk integrasinya ke cek kesehatan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Alert = { key: string; level: string; message: string; percent: number; current: number; limit: number; link: string };
type Report = { asOf: string; year: number; revenueYtd: number; worst: string; alerts: Alert[] };

describe('Peringatan ambang pajak (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const as = (t = token) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const patch = (url: string, body: object = {}) => http.patch(url).set(as()).send(body);
  const report = async (q = '') => (await get(`/api/accounting/tax-thresholds${q}`).expect(200)).body as Report;
  const alert = (r: Report, key: string) => r.alerts.find((a) => a.key === key);
  let ids: Record<string, string> = {};
  const sale = (amount: string, date = today) =>
    post('/api/accounting/journals', { date, description: 'Penjualan', lines: [{ accountId: ids['1-1100'], debit: amount }, { accountId: ids['4-1000'], credit: amount }] }).expect(201);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http.post('/api/auth/register').send({ companyName: 'UD Ambang Pajak', name: 'Pemilik', email: `amb-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)
    ).body.accessToken;
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    ids = Object.fromEntries(acc.map((a) => [a.code, a.id]));
    await patch('/api/settings/company', { pkp: false }).expect(200);
    await patch('/api/settings/reporting', { legalForm: 'UD', taxScheme: 'GENERAL', framework: 'SAK_EP' }).expect(200);
  });
  afterAll(() => app.close());

  it('butuh login dan peran Admin/Keuangan', async () => {
    await http.get('/api/accounting/tax-thresholds').expect(401);
    await post('/api/users', { name: 'Kasir', email: `amb-k-${stamp}@uji.id`, password: 'kasir1234', role: 'CASHIER' }).expect(201);
    const kasir = (await http.post('/api/auth/login').send({ email: `amb-k-${stamp}@uji.id`, password: 'kasir1234' }).expect(200)).body.accessToken;
    await http.get('/api/accounting/tax-thresholds').set(as(kasir)).expect(403);
  });

  it('perusahaan baru: belum PKP, omzet nol → semua aman', async () => {
    const r = await report();
    expect(r).toMatchObject({ year, revenueYtd: 0, worst: 'OK' });
    expect(r.asOf).toBe(today);
    expect(alert(r, 'pkp')).toMatchObject({ level: 'OK', percent: 0, limit: 4_800_000_000 });
    expect(alert(r, 'facility-31e')!.level).toBe('OK');
    expect(alert(r, 'final-tax')).toBeUndefined(); // bukan skema final
    expect(alert(r, 'umkm-size')).toBeUndefined(); // SAK EP
  });

  it('peredaran tahun lalu tidak dihitung ke tahun berjalan', async () => {
    await sale('3000000000', `${year - 1}-06-01`);
    const r = await report();
    expect(r.revenueYtd).toBe(0);
    expect(alert(r, 'pkp')!.level).toBe('OK');
    // tetapi dihitung bila tanggal hitung dimundurkan ke tahun itu
    const past = await report(`?asOf=${year - 1}-12-31`);
    expect(past).toMatchObject({ year: year - 1, revenueYtd: 3_000_000_000 });
    // akhir tahun: proyeksi = realisasi (Rp3 M = 62,5% dari batas) → belum perlu peringatan
    expect(alert(past, 'pkp')).toMatchObject({ level: 'OK', percent: 62.5 });
  });

  it('mendekati batas Rp4,8 miliar → WARN dengan persen dan tautan', async () => {
    await sale('4000000000');
    const r = await report();
    expect(r.revenueYtd).toBe(4_000_000_000);
    expect(alert(r, 'pkp')).toMatchObject({ level: 'WARN', percent: 83.3, link: '/settings/company' });
    expect(r.worst).toBe('WARN');
  });

  it('melewati batas → ERROR: wajib PKP; tercermin di cek kesehatan (Kepatuhan)', async () => {
    await sale('900000000');
    const r = await report();
    expect(r.revenueYtd).toBe(4_900_000_000);
    const pkp = alert(r, 'pkp')!;
    expect(pkp.level).toBe('ERROR');
    expect(pkp.message).toMatch(/wajib dikukuhkan sebagai PKP/);
    expect(r.worst).toBe('ERROR');

    const h = (await get('/api/accounting/health').expect(200)).body as { checks: { key: string; category: string; status: string; message: string }[] };
    const check = h.checks.find((c) => c.key === 'threshold-pkp')!;
    expect(check).toMatchObject({ category: 'Kepatuhan', status: 'ERROR' });
    expect(check.message).toBe(pkp.message);
    // cek kesehatan tanpa data pajak bermasalah tetap berisi cek ambang (OK)
    expect(h.checks.some((c) => c.key === 'threshold-facility-31e')).toBe(true);
  });

  it('setelah PKP: peringatan PKP hilang, Pasal 31E berlaku sebagian', async () => {
    await patch('/api/settings/company', { pkp: true }).expect(200);
    const r = await report();
    expect(alert(r, 'pkp')).toBeUndefined();
    expect(alert(r, 'facility-31e')).toMatchObject({ level: 'OK' });
    expect(alert(r, 'facility-31e')!.message).toMatch(/berlaku sebagian/);
  });

  it('skema PPh final: melewati batas → ERROR tahun berikutnya; PT/CV/Firma → peringatan hak', async () => {
    await patch('/api/settings/reporting', { taxScheme: 'FINAL_UMKM' }).expect(200);
    let r = await report();
    expect(alert(r, 'final-tax')).toMatchObject({ level: 'ERROR', limit: 4_800_000_000 });
    expect(alert(r, 'final-tax')!.message).toMatch(/tahun pajak berikutnya/);
    expect(alert(r, 'facility-31e')).toBeUndefined();
    expect(alert(r, 'final-tax-eligibility')).toBeUndefined(); // UD berhak

    await patch('/api/settings/reporting', { legalForm: 'CV' }).expect(200);
    r = await report();
    expect(alert(r, 'final-tax-eligibility')).toMatchObject({ level: 'WARN' });
    await patch('/api/settings/reporting', { legalForm: 'UD', taxScheme: 'GENERAL' }).expect(200);
  });

  it('SAK EMKM pada usaha besar → WARN kriteria UMKM', async () => {
    await patch('/api/settings/reporting', { framework: 'SAK_EMKM' }).expect(200);
    expect(alert(await report(), 'umkm-size')!.level).toBe('OK'); // omzet 4,9 M + 3 M < 15 M, aset kas kecil
    await post('/api/accounting/journals', { date: today, description: 'Tambahan modal', lines: [{ accountId: ids['1-1100'], debit: '20000000000' }, { accountId: ids['3-1000'], credit: '20000000000' }] }).expect(201);
    const a = alert(await report(), 'umkm-size')!;
    expect(a.level).toBe('WARN');
    expect(a.message).toMatch(/tidak lagi memenuhi syarat/);
    expect(a.link).toBe('/settings/company?wizard=1');
    await patch('/api/settings/reporting', { framework: 'SAK_EP' }).expect(200);
    expect(alert(await report(), 'umkm-size')).toBeUndefined();
  });

  it('batas Rp50 miliar: mendekati → WARN, melewati → informasi', async () => {
    await sale('40000000000'); // total tahun ini 44,9 M = 89,8%
    const near = alert(await report(), 'facility-31e')!;
    expect(near).toMatchObject({ level: 'WARN', limit: 50_000_000_000 });
    await sale('6000000000'); // 50,9 M
    const over = alert(await report(), 'facility-31e')!;
    expect(over.level).toBe('INFO');
    expect(over.message).toMatch(/tarif 22%/);
  });

  it('format tanggal tidak valid diabaikan (memakai hari ini)', async () => {
    const r = await report('?asOf=kemarin');
    expect(r.asOf).toBe(today);
    // pola benar tetapi tanggal tidak ada di kalender: tidak boleh menjadi error server
    for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10']) expect((await report(`?asOf=${bad}`)).asOf).toBe(today);
    expect((await report('?asOf=2026-02-28')).asOf).toBe('2026-02-28');
    const h = (await get('/api/accounting/health?asOf=2026-13-45').expect(200)).body;
    expect(h.checks.length).toBeGreaterThan(0);
  });
});
