/**
 * Angsuran PPh 25 = (PPh terutang tahun lalu − kredit PPh 21/22/23/24) ÷ 12.
 * PPh 25 yang sudah dibayar sepanjang tahun TIDAK mengurangi dasar angsuran tahun berikutnya
 * (hanya mengurangi PPh 29 kurang bayar).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Angsuran PPh 25 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const lastYear = new Date().getFullYear() - 1;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object) => http.post(url).set(as()).send(body);
  let ids: Record<string, string> = {};
  const journal = (date: string, debit: string, credit: string, amount: string, description: string) =>
    post('/api/accounting/journals', { date, description, lines: [{ accountId: ids[debit], debit: amount }, { accountId: ids[credit], credit: amount }] }).expect(201);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Angsuran', name: 'Pemilik', email: `pph25-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    ids = Object.fromEntries(((await get('/api/accounting/accounts')).body as { id: string; code: string }[]).map((a) => [a.code, a.id]));
    await http.patch('/api/settings/reporting').set(as()).send({ legalForm: 'PT', taxScheme: 'GENERAL', framework: 'SAK_EP' }).expect(200);
    // laba komersial Rp300 juta tahun lalu (peredaran Rp1 miliar ≤ Rp4,8 miliar → seluruh PKP tarif 11% = Rp33 juta)
    await journal(`${lastYear}-03-10`, '1-1200', '4-1000', '1000000000', 'Penjualan');
    await journal(`${lastYear}-03-11`, '6-6000', '1-1200', '700000000', 'Beban');
  });
  afterAll(() => app.close());

  const reconcile = async () => (await get(`/api/accounting/fiscal/${lastYear}`).expect(200)).body;

  it('tanpa kredit dan tanpa setoran: angsuran = PPh terutang ÷ 12', async () => {
    const r = await reconcile();
    expect(r.taxDue).toBe('33000000.00');
    expect(r.pph29).toBe('33000000.00');
    expect(r.installment25).toBe('2750000.00');
  });

  it('PPh 25 yang dibayar sepanjang tahun mengurangi PPh 29, tetapi tidak mengurangi dasar angsuran tahun berikutnya', async () => {
    for (let m = 1; m <= 6; m++) {
      await post('/api/tax/payments', { type: 'PPH25', period: `${lastYear}-${String(m).padStart(2, '0')}`, date: `${lastYear}-${String(m).padStart(2, '0')}-15`, amount: '2000000' }).expect(201);
    }
    const r = await reconcile();
    expect(r.credits).toBe('12000000.00');
    expect(r.pph29).toBe('21000000.00'); // 33 jt − 12 jt PPh 25 yang sudah disetor
    expect(r.installment25).toBe('2750000.00'); // tetap 33 jt ÷ 12, bukan (33 − 12) ÷ 12 = 1.750.000
  });

  it('kredit PPh 22/23 yang dipotong pihak lain mengurangi dasar angsuran', async () => {
    await journal(`${lastYear}-08-20`, '1-1510', '1-1200', '3000000', 'PPh 23 dipotong pelanggan'); // saldo Pajak Dibayar Dimuka
    const r = await reconcile();
    expect(r.credits).toBe('15000000.00'); // 12 jt PPh 25 + 3 jt PPh 23
    expect(r.pph29).toBe('18000000.00');
    expect(r.installment25).toBe('2500000.00'); // (33 jt − 3 jt) ÷ 12
  });

  it('angsuran dipakai sebagai kewajiban PPh 25 tahun berikutnya di rekap pajak', async () => {
    const period = `${lastYear + 1}-03`;
    const ob = (await get(`/api/tax/obligations?period=${period}`).expect(200)).body as { type: string; outstanding: string }[];
    expect(ob.find((o) => o.type === 'PPH25')!.outstanding).toBe('2500000.00');
  });

  it('PPh terutang nol atau kredit melebihi pajak: tidak ada angsuran', async () => {
    await journal(`${lastYear}-09-01`, '1-1510', '1-1200', '40000000', 'Kredit pajak besar'); // lebih besar dari PPh terutang
    const r = await reconcile();
    expect(r.installment25).toBe('0.00');
  });
});
