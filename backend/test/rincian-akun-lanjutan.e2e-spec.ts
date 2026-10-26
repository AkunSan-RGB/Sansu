/**
 * Rincian akun lanjutan (e2e): rekonsiliasi bank, dibayar di muka (jadwal amortisasi vs saldo), akrual (jurnal balik terjadwal),
 * dan pinjaman (bunga efektif). Semua dicocokkan dengan saldo akhir di laporan keuangan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

interface Item { accountId: string; code: string; kind: string; reported: string; computed: string; matches: boolean; findings: number }
interface Detail { kind: string; computed: string; findings: string[]; tables: { key: string; rows: { cells: Record<string, string | number | null> }[]; total?: Record<string, string | number | null> }[] }

describe('Rincian akun lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: { Authorization: string };
  const year = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const ids: Record<string, string> = {};

  const journal = (description: string, lines: { accountId: string; debit?: string; credit?: string }[], extra: object = {}) =>
    http.post('/api/accounting/journals').set(auth).send({ date: today, description, lines, ...extra }).then((r) => {
      if (r.status !== 201) throw new Error(`${description}: ${JSON.stringify(r.body)}`);
      return r;
    });
  const overview = async () => ((await http.get(`/api/account-schedules?year=${year}`).set(auth).expect(200)).body as { items: Item[] }).items;
  const detail = async (id: string) => (await http.get(`/api/account-schedules/${id}?year=${year}`).set(auth).expect(200)).body as Detail;
  const table = (d: Detail, key: string) => d.tables.find((t) => t.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const owner = (await http.post('/api/auth/register').send({ companyName: 'PT Rincian Lanjutan', name: 'Pemilik', email: `rl-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken as string;
    auth = { Authorization: `Bearer ${owner}` };
    const accs = (await http.get('/api/accounting/accounts').set(auth).expect(200)).body as { id: string; code: string }[];
    for (const c of ['1-1200', '1-1700', '2-1400', '3-1000']) ids[c] = accs.find((a) => a.code === c)!.id;
    const mk = async (code: string, name: string, type: string, reportGroup: string) =>
      (await http.post('/api/accounting/accounts').set(auth).send({ code, name, type, reportGroup }).expect(201)).body.id as string;
    ids.loan = await mk('2-9100', 'Pinjaman Bank Uji', 'LIABILITY', 'LONG_TERM_LOAN');
    ids.interest = await mk('7-9100', 'Bunga Pinjaman Uji', 'EXPENSE', 'FINANCE_COST');
    ids.exp = await mk('6-9200', 'Beban Sewa Uji', 'EXPENSE', 'ADMIN_EXPENSE');
    await journal('Modal', [{ accountId: ids['1-1200'], debit: '100000000' }, { accountId: ids['3-1000'], credit: '100000000' }]);
    await journal('Pencairan pinjaman', [{ accountId: ids['1-1200'], debit: '50000000' }, { accountId: ids.loan, credit: '50000000' }]);
    await journal('Bunga pinjaman', [{ accountId: ids.interest, debit: '500000' }, { accountId: ids['1-1200'], credit: '500000' }]);
    await journal('Sewa dibayar di muka', [{ accountId: ids['1-1700'], debit: '12000000' }, { accountId: ids['1-1200'], credit: '12000000' }]);
    await journal('Amortisasi sewa dua bulan', [{ accountId: ids.exp, debit: '2000000' }, { accountId: ids['1-1700'], credit: '2000000' }]);
    const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1);
    await http.post('/api/accounting/recurring').set(auth).send({ name: 'Amortisasi sewa', description: 'Amortisasi sewa dibayar di muka', frequency: 'MONTHLY', nextDate: next.toISOString().slice(0, 10), remaining: 8, lines: [{ accountId: ids.exp, debit: '1000000' }, { accountId: ids['1-1700'], credit: '1000000' }] }).expect(201);
    await journal('Akrual gaji', [{ accountId: ids.exp, debit: '300000' }, { accountId: ids['2-1400'], credit: '300000' }], { adjustment: true, autoReverse: true });
  });
  afterAll(() => app.close());

  it('semua akun tetap cocok dengan saldo akhir di laporan keuangan', async () => {
    expect((await overview()).filter((i) => !i.matches).map((i) => `${i.code} ${i.kind} laporan=${i.reported} jadwal=${i.computed}`)).toEqual([]);
  });

  it('dibayar di muka: saldo akhir dibandingkan dengan sisa jadwal amortisasi dan selisihnya ditandai', async () => {
    const it = (await overview()).find((i) => i.accountId === ids['1-1700'])!;
    expect(it.kind).toBe('PREPAID');
    expect(Number(it.computed)).toBe(10000000);
    const d = await detail(it.accountId);
    expect(Number(table(d, 'amortization-schedule').total!.total)).toBe(8000000);
    expect(d.findings.join(' ')).toMatch(/belum terjadwal/);
    expect(table(d, 'journal-additions').rows.length).toBeGreaterThan(1);
  });

  it('pinjaman: pencairan per jurnal dan bunga efektif dari beban keuangan', async () => {
    const it = (await overview()).find((i) => i.accountId === ids.loan)!;
    expect(it.kind).toBe('LOAN');
    expect(Number(it.reported)).toBe(50000000);
    const d = await detail(it.accountId);
    expect(Number(table(d, 'loan-interest').total!.interest)).toBe(500000);
    expect(Number(table(d, 'journal-additions').total!.amount)).toBe(50000000);
  });

  it('akrual: jurnal balik terjadwal yang menunggu ditampilkan dan dibandingkan dengan saldo', async () => {
    const it = (await overview()).find((i) => i.accountId === ids['2-1400'])!;
    expect(it.kind).toBe('ACCRUAL');
    const d = await detail(it.accountId);
    expect(table(d, 'scheduled-reversals').rows.length).toBe(1);
    expect(Number(table(d, 'scheduled-reversals').total!.amount)).toBe(300000);
  });

  it('bank: rekonsiliasi pada tanggal laporan tersedia, tanpa rekening koran ditandai', async () => {
    const it = (await overview()).find((i) => i.accountId === ids['1-1200'])!;
    expect(it.kind).toBe('BANK');
    const d = await detail(it.accountId);
    const rec = table(d, 'bank-reconciliation');
    expect(rec.rows.some((r) => String(r.cells.desc).startsWith('Saldo menurut buku'))).toBe(true);
    expect(d.findings.join(' ')).toMatch(/rekening koran/i);
  });

  it('bank dengan rekening koran: saldo bank, pembayaran belum cair, mutasi belum dibukukan, dan selisih nol', async () => {
    const st = (
      await http.post('/api/bank/statements').set(auth).send({
        cashAccountId: ids['1-1200'],
        lines: [
          { date: today, description: 'SETOR MODAL', amount: '100000000', balance: '100000000' },
          { date: today, description: 'CAIR PINJAMAN', amount: '50000000', balance: '150000000' },
          { date: today, description: 'BUNGA PINJAMAN', amount: '-500000', balance: '149500000' },
          { date: today, description: 'BIAYA ADMIN BANK', amount: '-25000', balance: '149475000' },
        ],
      }).expect(201)
    ).body as { id: string };
    await http.post(`/api/bank/statements/${st.id}/auto-match`).set(auth).expect(201);
    const d = await detail(ids['1-1200']);
    const rows = table(d, 'bank-reconciliation').rows.map((r) => ({ desc: String(r.cells.desc), amount: r.cells.amount }));
    const amount = (prefix: string) => Number(rows.find((r) => r.desc.startsWith(prefix))!.amount);
    expect(amount('Saldo menurut rekening koran')).toBe(149475000);
    expect(amount('(−) Pembayaran yang belum dicairkan')).toBe(-12000000); // sewa dibayar di muka belum muncul di bank
    expect(amount('(+/−) Mutasi bank yang belum dibukukan')).toBe(-25000); // biaya admin belum dijurnal
    expect(amount('Saldo bank setelah disesuaikan')).toBe(137475000);
    expect(amount('Saldo buku setelah disesuaikan')).toBe(137475000);
    expect(amount('Selisih')).toBe(0);
    expect(d.findings.join(' ')).not.toMatch(/belum selisih nol|Belum ada rekening koran/);
    expect(d.findings.join(' ')).toMatch(/Desember .* belum disahkan/);
  });
});

