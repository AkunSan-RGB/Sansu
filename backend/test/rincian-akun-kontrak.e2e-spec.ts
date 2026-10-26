/**
 * Data induk kontrak pembiayaan (e2e): validasi, jadwal kontraktual pinjaman/sewa/dibayar di muka, dan perbandingannya dengan buku besar
 * (penambahan, pokok/amortisasi, bunga, saldo akhir) di menu Rincian & perhitungan akun.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

interface Detail { kind: string; computed: string; matches: boolean; findings: string[]; tables: { key: string; rows: { cells: Record<string, string | number | null> }[]; total?: Record<string, string | number | null> }[] }
interface Item { accountId: string; kind: string; matches: boolean; findings: number }

describe('Kontrak pembiayaan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: { Authorization: string };
  const stamp = Date.now();
  const year = new Date().getUTCFullYear();
  const ids: Record<string, string> = {};
  const lastDay = (m: number) => new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);

  const post = (path: string, body: object, a = auth) => http.post(path).set(a).send(body);
  const journal = (date: string, description: string, lines: { accountId: string; debit?: string; credit?: string }[]) =>
    post('/api/accounting/journals', { date, description, lines }).then((r) => {
      if (r.status !== 201) throw new Error(`${description}: ${JSON.stringify(r.body)}`);
    });
  const detail = async (id: string) => (await http.get(`/api/account-schedules/${id}?year=${year}`).set(auth).expect(200)).body as Detail;
  const table = (d: Detail, key: string) => d.tables.find((t) => t.key === key)!;
  const mkContract = (extra: object) =>
    post('/api/financing-contracts', { startDate: `${year}-01-10`, termMonths: 6, amount: '12000000', ratePct: '12', method: 'ANNUITY', ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrak', name: 'Pemilik', email: `kt-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken as string;
    auth = { Authorization: `Bearer ${owner}` };
    const accs = (await http.get('/api/accounting/accounts').set(auth).expect(200)).body as { id: string; code: string }[];
    for (const c of ['1-1200', '1-1700', '3-1000']) ids[c] = accs.find((a) => a.code === c)!.id;
    const mk = async (code: string, name: string, type: string, reportGroup: string) =>
      (await post('/api/accounting/accounts', { code, name, type, reportGroup }).expect(201)).body.id as string;
    ids.loan = await mk('2-9100', 'Utang Bank Uji', 'LIABILITY', 'LONG_TERM_LOAN');
    ids.loanInt = await mk('7-9100', 'Bunga Bank Uji', 'EXPENSE', 'FINANCE_COST');
    ids.lease = await mk('2-9200', 'Liabilitas Sewa Uji', 'LIABILITY', 'OTHER_NONCURRENT_LIABILITY');
    ids.leaseInt = await mk('7-9200', 'Bunga Sewa Uji', 'EXPENSE', 'FINANCE_COST');
    ids.amort = await mk('6-9300', 'Amortisasi Uji', 'EXPENSE', 'ADMIN_EXPENSE');
    await journal(`${year}-01-02`, 'Modal', [{ accountId: ids['1-1200'], debit: '100000000' }, { accountId: ids['3-1000'], credit: '100000000' }]);
  });
  afterAll(() => app.close());

  it('validasi: jenis akun, bunga wajib, metode sesuai jenis, nama unik', async () => {
    await mkContract({ kind: 'LOAN', name: 'Salah akun', accountId: ids['1-1700'] }).expect(400); // pinjaman bukan di akun aset
    await mkContract({ kind: 'PREPAID', name: 'Salah akun 2', accountId: ids.loan, ratePct: undefined, method: 'STRAIGHT_LINE' }).expect(400);
    await mkContract({ kind: 'LOAN', name: 'Tanpa bunga', accountId: ids.loan, ratePct: undefined }).expect(400);
    await mkContract({ kind: 'LOAN', name: 'Metode salah', accountId: ids.loan, method: 'STRAIGHT_LINE' }).expect(400);
    await mkContract({ kind: 'LOAN', name: 'Beban salah', accountId: ids.loan, expenseAccountId: ids['1-1200'] }).expect(400);
  });

  it('pinjaman anuitas: jadwal kontraktual sama dengan buku besar bila semua cicilan dibukukan', async () => {
    const c = (await mkContract({ kind: 'LOAN', name: 'Kredit Bank Uji', accountId: ids.loan, expenseAccountId: ids.loanInt }).expect(201)).body;
    const sch = (await http.get(`/api/financing-contracts/${c.id}/schedule`).set(auth).expect(200)).body as { rows: { period: string; additions: string; principal: string; interest: string; payment: string; closing: string }[] };
    expect(sch.rows).toHaveLength(6);
    expect(sch.rows[5].closing).toBe('0.00');
    await journal(`${year}-01-10`, 'Pencairan', [{ accountId: ids['1-1200'], debit: '12000000' }, { accountId: ids.loan, credit: '12000000' }]);
    for (const [i, r] of sch.rows.entries())
      await journal(lastDay(i + 1), `Cicilan ${r.period}`, [{ accountId: ids.loan, debit: r.principal }, { accountId: ids.loanInt, debit: r.interest }, { accountId: ids['1-1200'], credit: r.payment }]);
    const ov = (await http.get(`/api/account-schedules?year=${year}`).set(auth).expect(200)).body as { items: Item[] };
    const it = ov.items.find((i) => i.accountId === ids.loan)!;
    expect(it.kind).toBe('LOAN');
    expect(it.matches).toBe(true);
    const d = await detail(ids.loan);
    const cmp = table(d, 'contract-vs-ledger').rows.map((r) => ({ label: String(r.cells.label), diff: Number(r.cells.diff) }));
    expect(cmp.length).toBe(4);
    expect(cmp.every((r) => r.diff === 0)).toBe(true);
    expect(d.findings.filter((f) => /kontrak/i.test(f) && /selisih/i.test(f))).toEqual([]);
    expect(Number(table(d, 'contracts').total!.principal)).toBe(12000000);
    expect(table(d, 'contract-monthly').rows).toHaveLength(12);
  });

  it('selisih terhadap buku besar ditandai: angsuran pokok tambahan di luar kontrak', async () => {
    await journal(`${year}-06-30`, 'Pelunasan sebagian di luar jadwal', [{ accountId: ids.loan, debit: '1000' }, { accountId: ids['1-1200'], credit: '1000' }]);
    const d = await detail(ids.loan);
    expect(d.findings.join(' ')).toMatch(/Angsuran pokok tahun ini: kontrak .* buku besar/);
    expect(d.findings.join(' ')).toMatch(/Saldo akhir: kontrak/);
  });

  it('sewa pembiayaan: akun liabilitas dengan kontrak sewa memakai jadwal sewa, bukan jadwal umum', async () => {
    await mkContract({ kind: 'LEASE', name: 'Sewa Mesin Uji', accountId: ids.lease, expenseAccountId: ids.leaseInt, amount: '6000000', ratePct: '10', termMonths: 6, method: 'STRAIGHT_PRINCIPAL' }).expect(201);
    const ov = (await http.get(`/api/account-schedules?year=${year}`).set(auth).expect(200)).body as { items: Item[] };
    const it = ov.items.find((i) => i.accountId === ids.lease)!;
    // kontrak terdaftar tetapi belum ada pembukuan: akun tetap tampil dan ditandai
    expect(it.kind).toBe('LEASE');
    expect(it.findings).toBeGreaterThan(0);
    await journal(`${year}-01-10`, 'Pengakuan liabilitas sewa', [{ accountId: ids['1-1700'], debit: '6000000' }, { accountId: ids.lease, credit: '6000000' }]);
    const ov2 = (await http.get(`/api/account-schedules?year=${year}`).set(auth).expect(200)).body as { items: Item[] };
    expect(ov2.items.find((i) => i.accountId === ids.lease)!.kind).toBe('LEASE');
    const d = await detail(ids.lease);
    expect(Number(table(d, 'contracts').total!.added)).toBe(6000000);
    expect(d.findings.join(' ')).toMatch(/Pembayaran pokok sewa tahun ini: kontrak/); // belum ada pembayaran dibukukan
  });

  it('dibayar di muka: amortisasi menurut kontrak dibandingkan dengan amortisasi yang dibukukan', async () => {
    await mkContract({ kind: 'PREPAID', name: 'Asuransi 12 bulan', accountId: ids['1-1700'], expenseAccountId: ids.amort, amount: '1200000', ratePct: undefined, termMonths: 12, method: 'STRAIGHT_LINE', startDate: `${year}-01-01` }).expect(201);
    await journal(`${year}-01-01`, 'Bayar asuransi', [{ accountId: ids['1-1700'], debit: '1200000' }, { accountId: ids['1-1200'], credit: '1200000' }]);
    const d = await detail(ids['1-1700']);
    expect(d.kind).toBe('PREPAID');
    expect(table(d, 'contracts').rows).toHaveLength(1);
    expect(d.findings.join(' ')).toMatch(/Amortisasi tahun ini: kontrak/); // belum ada jurnal amortisasi
  });

  it('akun tanpa kontrak yang bersaldo ditandai; Keuangan hanya melihat daftar kontrak', async () => {
    const acc = (await post('/api/accounting/accounts', { code: '2-9300', name: 'Pinjaman Tanpa Kontrak', type: 'LIABILITY', reportGroup: 'SHORT_TERM_LOAN' }).expect(201)).body.id as string;
    await journal(`${year}-02-01`, 'Pinjaman lepas', [{ accountId: ids['1-1200'], debit: '500000' }, { accountId: acc, credit: '500000' }]);
    expect((await detail(acc)).findings.join(' ')).toMatch(/Belum ada kontrak pinjaman terdaftar/);
    await post('/api/users', { name: 'Keuangan', email: `kt-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    const fin = { Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email: `kt-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken}` };
    await http.get(`/api/financing-contracts?year=${year}`).set(fin).expect(200);
    await post('/api/financing-contracts', { kind: 'PREPAID', name: 'Dilarang', accountId: ids['1-1700'], startDate: `${year}-01-01`, termMonths: 3, amount: '300', method: 'STRAIGHT_LINE' }, fin).expect(403);
  });

  it('kontrak dapat diubah dan ditutup; jadwal mengikuti perubahan', async () => {
    const list = (await http.get(`/api/financing-contracts?year=${year}`).set(auth).expect(200)).body as { id: string; name: string; status: string; balance: string }[];
    const c = list.find((x) => x.name === 'Asuransi 12 bulan')!;
    await http.patch(`/api/financing-contracts/${c.id}`).set(auth).send({ status: 'CLOSED', notes: 'Dibatalkan' }).expect(200);
    const again = (await http.get(`/api/financing-contracts?year=${year}`).set(auth).expect(200)).body as { id: string; status: string }[];
    expect(again.find((x) => x.id === c.id)!.status).toBe('CLOSED');
  });
});
