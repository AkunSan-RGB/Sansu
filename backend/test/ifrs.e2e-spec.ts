/**
 * Pilihan standar akuntansi umum (IFRS): kerangka lengkap seperti SAK EP dengan penyajian dan pengungkapan khas IFRS.
 * Angka pembukuan tidak berubah saat berpindah standar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Standar akuntansi umum IFRS (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const patch = (u: string, b: object = {}) => http.patch(u).set(as()).send(b);
  const setFramework = (framework: string) => patch('/api/settings/reporting', { framework }).expect(200);
  const notes = async () => (await get(`/api/accounting/notes/${year}`).expect(200)).body as { framework: string; sections: { key: string; title: string; paragraphs: string[]; subsections?: { title: string; paragraphs: string[] }[] }[] };
  const answers = { legalForm: 'PT', assets: 8_000_000_000, revenue: 20_000_000_000 };
  const apply = (o: object) => post('/api/accounting/entity-profile/apply', { publicAccountability: false, ...answers, taxScheme: 'GENERAL', ...o });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Standar Umum', name: 'Pemilik', email: `ifrs-${Date.now()}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const id = (c: string) => accs.find((a) => a.code === c)!.id;
    await post('/api/accounting/journals', { date: today, description: 'Modal', lines: [{ accountId: id('1-1200'), debit: '500000000' }, { accountId: id('3-1000'), credit: '500000000' }] }).expect(201);
    await post('/api/accounting/journals', { date: today, description: 'Penjualan', lines: [{ accountId: id('1-1200'), debit: '100000000' }, { accountId: id('4-1000'), credit: '100000000' }] }).expect(201);
    await post('/api/accounting/journals', { date: today, description: 'Beban', lines: [{ accountId: id('6-1000'), debit: '20000000' }, { accountId: id('1-1200'), credit: '20000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('IFRS dapat dipilih; nilai tak dikenal ditolak; terbaca di profil pengguna', async () => {
    expect((await patch('/api/settings/reporting', { framework: 'GAAP' })).status).toBe(400);
    await setFramework('IFRS');
    expect((await get('/api/auth/me').expect(200)).body.framework).toBe('IFRS');
    expect((await get('/api/accounting/statements/framework').expect(200)).body.framework).toBe('IFRS');
    expect((await get('/api/settings/company').expect(200)).body.reporting.framework).toBe('IFRS');
  });

  it('kerangka lengkap seperti SAK EP: bagan akun lengkap dan lima laporan dengan pembanding', async () => {
    const accounts = (await get('/api/accounting/accounts').expect(200)).body as { code: string; isActive: boolean }[];
    const active = (c: string) => accounts.find((a) => a.code === c)?.isActive;
    for (const code of ['1-1310', '6-7300', '5-3000', '2-2300', '1-2600', '2-2200']) expect(active(code)).toBe(true);
    const inc = (await get('/api/accounting/statements/income').expect(200)).body;
    expect(inc.framework).toBe('IFRS');
    expect((inc.lines as { key: string }[]).map((l) => l.key)).toContain('OCI');
    expect((await get('/api/accounting/statements/equity').expect(200)).status).toBe(200);
    expect((await get('/api/accounting/statements/cash-flow').expect(200)).status).toBe(200);
    expect(inc.netProfit).toBe('80000000.00');
  });

  it('CALK IFRS: pernyataan kepatuhan, kebijakan instrumen keuangan/sewa/standar baru, risiko keuangan dan manajemen modal', async () => {
    const n = await notes();
    expect(n.framework).toBe('IFRS');
    const keys = n.sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['financial-risk', 'capital']));
    expect(keys.indexOf('financial-risk')).toBeLessThan(keys.indexOf('subsequent'));
    const policies = n.sections.find((s) => s.key === 'policies')!;
    const subTitles = (policies.subsections ?? []).map((s) => s.title).join('|');
    expect(subTitles).toContain('Instrumen keuangan (IFRS 9)');
    expect(subTitles).toContain('Sewa (IFRS 16)');
    expect(subTitles).toContain('Standar baru yang belum berlaku (IAS 8)');
    const text = JSON.stringify(n);
    expect(text).toContain('International Financial Reporting Standards');
    expect(text).toContain('IFRS 15'); // pengakuan pendapatan lima langkah
    expect(text).toContain('IAS 12');
    expect(text).toContain('kerugian kredit ekspektasian');
    expect(text).not.toContain('Standar Akuntansi Keuangan Entitas Privat');
    const capital = n.sections.find((s) => s.key === 'capital')!;
    expect(capital.paragraphs.join(' ')).toContain('rasio liabilitas terhadap ekuitas');
    const approval = n.sections.find((s) => s.key === 'approval')!;
    expect(approval.paragraphs.join(' ')).toContain('sesuai IFRS');
  });

  it('angka tetap sama saat berpindah antar standar; bagian IFRS hilang di SAK EP dan SAK EMKM', async () => {
    const profit = async () => (await get('/api/accounting/statements/income').expect(200)).body.netProfit as string;
    const ifrsProfit = await profit();
    await setFramework('SAK_EP');
    expect(await profit()).toBe(ifrsProfit);
    const ep = await notes();
    expect(ep.sections.map((s) => s.key)).not.toContain('financial-risk');
    expect(JSON.stringify(ep)).toContain('Standar Akuntansi Keuangan Entitas Privat');
    expect(JSON.stringify(ep)).not.toContain('Sewa (IFRS 16)');
    await setFramework('SAK_EMKM');
    expect((await notes()).sections.map((s) => s.key)).not.toContain('capital');
    await setFramework('IFRS');
    expect(await profit()).toBe(ifrsProfit);
    expect(((await get('/api/accounting/statements/financial-position').expect(200)).body as { balanced: boolean }).balanced).toBe(true);
  });

  it('metode persediaan: rujukan IAS 2 dan LIFO dilarang', async () => {
    const cur = (await get('/api/settings/inventory-method').expect(200)).body;
    expect(cur.framework).toBe('IFRS');
    expect(JSON.stringify(cur.guide)).toContain('IAS 2');
    expect(JSON.stringify(cur.guide)).toContain('dilarang');
  });

  it('wizard: akuntabilitas publik wajib IFRS; usaha menengah/besar boleh memilih IFRS; mikro tidak', async () => {
    const pub = (await get('/api/accounting/entity-profile').expect(200)).body;
    expect(pub.recommendation.frameworkAlternatives).toBeDefined();
    const rec = (await post('/api/accounting/entity-profile/recommend', { publicAccountability: true, ...answers }).expect(201)).body;
    expect(rec.recommendation).toMatchObject({ outOfScope: true, framework: 'IFRS', frameworkAlternatives: [] });
    // akuntabilitas publik: SAK EP / EMKM ditolak, IFRS diterima
    const bad = await apply({ publicAccountability: true, framework: 'SAK_EP' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/akuntabilitas publik/i);
    const ok = await apply({ publicAccountability: true, framework: 'IFRS' });
    expect(ok.status).toBe(201);
    expect(ok.body.applied.framework).toBe('IFRS');
    expect(ok.body.simplifications.join(' ')).toContain('dwibahasa');
    // menengah: IFRS sukarela diterima
    await setFramework('SAK_EP');
    expect((await apply({ framework: 'IFRS' })).status).toBe(201);
    // mikro: IFRS tidak memenuhi syarat
    const micro = await apply({ framework: 'IFRS', assets: 100_000_000, revenue: 300_000_000, legalForm: 'UD', taxScheme: 'FINAL_UMKM' });
    expect(micro.status).toBe(400);
    expect(micro.body.message).toContain('IFRS tidak memenuhi syarat');
  });
});
