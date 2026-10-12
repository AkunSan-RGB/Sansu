/**
 * Tenggat pajak digeser ke hari kerja berikutnya (akhir pekan + hari libur isian pengguna)
 * dan pembulatan PPN ke rupiah penuh pada tagihan biaya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Kalender pajak dan pembulatan PPN (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let supplierId: string;
  let expenseId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const patch = (url: string, body: object = {}) => http.patch(url).set(as()).send(body);
  const due = async (type: string, period: string) =>
    ((await get(`/api/tax/obligations?period=${period}`).expect(200)).body as { type: string; dueDate: string }[]).find((o) => o.type === type)!.dueDate;
  let n = 0;
  const bill = (price: string) =>
    post('/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `VAT-${stamp}-${++n}`, lines: [{ type: 'EXPENSE', description: 'Jasa', price, accountId: expenseId }] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Kalender', name: 'Pemilik', email: `cal-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    expenseId = ((await get('/api/accounting/accounts').expect(200)).body as { code: string; id: string }[]).find((a) => a.code === '6-6100')!.id;
    supplierId = (await post('/api/suppliers', { code: 'SUP-CAL', name: 'Pemasok' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('tenggat jatuh Minggu digeser ke Senin', async () => {
    expect(await due('PPH21', '2026-12')).toBe('2027-01-11'); // 10 Jan 2027 = Minggu
    expect(await due('PPH21', '2026-02')).toBe('2026-03-10'); // Selasa, tidak berubah
  });

  it('hari libur isian pengguna menggeser tenggat; format salah ditolak', async () => {
    await patch('/api/settings/company', { holidays: ['2026-03-10', 'bukan-tanggal'] }).expect(400);
    const r = await patch('/api/settings/company', { holidays: ['2026-03-10', '2026-03-10'] }).expect(200);
    expect(r.body.taxProfile.holidays).toEqual(['2026-03-10']); // duplikat dibuang
    expect(await due('PPH21', '2026-02')).toBe('2026-03-11');
  });

  it('pembulatan PPN: bawaan dua desimal, lalu ke terdekat, lalu ke bawah; jurnal tetap seimbang', async () => {
    const vat = async (price: string) => {
      const r = await bill(price);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return Number(r.body.taxAmount);
    };
    expect(await vat('1015')).toBeCloseTo(111.65, 2);
    await patch('/api/settings/company', { vatRounding: 'NEAREST' }).expect(200);
    expect(await vat('1015')).toBe(112);
    await patch('/api/settings/company', { vatRounding: 'DOWN' }).expect(200);
    expect(await vat('1015')).toBe(111);
    await patch('/api/settings/company', { vatRounding: 'BULAT' }).expect(400);
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
  });
});
