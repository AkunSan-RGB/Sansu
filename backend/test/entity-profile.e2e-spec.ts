/**
 * Wizard standar akuntansi & pajak (SAK EMKM / SAK EP): rekomendasi, validasi penerapan,
 * dan dampaknya ke laporan keuangan, CALK, dan rekonsiliasi fiskal.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Wizard standar akuntansi & pajak (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = (t = token) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}, t = token) => http.post(url).set(as(t)).send(body);
  const answers = { publicAccountability: false, legalForm: 'UD', assets: 300_000_000, revenue: 1_200_000_000 };
  const apply = (o: object = {}, t = token) => post('/api/accounting/entity-profile/apply', { ...answers, framework: 'SAK_EMKM', taxScheme: 'FINAL_UMKM', ...o }, t);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http.post('/api/auth/register').send({ companyName: 'UD Wizard Uji', name: 'Pemilik', email: `wiz-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)
    ).body.accessToken;
  });
  afterAll(() => app.close());

  it('butuh login, dan hanya Admin/Keuangan/Akuntan yang boleh membuka wizard', async () => {
    await http.get('/api/accounting/entity-profile').expect(401);
    await post('/api/users', { name: 'Kasir', email: `wiz-k-${stamp}@uji.id`, password: 'kasir1234', role: 'CASHIER' }).expect(201);
    const kasir = (await http.post('/api/auth/login').send({ email: `wiz-k-${stamp}@uji.id`, password: 'kasir1234' }).expect(200)).body.accessToken;
    await http.get('/api/accounting/entity-profile').set(as(kasir)).expect(403);
  });

  it('keadaan awal: perusahaan baru tanpa transaksi → ukuran mikro, ukuran diambil dari pembukuan', async () => {
    const s = (await get('/api/accounting/entity-profile').expect(200)).body;
    expect(s.current).toMatchObject({ framework: 'SAK_EP', taxScheme: 'GENERAL', pkp: true });
    expect(s.saved).toBeNull();
    expect(s.measured).toMatchObject({ revenue: 0, assets: 0 });
    expect(s.measured.to >= s.measured.from).toBe(true);
    expect(s.recommendation).toMatchObject({ size: 'MICRO', framework: 'SAK_EMKM', frameworkAlternatives: ['SAK_EP'] });
    // SAK EP masih sah untuk usaha mikro → tidak ada penyimpangan
    expect(s.drift).toEqual({ framework: true, taxScheme: true, pkp: true });
  });

  it('pembukuan mengubah ukuran terukur: peredaran 12 bulan & aset di luar tanah/bangunan', async () => {
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const id = (code: string) => acc.find((a) => a.code === code)!.id;
    const today = todayJakarta();
    // modal 600 jt, beli tanah 400 jt (tidak dihitung), beli kas lewat penjualan 900 jt
    await post('/api/accounting/journals', { date: today, description: 'Modal awal', lines: [{ accountId: id('1-1100'), debit: '1000000000' }, { accountId: id('3-1000'), credit: '1000000000' }] }).expect(201);
    await post('/api/accounting/journals', { date: today, description: 'Beli tanah', controlOverrideReason: 'Penyiapan data uji (pengecualian Pemilik)', lines: [{ accountId: id('1-2050'), debit: '400000000' }, { accountId: id('1-1100'), credit: '400000000' }] }).expect(201);
    await post('/api/accounting/journals', { date: today, description: 'Penjualan tunai', lines: [{ accountId: id('1-1100'), debit: '900000000' }, { accountId: id('4-1000'), credit: '900000000' }] }).expect(201);
    const s = (await get('/api/accounting/entity-profile').expect(200)).body;
    expect(s.measured.revenue).toBe(900_000_000);
    // total aset 1,5 M (kas 1,5 M + tanah 0,4 M = 1,9 M) − tanah 0,4 M = 1,5 M
    expect(s.measured.assets).toBe(1_500_000_000);
    expect(s.recommendation.size).toBe('SMALL'); // modal 1,5 M > 1 M
  });

  it('panduan mulai memuat langkah wizard; selesai setelah diterapkan', async () => {
    const step = async () => ((await get('/api/onboarding').expect(200)).body.steps as { key: string; done: boolean; link: string }[]).find((s) => s.key === 'standard')!;
    expect(await step()).toMatchObject({ done: false, link: '/settings/company?wizard=1' });
    await apply({ framework: 'SAK_EP', taxScheme: 'GENERAL' }).expect(201);
    expect((await step()).done).toBe(true);
  });

  it('pratinjau rekomendasi tidak mengubah apa pun', async () => {
    const r = (await post('/api/accounting/entity-profile/recommend', { ...answers, legalForm: 'CV' }).expect(201)).body;
    expect(r.recommendation).toMatchObject({ framework: 'SAK_EMKM', taxScheme: 'GENERAL', finalTaxEligible: false });
    expect(r.simplifications.join(' ')).toMatch(/Posisi Keuangan, Laba Rugi, dan CALK/);
    expect((await get('/api/settings/company')).body.reporting.framework).toBe('SAK_EP');
  });

  it('validasi masukan', async () => {
    await post('/api/accounting/entity-profile/recommend', { ...answers, assets: -1 }).expect(400);
    await post('/api/accounting/entity-profile/recommend', { ...answers, legalForm: 'YAYASAN' }).expect(400);
    await post('/api/accounting/entity-profile/recommend', { ...answers, revenue: 'banyak' }).expect(400);
    await post('/api/accounting/entity-profile/recommend', { legalForm: 'UD' }).expect(400);
    await apply({ framework: 'SAK_LAIN' }).expect(400);
    await apply({ taxScheme: 'LAINNYA' }).expect(400);
  });

  it('menolak penerapan yang tidak sah', async () => {
    const before = (await get('/api/settings/company')).body;
    const reject = async (o: object, pattern: RegExp) => expect((await apply(o).expect(400)).body.message).toMatch(pattern);
    await reject({ publicAccountability: true }, /akuntabilitas publik/i);
    await reject({ assets: 20_000_000_000, revenue: 90_000_000_000 }, /tidak memenuhi syarat/); // usaha besar tak boleh EMKM
    await reject({ legalForm: 'PT' }, /tidak lagi berhak PPh final/);
    await reject({ revenue: 6_000_000_000 }, /sampai Rp4\.800\.000\.000/);
    await reject({ revenue: 6_000_000_000, taxScheme: 'GENERAL', pkp: false }, /wajib dikukuhkan sebagai PKP/);
    // tidak ada yang berubah setelah semua penolakan
    const after = (await get('/api/settings/company')).body;
    expect(after.reporting).toEqual(before.reporting);
    expect(after.taxProfile).toEqual(before.taxProfile);
  });

  it('peran Akuntan boleh menerapkan standar, tetapi tidak boleh mengubah status PKP', async () => {
    await post('/api/users', { name: 'Akuntan', email: `wiz-f-${stamp}@uji.id`, password: 'rahasia123', role: 'ACCOUNTANT' }).expect(201);
    const fin = (await http.post('/api/auth/login').send({ email: `wiz-f-${stamp}@uji.id`, password: 'rahasia123' }).expect(200)).body.accessToken;
    await apply({ pkp: false }, fin).expect(403);
    expect((await get('/api/settings/company')).body.taxProfile.pkp).toBe(true);
    await apply({ framework: 'SAK_EP', taxScheme: 'GENERAL' }, fin).expect(201);
    expect((await get('/api/settings/company')).body.reporting.framework).toBe('SAK_EP');
  });

  it('saldo pajak tangguhan yang sudah ada diperingatkan saat pindah ke EMKM', async () => {
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const id = (code: string) => acc.find((a) => a.code === code)!.id;
    const today = todayJakarta();
    await post('/api/accounting/journals', { date: today, description: 'Aset pajak tangguhan', lines: [{ accountId: id('1-2600'), debit: '2500000' }, { accountId: id('9-1100'), credit: '2500000' }] }).expect(201);
    const res = (await apply({ pkp: false }).expect(201)).body;
    expect(res.warnings.join(' ')).toMatch(/saldo pajak tangguhan Rp2\.500\.000/);
    expect(res.warnings.join(' ')).toMatch(/Status PKP nonaktif/);
  });

  it('penerapan benar: standar, skema PPh, PKP, dan profil tersimpan', async () => {
    const res = (await apply({ taxRegisteredYear: 2024, pkp: true }).expect(201)).body;
    expect(res.applied).toEqual({ framework: 'SAK_EMKM', taxScheme: 'FINAL_UMKM' });
    expect(res.current).toMatchObject({ framework: 'SAK_EMKM', taxScheme: 'FINAL_UMKM', pkp: true, legalForm: 'UD', taxRegisteredYear: 2024 });
    expect(res.saved).toMatchObject({ appliedFramework: 'SAK_EMKM', appliedTaxScheme: 'FINAL_UMKM', legalForm: 'UD', revenue: 1_200_000_000 });
    expect(res.simplifications.join(' ')).toMatch(/Rekonsiliasi fiskal dan angsuran PPh 25 dinonaktifkan/);
    const company = (await get('/api/settings/company')).body;
    expect(company.reporting).toMatchObject({ framework: 'SAK_EMKM', taxScheme: 'FINAL_UMKM', legalForm: 'UD' });
    expect(company.taxProfile.pkp).toBe(true);
    // dibaca ulang dari server: tersimpan permanen
    expect((await get('/api/accounting/entity-profile')).body.saved).toMatchObject({ appliedFramework: 'SAK_EMKM' });
  });

  it('dampak otomatis ke laporan: laba rugi ringkas EMKM, CALK, dan tanpa pajak tangguhan', async () => {
    expect((await get('/api/accounting/statements/framework')).body.framework).toBe('SAK_EMKM');
    const today = todayJakarta();
    const income = (await get(`/api/accounting/statements/income?from=${today.slice(0, 4)}-01-01&to=${today}&framework=SAK_EMKM`).expect(200)).body;
    const keys = income.lines.map((l: { key: string }) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['TOTAL_REVENUE', 'TOTAL_EXPENSE', 'PROFIT_BEFORE_TAX', 'NET_PROFIT']));
    expect(keys).not.toContain('GROSS_PROFIT');
    const notes = (await get(`/api/accounting/notes/${today.slice(0, 4)}`).expect(200)).body;
    const policies = notes.sections.find((s: { key: string }) => s.key === 'policies');
    expect(policies.subsections[0].paragraphs[0]).toContain('SAK EMKM');
    const fiscal = (await get(`/api/accounting/fiscal/${today.slice(0, 4)}`).expect(200)).body;
    expect(fiscal).toMatchObject({ scheme: 'FINAL_UMKM', framework: 'SAK_EMKM', deferred: null });
  });

  it('kembali ke SAK EP + tarif umum: laporan lengkap & pajak tangguhan dihitung lagi', async () => {
    const res = (await apply({ legalForm: 'UD', framework: 'SAK_EP', taxScheme: 'GENERAL' }).expect(201)).body;
    expect(res.current).toMatchObject({ framework: 'SAK_EP', taxScheme: 'GENERAL' });
    expect(res.simplifications.join(' ')).toMatch(/Lima laporan lengkap/);
    const today = todayJakarta();
    const fiscal = (await get(`/api/accounting/fiscal/${today.slice(0, 4)}`).expect(200)).body;
    expect(fiscal).toMatchObject({ scheme: 'GENERAL', framework: 'SAK_EP' });
    expect(fiscal.deferred).not.toBeNull();
  });

  it('drift: pilihan yang tak lagi sesuai angka pembukuan terdeteksi', async () => {
    await apply({ framework: 'SAK_EMKM', taxScheme: 'FINAL_UMKM' }).expect(201);
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const id = (code: string) => acc.find((a) => a.code === code)!.id;
    const today = todayJakarta();
    // penjualan besar tambahan 5 M → melewati batas PPh final (4,8 M) dan wajib PKP
    await post('/api/accounting/journals', { date: today, description: 'Penjualan besar', lines: [{ accountId: id('1-1100'), debit: '5000000000' }, { accountId: id('4-1000'), credit: '5000000000' }] }).expect(201);
    const s = (await get('/api/accounting/entity-profile').expect(200)).body;
    expect(s.measured.revenue).toBe(5_900_000_000);
    expect(s.recommendation).toMatchObject({ pkpRequired: true, finalTaxEligible: false, taxScheme: 'GENERAL' });
    expect(s.drift.taxScheme).toBe(false); // skema final tak lagi berhak
  });
});
