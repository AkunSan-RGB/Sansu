/**
 * Akuntansi SAK EP lengkap (e2e): bagan akun berkelompok, jurnal penyesuaian & berulang,
 * aset tetap & penyusutan, laporan posisi keuangan / laba rugi / perubahan ekuitas /
 * arus kas (tidak langsung & langsung), neraca saldo, neraca lajur, rekonsiliasi fiskal,
 * pajak tangguhan, cek kesehatan, dan CALK otomatis.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Akuntansi SAK EP (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let accounts: { id: string; code: string; reportGroup: string; systemKey: string | null; fiscalTreatment: string }[];
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const get = (url: string) => http.get(url).set({ Authorization: `Bearer ${token}` });
  const post = (url: string, body: object = {}) => http.post(url).set({ Authorization: `Bearer ${token}` }).send(body);
  const put = (url: string, body: object = {}) => http.put(url).set({ Authorization: `Bearer ${token}` }).send(body);
  const patch = (url: string, body: object = {}) => http.patch(url).set({ Authorization: `Bearer ${token}` }).send(body);
  const P = '?from=2026-01-01&to=2026-10-04';
  const num = (v: string) => Number(v);
  const line = (r: { lines: { key: string; amount: string }[] }, k: string) => num(r.lines.find((l) => l.key === k)!.amount);
  const item = (s: { items: { label: string; amount: string }[] }, label: string) => num(s.items.find((i) => i.label === label)?.amount ?? '0');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Laporan Lengkap', name: 'Pemilik', email: `sak-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;
    accounts = (await get('/api/accounting/accounts')).body;
  });
  afterAll(() => app.close());

  it('bagan akun SAK EP: semua akun berkelompok, kategori aset bawaan tersedia', async () => {
    expect(accounts.filter((a) => a.code.endsWith('000') === false && !a.reportGroup)).toHaveLength(0);
    expect(accounts.find((a) => a.code === '1-1300')!.reportGroup).toBe('TRADE_RECEIVABLE');
    expect(accounts.find((a) => a.code === '2-2100')!.reportGroup).toBe('LONG_TERM_LOAN');
    expect(accounts.find((a) => a.code === '6-8000')!.fiscalTreatment).toBe('NON_DEDUCTIBLE');
    const cats = (await get('/api/assets/categories').expect(200)).body;
    expect(cats.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Kendaraan', 'Inventaris Kantor', 'Tanah']));
    // akun baru: kelompok wajib sesuai tipe
    await post('/api/accounting/accounts', { code: '6-9900', name: 'Beban Uji', type: 'EXPENSE', parentId: acc('6-0000'), reportGroup: 'TRADE_PAYABLE' }).expect(400);
    const created = await post('/api/accounting/accounts', { code: '6-9900', name: 'Beban Uji', type: 'EXPENSE', parentId: acc('6-0000'), reportGroup: 'SELLING_EXPENSE' }).expect(201);
    await patch(`/api/accounting/accounts/${created.body.id}`, { fiscalTreatment: 'NON_DEDUCTIBLE' }).expect(200);
    await http.delete(`/api/accounting/accounts/${created.body.id}`).set({ Authorization: `Bearer ${token}` }).expect(200);
  });

  it('transaksi tahun 2026: saldo awal, jurnal bukti, jurnal berulang', async () => {
    await post('/api/accounting/opening-balances', {
      date: '2025-12-31',
      lines: [
        { accountId: acc('1-1100'), debit: '200000000' },
        { accountId: acc('3-1000'), credit: '200000000' },
      ],
    }).expect(201);
    const j = (date: string, description: string, lines: object[], extra: object = {}) =>
      post('/api/accounting/journals', { date, description, lines, reference: 'BKT-01', ...extra }).expect(201);
    await j('2026-01-10', 'Bayar sewa gudang setahun', [
      { accountId: acc('1-1700'), debit: '12000000' },
      { accountId: acc('1-1100'), credit: '12000000' },
    ]);
    await j('2026-03-15', 'Penjualan tunai', [
      { accountId: acc('1-1100'), debit: '30000000' },
      { accountId: acc('4-1000'), credit: '30000000' },
    ]);
    await j('2026-04-20', 'Jamuan pelanggan', [
      { accountId: acc('6-8000'), debit: '2000000' },
      { accountId: acc('1-1100'), credit: '2000000' },
    ]);
    await j(
      '2026-05-31',
      'Bunga deposito',
      [
        { accountId: acc('1-1100'), debit: '500000' },
        { accountId: acc('4-9100'), credit: '500000' },
      ],
      { reference: '' },
    );
    await j('2026-08-01', 'Prive pemilik', [
      { accountId: acc('3-3000'), debit: '5000000' },
      { accountId: acc('1-1100'), credit: '5000000' },
    ]);
    await post('/api/accounting/recurring', {
      name: 'Amortisasi sewa',
      description: 'Amortisasi sewa dibayar dimuka',
      frequency: 'MONTHLY',
      nextDate: '2026-01-31',
      remaining: 3,
      lines: [
        { accountId: acc('6-3000'), debit: '1000000' },
        { accountId: acc('1-1700'), credit: '1000000' },
      ],
    }).expect(201);
    const run = await post('/api/accounting/recurring/run').expect(201);
    expect(run.body.posted.map((p: { date: string }) => p.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect((await get('/api/accounting/recurring')).body[0].isActive).toBe(false);
    const adj = await get('/api/accounting/journals?source=ADJUSTMENT').expect(200);
    expect(adj.body).toHaveLength(3);
  });

  it('aset tetap: perolehan, pelepasan dengan rugi, penyusutan s/d September', async () => {
    const cats = (await get('/api/assets/categories')).body as { id: string; name: string }[];
    const cat = (n: string) => cats.find((c) => c.name === n)!.id;
    const kas = acc('1-1100');
    const car = await post('/api/assets', { name: 'Truk Box', categoryId: cat('Kendaraan'), acquisitionDate: '2026-01-15', cost: '120000000', funding: 'CASH', cashAccountId: kas }).expect(201);
    expect(car.body.code).toBe('AT-0001');
    expect(car.body.schedule[0]).toMatchObject({ period: '2026-01', amount: '1250000.00' });
    const desk = await post('/api/assets', { name: 'Meja & komputer', categoryId: cat('Inventaris Kantor'), acquisitionDate: '2026-02-01', cost: '12000000', funding: 'CASH', cashAccountId: kas }).expect(201);
    const disp = await post(`/api/assets/${desk.body.id}/dispose`, { date: '2026-06-15', price: '10000000', cashAccountId: kas }).expect(201);
    expect(disp.body.status).toBe('DISPOSED');
    expect(disp.body.depreciations).toHaveLength(4); // Feb–Mei
    const run = await post('/api/assets/depreciation/run', { period: '2026-09' }).expect(201);
    expect(run.body.journals).toHaveLength(9);
    expect((await post('/api/assets/depreciation/run', { period: '2026-09' }).expect(201)).body.journals).toHaveLength(0);
    const list = (await get('/api/assets?asOf=2026-09-30')).body;
    expect(list.find((a: { code: string }) => a.code === 'AT-0001')).toMatchObject({ accumulated: '11250000.00', bookValue: '108750000.00' });
  });

  it('laba rugi bertingkat SAK EP dengan pembanding', async () => {
    const r = (await get(`/api/accounting/statements/income${P}`).expect(200)).body;
    expect(r.framework).toBe('SAK_EP');
    expect(line(r, 'NET_REVENUE')).toBe(30_000_000);
    expect(line(r, 'GROSS_PROFIT')).toBe(30_000_000);
    expect(line(r, 'ADMIN_EXPENSE')).toBe(-17_250_000); // sewa 3 jt + jamuan 2 jt + penyusutan 12,25 jt
    expect(line(r, 'OPERATING_PROFIT')).toBe(12_750_000);
    expect(line(r, 'OTHER_EXPENSE')).toBe(-1_000_000); // rugi pelepasan
    expect(line(r, 'FINANCE_INCOME')).toBe(500_000);
    expect(line(r, 'PROFIT_BEFORE_TAX')).toBe(12_250_000);
    expect(r.comparePeriod).toEqual({ from: '2025-01-01', to: '2025-10-04' });
    const emkm = (await get(`/api/accounting/statements/income${P}&framework=SAK_EMKM`).expect(200)).body;
    expect(line(emkm, 'NET_PROFIT')).toBe(12_250_000);
  });

  it('laporan posisi keuangan lancar/tidak lancar seimbang, pembanding 31 Des 2025', async () => {
    const r = (await get('/api/accounting/statements/financial-position?asOf=2026-10-04').expect(200)).body;
    expect(r.balanced).toBe(true);
    expect(r.compareAsOf).toBe('2025-12-31');
    const sec = (k: string) => r.sections.find((s: { key: string }) => s.key === k);
    expect(num(sec('CURRENT_ASSET').total)).toBe(98_500_000); // kas 89,5 jt + sewa dimuka 9 jt
    expect(num(sec('NONCURRENT_ASSET').total)).toBe(108_750_000);
    expect(num(r.totals.equity.amount)).toBe(207_250_000);
    expect(num(r.totals.assets.compare)).toBe(200_000_000);
  });

  it('laporan perubahan ekuitas', async () => {
    const r = (await get(`/api/accounting/statements/equity${P}`).expect(200)).body;
    const row = (k: string) => r.current.rows.find((x: { key: string }) => x.key === k).values;
    expect(row('OPENING')).toMatchObject({ SHARE_CAPITAL: '200000000.00', TOTAL: '200000000.00' });
    expect(row('PROFIT').RETAINED).toBe('12250000.00');
    expect(row('DIVIDEND').RETAINED).toBe('-5000000.00');
    expect(row('CLOSING')).toMatchObject({ RETAINED: '7250000.00', TOTAL: '207250000.00' });
  });

  it('arus kas tidak langsung & langsung sama dan cocok dengan saldo kas', async () => {
    const ind = (await get(`/api/accounting/statements/cash-flow${P}`).expect(200)).body.current;
    expect(ind.difference).toBe('0.00');
    expect(num(ind.opening)).toBe(200_000_000);
    expect(num(ind.actualClosing)).toBe(89_500_000);
    expect(num(ind.operating.total)).toBe(16_500_000);
    expect(item(ind.operating, 'Penyusutan dan amortisasi')).toBe(12_250_000);
    expect(item(ind.operating, '(Laba) rugi pelepasan aset tetap')).toBe(1_000_000);
    expect(num(ind.investing.total)).toBe(-122_000_000);
    expect(item(ind.investing, 'Hasil pelepasan aset tetap')).toBe(10_000_000);
    expect(num(ind.financing.total)).toBe(-5_000_000);

    const dir = (await get(`/api/accounting/statements/cash-flow${P}&method=direct`).expect(200)).body.current;
    expect(dir.difference).toBe('0.00');
    expect(num(dir.operating.total)).toBe(16_500_000);
    expect(item(dir.operating, 'Penerimaan dari pelanggan')).toBe(30_000_000);
    expect(item(dir.investing, 'Perolehan aset tetap')).toBe(-132_000_000);
    expect(num(dir.financing.total)).toBe(-5_000_000);
  });

  it('neraca saldo lengkap & neraca lajur seimbang', async () => {
    const tb = (await get(`/api/accounting/statements/trial-balance${P}`).expect(200)).body;
    expect(tb.balanced).toBe(true);
    const kas = tb.rows.find((r: { code: string }) => r.code === '1-1100');
    expect(kas.opening.debit).toBe('200000000.00');
    expect(kas.closing.debit).toBe('89500000.00');
    const ws = (await get(`/api/accounting/statements/worksheet${P}`).expect(200)).body;
    expect(ws.balanced).toBe(true);
    expect(num(ws.netProfit)).toBe(12_250_000);
    expect(num(ws.totals.adjustment.debit)).toBe(3_000_000 + 11_250_000 + 1_000_000); // amortisasi sewa + penyusutan truk + meja
  });

  it('rekonsiliasi fiskal: koreksi, Pasal 31E, pajak tangguhan, jurnal pajak', async () => {
    const f = (await get('/api/accounting/fiscal/2026').expect(200)).body;
    expect(num(f.profitBeforeTax)).toBe(12_250_000);
    expect(f.positive.map((p: { label: string }) => p.label)).toEqual(expect.arrayContaining([expect.stringContaining('Jamuan')]));
    expect(num(f.totalPositive)).toBe(2_000_000);
    // bunga deposito (PPh final) 500 rb + selisih penyusutan truk (fiskal 15 jt − komersial 11,25 jt)
    expect(num(f.totalNegative)).toBe(500_000 + 3_750_000);
    expect(num(f.pkp)).toBe(10_000_000);
    expect(num(f.taxDue)).toBe(1_100_000); // 11% (Pasal 31E, peredaran bruto < 4,8 M)
    expect(f.deferred).toMatchObject({ temporaryDifference: '-3750000.00', target: '-825000.00' });
    await post('/api/accounting/fiscal/2026/adjustments', { description: 'Sanksi administrasi', kind: 'POSITIVE', amount: '100000' }).expect(201);
    const f2 = (await get('/api/accounting/fiscal/2026')).body;
    expect(num(f2.pkp)).toBe(10_100_000);
    await http.delete(`/api/accounting/fiscal/2026/adjustments/${f2.positive.find((p: { source: string }) => p.source === 'MANUAL').id}`).set({ Authorization: `Bearer ${token}` }).expect(200);

    const j = await post('/api/accounting/fiscal/2026/journal').expect(201);
    expect(j.body.number).toBeTruthy();
    await post('/api/accounting/fiscal/2026/journal').expect(400);
    const inc = (await get('/api/accounting/statements/income?from=2026-01-01&to=2026-12-31').expect(200)).body;
    expect(line(inc, 'INCOME_TAX')).toBe(-1_925_000); // pajak kini 1,1 jt + tangguhan 825 rb
    expect(line(inc, 'NET_PROFIT')).toBe(10_325_000);
    const fp = (await get('/api/accounting/statements/financial-position?asOf=2026-12-31').expect(200)).body;
    expect(fp.balanced).toBe(true);
  });

  it('cek kesehatan pembukuan & rasio', async () => {
    const h = (await get('/api/accounting/health?asOf=2026-10-04').expect(200)).body;
    const c = (k: string) => h.checks.find((x: { key: string }) => x.key === k);
    expect(c('trial-balance').status).toBe('OK');
    expect(c('cash-flow').status).toBe('OK');
    expect(c('fixed-assets').status).toBe('OK');
    expect(c('accumulated').status).toBe('OK');
    expect(c('no-reference').status).toBe('WARN'); // jurnal bunga tanpa bukti
    expect(c('cash-negative').status).toBe('OK');
    expect(h.score).toBeGreaterThan(0);
    expect(h.ratios.find((r: { key: string }) => r.key === 'gpm').value).toBe(100);
  });

  it('CALK otomatis dengan tabel mutasi aset tetap & teks yang bisa diubah', async () => {
    const n = (await get('/api/accounting/notes/2026').expect(200)).body;
    const keys = n.sections.map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['general', 'policies', 'cash', 'fixed-assets', 'equity', 'income-tax', 'subsequent']));
    expect(n.sections.find((s: { key: string }) => s.key === 'policies').subsections[0].paragraphs[0]).toContain('SAK EP');
    const fa = n.sections.find((s: { key: string }) => s.key === 'fixed-assets');
    const costRow = (cat: string) => fa.tables[0].rows.find((r: string[]) => r[0] === cat);
    expect(costRow('Kendaraan')).toEqual(['Kendaraan', 0, 120000000, 0, 120000000]);
    expect(costRow('Inventaris Kantor')).toEqual(['Inventaris Kantor', 0, 12000000, 12000000, 0]);
    expect(n.refs.FIXED_ASSET).toBe(fa.number);
    const saved = (await put('/api/accounting/notes/2026/subsequent', { content: 'Pada 5 Januari 2027 Perusahaan membeli gudang baru.' }).expect(200)).body;
    const sub = saved.sections.find((s: { key: string }) => s.key === 'subsequent');
    expect(sub).toMatchObject({ edited: true, paragraphs: ['Pada 5 Januari 2027 Perusahaan membeli gudang baru.'] });
    // ganti ke SAK EMKM
    await patch('/api/settings/reporting', { framework: 'SAK_EMKM', taxScheme: 'GENERAL' }).expect(200);
    const emkm = (await get('/api/accounting/notes/2026').expect(200)).body;
    expect(emkm.sections.find((s: { key: string }) => s.key === 'policies').subsections[0].paragraphs[0]).toContain('SAK EMKM');
  });
});
