/**
 * Uang masuk di luar penjualan: Keuangan memilih SUMBER (modal, pinjaman, bunga, lain-lain), sistem menentukan akun dan jurnalnya.
 * Keuangan tidak memilih akun pembukuan; sumber yang mengubah modal/utang wajib bukti; penjualan lewat kas masuk ditandai.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Sumber uang masuk (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let fin: string;
  let bankId: string; let kasId: string; let salesId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const cashIn = (lines: object[], extra: object = {}, t = fin) => post('/api/cash/transactions', { type: 'IN', cashAccountId: kasId, date: today, description: 'Uang masuk uji', lines, ...extra }, t);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Sumber Kas', name: 'P', email: `su-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'fin', email: `su-fin-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `su-fin-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const accs = (await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    bankId = accs.find((a) => a.code === '1-1200')!.id;
    kasId = accs.find((a) => a.code === '1-1100')!.id;
    salesId = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '4-1000')!.id;
  });
  afterAll(() => app.close());

  it('Keuangan wajib memilih sumber (bukan akun); sumber bbukti-wajib butuh referensi', async () => {
    expect((await cashIn([{ accountId: salesId, amount: '100000' }])).status).toBe(400); // akun pembukuan bukan tugas Keuangan
    expect((await cashIn([{ source: 'OWNER_CAPITAL', amount: '1000000' }])).status).toBe(400); // tanpa bukti
    expect((await cashIn([{ source: 'OWNER_CAPITAL', accountId: salesId, amount: '1000000' }], { reference: 'BUKTI-1' })).status).toBe(400); // keduanya
    expect((await cashIn([{ source: 'NGAWUR', amount: '1000000' }], { reference: 'X' })).status).toBe(400);
    await cashIn([{ source: 'OWNER_CAPITAL', amount: '1000000' }], { reference: 'Bukti setor modal 01' }).then((r) => expect(r.status).toBe(201));
    await cashIn([{ source: 'INTEREST', amount: '25000' }]).then((r) => expect(r.status).toBe(201)); // bunga tanpa referensi boleh
    await cashIn([{ source: 'LOAN_BANK', amount: '5000000' }], { reference: 'Perjanjian kredit 7' }).then((r) => expect(r.status).toBe(201));
    // sumber hanya untuk kas masuk
    expect((await post('/api/cash/transactions', { type: 'OUT', cashAccountId: kasId, date: today, description: 'x', lines: [{ source: 'INTEREST', amount: '1000' }] }, fin)).status).toBe(400);
  });

  it('sistem menjurnal ke akun yang benar dan memisahkannya dari penjualan', async () => {
    // Pemilik boleh memakai akun langsung: penjualan yang dicatat lewat kas masuk ditandai mencurigakan
    await cashIn([{ accountId: salesId, amount: '700000' }], {}, owner).then((r) => expect(r.status).toBe(201));
    const r = (await get(`/api/cash/income-sources?from=${today}&to=${today}`, fin).expect(200)).body as { rows: { label: string; group: string; amount: number; suspect?: string }[]; totals: { sales: number; nonSales: number }; categories: { sales: number; capital: number; loan: number; other: number } };
    const label = (s: string) => r.rows.find((x) => x.label.includes(s))!;
    expect(label('Modal Disetor')).toMatchObject({ group: 'NONSALES', amount: 1_000_000 });
    expect(label('Utang Bank Jangka Pendek')).toMatchObject({ group: 'NONSALES', amount: 5_000_000 });
    expect(label('Bunga')).toMatchObject({ group: 'NONSALES', amount: 25_000 });
    const bypass = r.rows.find((x) => x.suspect);
    expect(bypass?.group).toBe('SALES');
    expect(bypass?.amount).toBe(700_000);
    expect(r.totals.nonSales).toBe(6_025_000);
    expect(r.categories).toMatchObject({ capital: 1_000_000, loan: 5_000_000, other: 25_000 });
    expect(r.categories.sales).toBeGreaterThanOrEqual(700_000);
  });

  it('mutasi bank masuk: Keuangan memilih sumber, tidak memilih akun', async () => {
    const st = (await post('/api/bank/statements', { cashAccountId: bankId, lines: [{ date: today, description: 'BUNGA TABUNGAN', amount: '12000' }, { date: today, description: 'TRSF TIDAK DIKENAL', amount: '-4000' }] }, fin).expect(201)).body;
    const lineIn = st.lines.find((l: { amount: string }) => Number(l.amount) > 0) ?? st.lines[0];
    const out = st.lines.find((l: { amount: string }) => Number(l.amount) < 0);
    // aturan otomatis bisa saja sudah menjurnal; hanya uji bila masih belum diproses
    if (lineIn.status === 'UNMATCHED') {
      expect((await post(`/api/bank/lines/${lineIn.id}/create`, { accountId: salesId }, fin)).status).toBe(400);
      expect((await post(`/api/bank/lines/${lineIn.id}/create`, { source: 'INTEREST', accountId: salesId }, fin)).status).toBe(400);
      await post(`/api/bank/lines/${lineIn.id}/create`, { source: 'INTEREST' }, fin).then((r) => expect(r.status).toBe(201));
    }
    if (out?.status === 'UNMATCHED') expect((await post(`/api/bank/lines/${out.id}/create`, { source: 'INTEREST' }, fin)).status).toBe(400); // keluar tidak punya sumber
  });
});
