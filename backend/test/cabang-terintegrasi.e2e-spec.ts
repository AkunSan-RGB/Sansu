/**
 * Cabang terintegrasi (e2e): gaji per cabang karyawan, penyusutan & pindah cabang aset, kas/bank mengikuti cabang rekening,
 * pusat membayar biaya cabang (Rekening Antar Cabang otomatis), produksi di gudang cabang, filter buku besar/neraca saldo,
 * dan pembatasan pengguna ke cabangnya sendiri.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Cabang terintegrasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let owner: string;
  let tenantId: string;
  let W1: string;
  let W2: string;
  let B1: string;
  let B2: string;
  let cashId: string;
  let bankId: string;
  let expenseId: string;
  let equityId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const period = day.slice(0, 7);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const num = (x: unknown) => Number(x);

  /** Setiap jurnal harus seimbang di tiap cabangnya sendiri (selisih = 0) */
  const unbalancedJournals = async () => {
    const r = await db.execute<{ n: string }>(sql`
      SELECT j.number AS n FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} GROUP BY j.number, l.branch_id HAVING SUM(l.debit) <> SUM(l.credit)`);
    return r.rows.map((x) => x.n);
  };
  const rakNet = async () => {
    const r = await db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id WHERE j.tenant_id = ${tenantId} AND a.code = '1-1390'`);
    return num(r.rows[0].v);
  };
  const branchesOf = async (source: string) => {
    const r = await db.execute<{ b: string | null }>(sql`
      SELECT DISTINCT l.branch_id::text AS b FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = ${source}`);
    return r.rows.map((x) => x.b);
  };
  const allBalanced = async () => {
    const bs = (await get(owner, `/api/branches/balance-sheet?asOf=${day}`).expect(200)).body;
    for (const k of Object.keys(bs.summary)) expect(bs.summary[k].balanced).toBe(true);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    http = request(app.getHttpServer());
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Cabang Terpadu', name: 'Pemilik', email: `ct-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'PRODUKSI' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    W1 = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    W2 = (await post(owner, '/api/warehouses', { code: 'GD-2', name: 'Gudang 2' }).expect(201)).body.id;
    B1 = (await post(owner, '/api/branches', { code: 'C1', name: 'Cabang Satu' }).expect(201)).body.id;
    B2 = (await post(owner, '/api/branches', { code: 'C2', name: 'Cabang Dua' }).expect(201)).body.id;
    await put(owner, `/api/branches/warehouses/${W1}`, { branchId: B1 }).expect(200);
    await put(owner, `/api/branches/warehouses/${W2}`, { branchId: B2 }).expect(200);
    const cash = (await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    cashId = cash.find((a) => a.code === '1-1100')!.id;
    bankId = cash.find((a) => a.code !== '1-1100')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: day, description: 'Modal', reference: 'M-1', lines: [{ accountId: equityId, amount: '500000000' }] }).expect(201);
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: bankId, date: day, description: 'Modal bank', reference: 'M-2', lines: [{ accountId: equityId, amount: '300000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('gaji karyawan cabang: beban & utang gaji berlabel cabang karyawan, tiap cabang seimbang, bayar dari bank pusat memakai Antar Cabang', async () => {
    await post(owner, '/api/apps/payroll/install').expect(201);
    const emp = (code: string, salary: string, branchId?: string) =>
      post(owner, '/api/hr/employees', { code, name: `Pegawai ${code}`, ptkp: 'TK/0', joinDate: `${day.slice(0, 4)}-01-02`, baseSalary: salary, ...(branchId ? { branchId } : {}) });
    await emp('E-1', '5000000', B1).expect(201);
    await emp('E-2', '6000000', B2).expect(201);
    await emp('E-3', '7000000').expect(201);
    await emp('E-X', '1000000', '00000000-0000-4000-8000-000000000000').expect(400); // cabang tidak ada

    const run = (await post(owner, '/api/payroll/runs', { period }).expect(201)).body;
    await post(owner, `/api/payroll/runs/${run.id}/post`).expect(201);
    expect((await branchesOf('PAYROLL')).sort()).toEqual([B1, B2, null].sort());
    expect(await unbalancedJournals()).toEqual([]);
    await allBalanced();

    // laba rugi: beban gaji tiap cabang sesuai gaji karyawannya
    const q = `from=${day.slice(0, 4)}-01-01&to=${day.slice(0, 4)}-12-31`;
    const exp = async (b: string) => num((await get(owner, `/api/accounting/statements/income?${q}&branchId=${b}`).expect(200)).body.netProfit);
    expect(await exp(B1)).toBeLessThan(-5000000 + 1);
    expect(await exp(B2)).toBeLessThan(-6000000 + 1);
    expect(await exp(B1)).toBeGreaterThan(await exp(B2)); // gaji cabang 1 lebih kecil

    await post(owner, `/api/payroll/runs/${run.id}/pay`, { cashAccountId: bankId, date: day }).expect(201);
    expect(await unbalancedJournals()).toEqual([]);
    await allBalanced();
    expect(await rakNet()).toBeCloseTo(0, 2);
  });

  it('rekening kas/bank milik cabang: transaksi otomatis berlabel cabang itu; pusat bayar biaya cabang → Antar Cabang', async () => {
    await put(owner, `/api/branches/accounts/${bankId}`, { branchId: B2 }).expect(200);
    await put(owner, `/api/branches/accounts/${expenseId}`, { branchId: B2 }).expect(404); // bukan rekening kas
    // bayar biaya lewat bank Cabang 2 → semua sisi di Cabang 2
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: bankId, date: day, description: 'Listrik C2', reference: 'L-1', lines: [{ accountId: expenseId, amount: '1000000' }] }).expect(201);
    expect(await branchesOf('CASH_OUT')).toEqual([B2]);
    // bank Cabang 2 dipakai membayar biaya Cabang 1 → Rekening Antar Cabang otomatis
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: bankId, date: day, description: 'Sewa C1', reference: 'S-1', branchId: B1, lines: [{ accountId: expenseId, amount: '2000000' }] }).expect(201);
    expect(await unbalancedJournals()).toEqual([]);
    await allBalanced();
    expect(await rakNet()).toBeCloseTo(0, 2);
    const rak = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.code = '1-1390' AND j.source_type = 'CASH_OUT'`);
    expect(num(rak.rows[0].n)).toBe(2);
    // audit penetapan
    const au = await db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM audit_logs WHERE tenant_id = ${tenantId} AND action = 'ASSIGN_BRANCH' AND entity = 'Account'`);
    expect(num(au.rows[0].n)).toBe(1);
  });

  it('aset tetap: penyusutan di cabang aset; pindah cabang memindahkan nilai buku tanpa merusak neraca cabang', async () => {
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; method: string; accumulatedAccountId: string | null }[];
    const categoryId = cats.find((c) => c.method !== 'NONE' && c.accumulatedAccountId)!.id;
    const a = (
      await post(owner, '/api/assets', { name: 'Mesin Cabang 1', categoryId, acquisitionDate: `${day.slice(0, 4)}-01-15`, cost: '4800000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'EXISTING', branchId: B1 }).expect(201)
    ).body;
    await post(owner, '/api/assets/depreciation/run', { period }).expect(201);
    expect(await branchesOf('DEPRECIATION')).toEqual([B1]);
    await allBalanced();

    await post(owner, `/api/assets/${a.id}/transfer-branch`, { branchId: B2, date: day }).expect(201);
    expect(await branchesOf('ASSET_TRANSFER')).toEqual(expect.arrayContaining([B1, B2]));
    expect(await unbalancedJournals()).toEqual([]);
    await allBalanced();
    expect(await rakNet()).toBeCloseTo(0, 2);
    expect((await get(owner, `/api/assets/${a.id}`).expect(200)).body.branchId).toBe(B2);
    await post(owner, `/api/assets/${a.id}/transfer-branch`, { branchId: B2, date: day }).expect(400); // sudah di cabang itu
  });

  it('produksi di gudang cabang 2: jurnal produksi berlabel cabang 2', async () => {
    const kain = (await post(owner, '/api/products', { sku: 'KAIN', name: 'Kain', baseUom: 'M', sellPrice: '0' }).expect(201)).body.id;
    const baju = (await post(owner, '/api/products', { sku: 'BAJU', name: 'Baju', sellPrice: '90000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W2, reason: 'OPENING', date: day, lines: [{ productId: kain, qty: '100', unitCost: '20000' }] }).expect(201);
    const bom = (await post(owner, '/api/production/boms', { name: 'Baju', productId: baju, outputQty: '10', laborCost: '100000', overheadCost: '50000', lines: [{ productId: kain, qty: '15' }] }).expect(201)).body;
    const o = (await post(owner, '/api/production/orders', { bomId: bom.id, warehouseId: W2, batches: '1', date: day }).expect(201)).body;
    await post(owner, `/api/production/orders/${o.id}/start`, { date: day }).expect(201);
    await post(owner, `/api/production/orders/${o.id}/complete`, { date: day, outputQty: '10' }).expect(201);
    expect(await branchesOf('PRODUCTION')).toEqual([B2]);
    expect(await unbalancedJournals()).toEqual([]);
    await allBalanced();
  });

  it('buku besar & neraca saldo bisa difilter per cabang; jumlah cabang + pusat = gabungan', async () => {
    const tb = async (b?: string) => (await get(owner, `/api/accounting/reports/trial-balance${b ? `?branchId=${b}` : ''}`).expect(200)).body;
    const all = await tb();
    const parts = [await tb(B1), await tb(B2), await tb('NONE')];
    expect(num(parts[0].totalDebit) + num(parts[1].totalDebit) + num(parts[2].totalDebit)).toBeCloseTo(num(all.totalDebit), 2);
    for (const t of [all, ...parts]) expect(t.balanced).toBe(true);
    const acc = all.rows.find((r: { code: string }) => r.code === '1-1390');
    const led = async (b?: string) => (await get(owner, `/api/accounting/reports/ledger?accountId=${acc.id}${b ? `&branchId=${b}` : ''}`).expect(200)).body;
    const l1 = await led(B1);
    const l2 = await led(B2);
    const l0 = await led('NONE');
    const closing = (l: Record<string, unknown>) => num(l.closingBalance ?? l.closing);
    expect(Number.isFinite(closing(l1))).toBe(true);
    expect(closing(l1) + closing(l2) + closing(l0)).toBeCloseTo(0, 2);
    await get(owner, '/api/accounting/reports/trial-balance?branchId=ngawur').expect(400);
  });

  it('pengguna dibatasi ke cabangnya: hanya laporan cabang itu; laporan lintas cabang ditolak', async () => {
    await post(owner, '/api/users', { name: 'Keuangan C1', email: `ct-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE', branchIds: [B1] }).expect(201);
    await post(owner, '/api/users', { name: 'Keuangan X', email: `ct-x-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE', branchIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    const fin = (await http.post('/api/auth/login').send({ email: `ct-f-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    expect((await get(fin, '/api/auth/me').expect(200)).body.branchIds).toEqual([B1]);
    const q = `from=${day.slice(0, 4)}-01-01&to=${day}`;
    const mine = (await get(fin, `/api/accounting/statements/income?${q}`).expect(200)).body; // otomatis cabangnya
    const c1 = (await get(owner, `/api/accounting/statements/income?${q}&branchId=${B1}`).expect(200)).body;
    expect(mine.netProfit).toBe(c1.netProfit);
    await get(fin, `/api/accounting/statements/income?${q}&branchId=${B2}`).expect(403);
    await get(fin, `/api/accounting/statements/income?${q}&branchId=NONE`).expect(403);
    await get(fin, '/api/accounting/reports/trial-balance').expect(200);
    await get(fin, `/api/accounting/reports/trial-balance?branchId=${B2}`).expect(403);
    await get(fin, '/api/branches/report').expect(403);
    await get(fin, '/api/branches/balance-sheet').expect(403);
    await get(owner, '/api/branches/report').expect(200);
  });
  it('beranda (dashboard) bisa difilter per cabang; jumlah cabang + pusat = gabungan; pengguna terbatas dipaksa ke cabangnya', async () => {
    const dash = async (t: string, b?: string) => (await get(t, `/api/dashboard${b ? `?branchId=${b}` : ''}`).expect(200)).body;
    const all = await dash(owner);
    const sum = num((await dash(owner, B1)).cashBalance) + num((await dash(owner, B2)).cashBalance) + num((await dash(owner, 'NONE')).cashBalance);
    expect(sum).toBeCloseTo(num(all.cashBalance), 2);
    const stk = num((await dash(owner, B1)).stockValue) + num((await dash(owner, B2)).stockValue) + num((await dash(owner, 'NONE')).stockValue);
    expect(stk).toBeCloseTo(num(all.stockValue), 2);
    await get(owner, '/api/dashboard?branchId=ngawur').expect(400);
    const fin = (await http.post('/api/auth/login').send({ email: `ct-f-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    expect(num((await dash(fin)).cashBalance)).toBeCloseTo(num((await dash(owner, B1)).cashBalance), 2);
    await get(fin, `/api/dashboard?branchId=${B2}`).expect(403);
    expect((await get(fin, '/api/dashboard/attention').expect(200)).body.items).toEqual([]);
  });

  it('daftar jurnal & kas pengguna terbatas hanya memuat cabangnya', async () => {
    const fin = (await http.post('/api/auth/login').send({ email: `ct-f-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    const mine = (await get(fin, '/api/accounting/journals').expect(200)).body as { id: string; lines: { branchId: string | null }[] }[];
    expect(mine.length).toBeGreaterThan(0);
    for (const j of mine) for (const l of j.lines) expect(l.branchId).toBe(B1);
    const all = (await get(owner, '/api/accounting/journals').expect(200)).body as unknown[];
    expect(all.length).toBeGreaterThan(mine.length);
    // jurnal milik cabang lain tidak bisa dibuka lewat id
    const other = (await get(owner, '/api/accounting/journals?source=PRODUCTION').expect(200)).body[0];
    await get(fin, `/api/accounting/journals/${other.id}`).expect(404);
    // kas: hanya transaksi cabangnya; mencatat di rekening cabang lain ditolak
    const cash = (await get(fin, '/api/cash/transactions').expect(200)).body as { branchId?: string | null }[];
    for (const c of cash) expect(c.branchId).toBe(B1);
    await post(fin, '/api/cash/transactions', { type: 'OUT', cashAccountId: bankId, date: day, description: 'Coba', reference: 'X-1', lines: [{ accountId: expenseId, amount: '1000' }] }).expect(403);
  });

  it('fitur cabang hanya untuk perusahaan yang punya cabang: mati secara bawaan, bisa dinyalakan, tidak bisa dimatikan bila sudah ada cabang', async () => {
    const reg2 = (await http.post('/api/auth/register').send({ companyName: 'CV Satu Toko', name: 'Pemilik', email: `ct-s-${stamp}@uji.id`, password: 'rahasia123', acceptTerms: true }).expect(201)).body;
    const t2 = reg2.accessToken;
    const legal = await db.execute<{ v: string | null }>(sql`SELECT settings->'legal'->>'version' AS v FROM tenants WHERE id = ${reg2.user.tenantId}`);
    expect(legal.rows[0].v).toBeTruthy(); // persetujuan Syarat Layanan tercatat dengan versinya
    expect((await get(t2, '/api/auth/me').expect(200)).body.multiBranch).toBe(false);
    expect((await get(t2, '/api/auth/me').expect(200)).body.hasBudget).toBe(false); // menu Anggaran tersembunyi sampai ada anggaran
    await put(t2, `/api/budgets/${new Date().getFullYear()}`, { rows: [] }).catch(() => undefined);
    await put(t2, '/api/branches/feature', { enabled: true }).expect(200);
    expect((await get(t2, '/api/auth/me').expect(200)).body.multiBranch).toBe(true);
    await put(t2, '/api/branches/feature', { enabled: false }).expect(200);
    await post(t2, '/api/branches', { code: 'X1', name: 'Cabang X' }).expect(201);
    expect((await get(t2, '/api/auth/me').expect(200)).body.multiBranch).toBe(true);
    await put(t2, '/api/branches/feature', { enabled: false }).expect(400);
    expect((await get(owner, '/api/auth/me').expect(200)).body.multiBranch).toBe(true);
  });
});
