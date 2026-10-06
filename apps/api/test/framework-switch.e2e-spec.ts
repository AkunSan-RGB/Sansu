/**
 * Memilih SAK EMKM / SAK EP harus langsung mengubah seluruh akuntansi pada perusahaan yang sama:
 * bagan akun, susunan laba rugi, CALK, pajak tangguhan di rekonsiliasi fiskal, dan cek kesehatan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pindah standar SAK EP ↔ SAK EMKM mengubah seluruh akuntansi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const setFramework = (framework: string) => http.patch('/api/settings/reporting').set(as()).send({ framework }).expect(200);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Ganti Standar', name: 'Pemilik', email: `fw-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const id = (c: string) => accs.find((a) => a.code === c)!.id;
    await post('/api/accounting/journals', { date: today, description: 'Modal', lines: [{ accountId: id('1-1200'), debit: '500000000' }, { accountId: id('3-1000'), credit: '500000000' }] }).expect(201);
    await post('/api/accounting/journals', { date: today, description: 'Penjualan', lines: [{ accountId: id('1-1200'), debit: '100000000' }, { accountId: id('4-1000'), credit: '100000000' }] }).expect(201);
    const cat = ((await get('/api/assets/categories').expect(200)).body as { id: string; name: string }[]).find((c) => c.name === 'Inventaris Kantor')!.id;
    await post('/api/assets', { name: 'Laptop', categoryId: cat, acquisitionDate: today, cost: '12000000', funding: 'CASH', cashAccountId: id('1-1200') }).expect(201);
  });
  afterAll(() => app.close());

  const snapshot = async () => {
    const inc = (await get('/api/accounting/statements/income').expect(200)).body;
    const notes = (await get(`/api/accounting/notes/${year}`).expect(200)).body;
    const fiscal = (await get(`/api/accounting/fiscal/${year}`).expect(200)).body;
    const health = (await get('/api/accounting/health').expect(200)).body.checks as { key: string }[];
    const accounts = (await get('/api/accounting/accounts').expect(200)).body as { code: string; isActive: boolean }[];
    return {
      framework: (await get('/api/accounting/statements/framework').expect(200)).body.framework as string,
      incomeKeys: (inc.lines as { key: string }[]).map((l) => l.key),
      noteSections: (notes.sections as { key: string }[]).map((s) => s.key),
      deferredTax: fiscal.deferred,
      healthKeys: health.map((h) => h.key),
      inactive: accounts.filter((a) => !a.isActive).map((a) => a.code),
      netProfit: inc.netProfit as string,
      balanced: ((await get('/api/accounting/statements/financial-position').expect(200)).body as { balanced: boolean }).balanced,
    };
  };

  it('SAK EP: laba rugi dan penghasilan komprehensif, pajak tangguhan dihitung, bagan akun lengkap', async () => {
    const s = await snapshot();
    expect(s.framework).toBe('SAK_EP');
    expect(s.incomeKeys).toEqual(expect.arrayContaining(['GROSS_PROFIT', 'OPERATING_PROFIT', 'OCI', 'TOTAL_COMPREHENSIVE']));
    expect(s.noteSections).toContain('revenue');
    expect(s.deferredTax).toBeTruthy();
    expect(s.inactive).not.toContain('1-2600');
    expect(s.inactive).not.toContain('2-2200');
  });

  it('pindah ke SAK EMKM: laba rugi ringkas, CALK tanpa bagian EP, tanpa pajak tangguhan, akun EP disembunyikan, angka tetap sama', async () => {
    const before = await snapshot();
    await setFramework('SAK_EMKM');
    const s = await snapshot();
    expect(s.framework).toBe('SAK_EMKM');
    expect(s.incomeKeys).toEqual(['REVENUE', 'OTHER_REVENUE', 'TOTAL_REVENUE', 'COST_OF_SALES', 'OPERATING_EXPENSE', 'OTHER_EXPENSE', 'TOTAL_EXPENSE', 'PROFIT_BEFORE_TAX', 'INCOME_TAX', 'NET_PROFIT']);
    expect(s.incomeKeys).not.toContain('OCI');
    expect(s.noteSections).not.toContain('revenue');
    expect(s.deferredTax ?? null).toBeNull();
    expect(s.healthKeys).toContain('threshold-umkm-size');
    expect(s.inactive).toEqual(expect.arrayContaining(['1-2600', '2-2300', '9-1100', '2-2200', '1-1310', '6-7300', '5-3000']));
    expect(s.healthKeys).not.toContain('bad-debt');
    // pergantian standar tidak mengubah angka pembukuan
    expect(s.netProfit).toBe(before.netProfit);
    expect(s.balanced).toBe(true);
  });

  it('SAK EMKM: CALK tanpa penurunan nilai, nilai residu aset ditolak, penyesuaian piutang tidak berlaku', async () => {
    await setFramework('SAK_EMKM');
    const notes = JSON.stringify((await get(`/api/accounting/notes/${year}`).expect(200)).body);
    expect(notes).toContain('Piutang usaha dicatat sebesar jumlah tagihan');
    expect(notes).toContain('Persediaan diukur sebesar biaya perolehan');
    expect(notes).not.toContain('akumulasi rugi penurunan nilai');
    expect(notes).not.toContain('nilai realisasi neto');
    const cat = ((await get('/api/assets/categories').expect(200)).body as { id: string; name: string }[]).find((c) => c.name === 'Inventaris Kantor')!.id;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const res = await post('/api/assets', { name: 'Meja', categoryId: cat, acquisitionDate: today, cost: '5000000', residualValue: '500000', funding: 'CASH', cashAccountId: accs.find((a) => a.code === '1-1200')!.id });
    expect(res.status).toBe(400);
    const chk = (await get(`/api/accounting/adjustments/checklist?period=${today.slice(0, 7)}`).expect(200)).body.items as { key: string; status: string }[];
    expect(chk.find((i) => i.key === 'bad-debt')?.status).toBe('NA');
  });

  it('SAK EMKM: penurunan nilai persediaan dan akrual persentase penyelesaian ditolak, menu mengikuti', async () => {
    await setFramework('SAK_EMKM');
    expect((await get('/api/auth/me').expect(200)).body.framework).toBe('SAK_EMKM');
    const zero = '00000000-0000-4000-8000-000000000000';
    const wd = await post('/api/inventory/writedowns', { date: today, warehouseId: zero, reason: 'Harga turun', lines: [{ productId: zero, newCost: '1' }] });
    expect(wd.status).toBe(400);
    expect(wd.body.message).toContain('SAK EMKM');
    const pr = await post(`/api/services/projects/${zero}/progress`, { date: today, percent: '30' });
    expect(pr.status).toBe(400);
    expect(pr.body.message).toContain('SAK EMKM');
    await setFramework('SAK_EP');
    expect((await get('/api/auth/me').expect(200)).body.framework).toBe('SAK_EP');
  });

  it('kembali ke SAK EP: semuanya pulih', async () => {
    await setFramework('SAK_EP');
    const s = await snapshot();
    expect(s.framework).toBe('SAK_EP');
    expect(s.incomeKeys).toContain('OCI');
    expect(s.noteSections).toContain('revenue');
    expect(s.deferredTax).toBeTruthy();
    expect(s.inactive).not.toContain('1-2600');
    expect(s.inactive).not.toContain('2-2200');
    expect(s.inactive).not.toEqual(expect.arrayContaining(['1-1310']));
    expect(s.healthKeys).toContain('bad-debt');
    expect(s.healthKeys).not.toContain('threshold-umkm-size');
  });
});
