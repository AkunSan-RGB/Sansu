/**
 * Pemisahan fungsi (e2e): matriks hak akses seluruh endpoint + uji langsung per peran.
 * Jika tes ini gagal setelah mengubah @Roles, berarti ada peran yang memegang dua fungsi yang seharusnya terpisah
 * (mis. memesan + menerima + menagih) atau ada endpoint penulisan tanpa batas peran. Perbaiki perannya, bukan tesnya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { permissionKey } from '../src/common/auth/route-matrix';
import { routeMatrix, type RouteAccess } from '../scripts/rbac-matrix';
import { todayJakarta } from '../src/common/utils/dates';

const ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'CASHIER', 'HR'] as const;
type Role = (typeof ROLES)[number];

describe('Pemisahan fungsi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let matrix: RouteAccess[];
  const stamp = Date.now();
  const tok: Partial<Record<Role, string>> = {};
  const as = (r: Role) => ({ Authorization: `Bearer ${tok[r]}` });
  const call = (r: Role, method: 'get' | 'post' | 'put', url: string, body: object = {}) => http[method](url).set(as(r)).send(body);

  const allowed = (r: RouteAccess): Set<string> => (r.public || !r.roles ? new Set(ROLES) : new Set([...r.roles, 'OWNER']));
  const find = (method: string, path: string) => {
    const r = matrix.find((x) => x.method === method && x.path.replace(/\/$/, '') === path);
    if (!r) throw new Error(`Endpoint tidak ditemukan di matriks: ${method} ${path}`);
    return allowed(r);
  };
  const nonOwner = (s: Set<string>) => [...s].filter((x) => x !== 'OWNER');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    matrix = routeMatrix(app);
    tok.OWNER = (await http.post('/api/auth/register').send({ companyName: 'PT Pemisahan', name: 'Pemilik', email: `sod-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    for (const r of ROLES.filter((x) => x !== 'OWNER')) {
      const email = `sod-${r.toLowerCase()}-${stamp}@uji.id`;
      await call('OWNER', 'post', '/api/users', { name: r, email, password: 'rahasia123', role: r }).expect(201);
      tok[r] = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe('matriks hak akses', () => {
    it('semua endpoint penulisan punya batas peran (kecuali daftar yang memang untuk semua pengguna)', () => {
      const exempt = [/^\/api\/auth\//, /^\/api\/platform-admin\//, /^\/api\/platform\//, /^\/api\/billing\//, /^\/api\/reminders\/(snooze|unsnooze|digest\/test)$/, /^\/api\/approvals\/:id\/cancel$/];
      const open = matrix.filter((r) => r.method !== 'GET' && !r.public && !r.roles && !exempt.some((e) => e.test(r.path.replace(/\/$/, ''))));
      expect(open.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    });

    it('pengadaan: tidak ada peran selain Pemilik yang memegang pesan + terima barang + tagih (3-way)', () => {
      const po = find('POST', '/api/purchase-orders');
      const receive = find('POST', '/api/purchase-orders/:id/receipts');
      const bill = find('POST', '/api/purchase-invoices');
      const holders = ROLES.filter((r) => r !== 'OWNER' && po.has(r) && receive.has(r) && bill.has(r));
      // Admin memegang semuanya sebagai pengelola; yang dilarang adalah peran operasional
      expect(holders.filter((r) => r !== 'ADMIN')).toEqual([]);
    });

    it('Gudang tidak memesan, menagih, membayar, atau membuat supplier; Keuangan tidak menerima barang', () => {
      expect(find('POST', '/api/purchase-orders').has('WAREHOUSE')).toBe(false);
      expect(find('POST', '/api/purchase-requests/:id/convert').has('WAREHOUSE')).toBe(false);
      expect(find('POST', '/api/purchase-invoices').has('WAREHOUSE')).toBe(false);
      expect(find('POST', '/api/purchase-invoices/payments').has('WAREHOUSE')).toBe(false);
      expect(find('POST', '/api/suppliers').has('WAREHOUSE')).toBe(false);
      expect(find('POST', '/api/purchase-orders/:id/receipts').has('FINANCE')).toBe(false);
    });

    it('penjualan: Sales tidak mengirim barang, menagih, menerima pembayaran, atau mengubah limit kredit', () => {
      expect(find('POST', '/api/sales-orders/:id/deliver').has('SALES')).toBe(false);
      expect(find('POST', '/api/invoices').has('SALES')).toBe(false);
      expect(find('POST', '/api/payments').has('SALES')).toBe(false);
      expect(find('PATCH', '/api/customers/:id').has('SALES')).toBe(false);
    });

    it('stok: yang menghitung (Gudang) tidak yang memposting hasil opname', () => {
      const create = find('POST', '/api/inventory/counts');
      const post = find('POST', '/api/inventory/counts/:id/post');
      expect(nonOwner(post).filter((r) => create.has(r) && r !== 'ADMIN')).toEqual([]);
    });

    it('penggajian: penyusun (SDM) berbeda dari pembayar (Keuangan)', () => {
      const pay = find('POST', '/api/payroll/runs/:id/pay');
      const prepare = find('PATCH', '/api/payroll/payslips/:id');
      expect(nonOwner(pay).filter((r) => prepare.has(r))).toEqual([]);
    });

    // Pemegang uang (Keuangan) tidak membukukan; pembukuan (Akuntan) tidak memegang uang
    const BOOKKEEPING: [string, string][] = [
      ['POST', '/api/accounting/journals'], ['POST', '/api/accounting/journals/:id/reverse'], ['POST', '/api/accounting/accounts'], ['PATCH', '/api/accounting/accounts/:id'],
      ['POST', '/api/accounting/recurring'], ['POST', '/api/accounting/opening-balances'], ['POST', '/api/accounting/period/lock'], ['POST', '/api/accounting/period/close-year'],
      ['POST', '/api/assets'], ['POST', '/api/assets/depreciation/run'], ['POST', '/api/assets/:id/dispose'], ['POST', '/api/inventory/writedowns'],
      ['POST', '/api/fx/revaluation'], ['PUT', '/api/budgets/:year'], ['POST', '/api/accounting/fiscal/:year/journal'], ['PATCH', '/api/settings/reporting'], ['POST', '/api/payroll/runs/:id/post'], ['POST', '/api/bank/signoffs'],
    ];
    const MONEY: [string, string][] = [
      ['POST', '/api/cash/transactions'], ['POST', '/api/payments'], ['POST', '/api/purchase-invoices/payments'], ['POST', '/api/purchase-invoices/payments/:id/void'], ['POST', '/api/tax/payments'],
      ['POST', '/api/payroll/runs/:id/pay'], ['POST', '/api/petty-cash/vouchers'], ['POST', '/api/petty-cash/funds/:id/replenish'], ['POST', '/api/cash/counts'], ['POST', '/api/bank/statements'], ['POST', '/api/bank/lines/:id/match'],
    ];
    it('Keuangan tidak membukukan: jurnal, akun, kunci periode, aset, penyusutan, penurunan nilai, revaluasi, posting gaji, pengesahan rekonsiliasi', () => {
      for (const [m, p] of BOOKKEEPING) expect(`${m} ${p} FINANCE ${find(m, p).has('FINANCE')}`).toBe(`${m} ${p} FINANCE false`);
    });
    it('Akuntan tidak memegang uang: kas, pembayaran, setor pajak, bayar gaji, kas kecil, rekening koran', () => {
      for (const [m, p] of MONEY) expect(`${m} ${p} ACCOUNTANT ${find(m, p).has('ACCOUNTANT')}`).toBe(`${m} ${p} ACCOUNTANT false`);
    });
    it('tidak ada peran selain Pemilik/Admin yang memegang fungsi pembukuan sekaligus fungsi uang', () => {
      for (const r of ROLES.filter((x) => x !== 'OWNER' && x !== 'ADMIN')) {
        const book = BOOKKEEPING.filter(([m, p]) => find(m, p).has(r));
        const money = MONEY.filter(([m, p]) => find(m, p).has(r));
        expect({ r, both: book.length > 0 && money.length > 0 }).toEqual({ r, both: false });
      }
    });
    it('penggajian: yang memposting jurnal gaji (Akuntan) berbeda dari yang membayar (Keuangan) dan dari penyusun (SDM)', () => {
      expect(nonOwner(find('POST', '/api/payroll/runs/:id/post'))).toEqual(['ACCOUNTANT']);
      expect(nonOwner(find('POST', '/api/payroll/runs/:id/pay'))).toEqual(['FINANCE']);
    });
    it('Akuntan hanya menulis di bidang pembukuan (tidak ada penulisan di penjualan, pembelian, stok, kasir, SDM)', () => {
      const writes = matrix.filter((r) => r.method !== 'GET' && !r.public && allowed(r).has('ACCOUNTANT') && !/^\/api\/(auth|platform|billing|platform-admin|reminders)/.test(r.path) && r.path !== '/api/approvals/:id/cancel');
      const outside = writes.filter((r) => !/^\/api\/(accounting|assets|budgets|fx|settings\/reporting|inventory\/writedowns|payroll\/runs\/:id\/post|bank\/signoffs|imports)/.test(r.path));
      expect(outside.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    });

    it('persetujuan hanya Admin/Pemilik; hitung kas disetujui hanya Pemilik', () => {
      expect(nonOwner(find('POST', '/api/approvals/:id/approve'))).toEqual(['ADMIN']);
      expect(nonOwner(find('POST', '/api/approvals/:id/reject'))).toEqual(['ADMIN']);
      expect(nonOwner(find('POST', '/api/cash/counts/:id/approve'))).toEqual([]);
    });

    it('Kasir dan SDM tidak menulis di luar bidangnya', () => {
      const misc = [/^\/api\/auth\//, /^\/api\/reminders\//, /^\/api\/approvals\/:id\/cancel$/];
      const writes = (role: Role) => matrix.filter((r) => r.method !== 'GET' && !r.public && allowed(r).has(role) && !misc.some((m) => m.test(r.path)) && !/^\/api\/(platform|billing|platform-admin)/.test(r.path));
      expect(writes('CASHIER').filter((r) => !r.path.startsWith('/api/pos')).map((r) => `${r.method} ${r.path}`)).toEqual([]);
      expect(writes('HR').filter((r) => !/^\/api\/(hr|payroll|settings\/payroll)/.test(r.path)).map((r) => `${r.method} ${r.path}`)).toEqual([]);
    });

    it('data biaya pembelian dan stok tidak terbuka untuk SDM, Kasir, dan Sales', () => {
      for (const [m, p] of [['GET', '/api/purchase-invoices'], ['GET', '/api/purchase-orders'], ['GET', '/api/suppliers'], ['GET', '/api/inventory/moves']] as const) {
        const a = find(m, p);
        for (const r of ['HR', 'CASHIER', 'SALES'] as const) expect(`${p} ${r} ${a.has(r)}`).toBe(`${p} ${r} false`);
      }
      for (const [m, p] of [['GET', '/api/invoices'], ['GET', '/api/sales-orders']] as const) {
        const a = find(m, p);
        for (const r of ['HR', 'CASHIER'] as const) expect(`${p} ${r} ${a.has(r)}`).toBe(`${p} ${r} false`);
      }
    });
  });

  describe('izin tampilan (/auth/permissions)', () => {
    const allowOf = async (r: Role) => new Set<string>((await call(r, 'get', '/api/auth/permissions').expect(200)).body.allow);
    it('izin tiap peran sama persis dengan matriks hak akses server', async () => {
      for (const r of ROLES) {
        const got = await allowOf(r);
        const want = new Set(matrix.filter((x) => x.method !== 'GET' && !x.public && allowed(x).has(r)).map(permissionKey));
        expect({ r, missing: [...want].filter((k) => !got.has(k)), extra: [...got].filter((k) => !want.has(k)) }).toEqual({ r, missing: [], extra: [] });
      }
    });
    it('Akuntan: membukukan tetapi tidak memegang uang; Keuangan sebaliknya; Gudang tidak memesan', async () => {
      const [acc, fin, wh] = await Promise.all([allowOf('ACCOUNTANT'), allowOf('FINANCE'), allowOf('WAREHOUSE')]);
      expect(acc.has('POST /accounting/journals') && !acc.has('POST /cash/transactions') && !acc.has('POST /payments') && !acc.has('POST /purchase-orders')).toBe(true);
      expect(fin.has('POST /cash/transactions') && fin.has('POST /payments') && !fin.has('POST /accounting/journals')).toBe(true);
      expect(wh.has('POST /purchase-orders')).toBe(false);
    });
    it('semua kunci can(...) di kode tampilan ada di matriks rute (tidak ada salah ketik yang diam-diam menyembunyikan tombol)', () => {
      const keys = new Set(matrix.filter((x) => x.method !== 'GET').map(permissionKey));
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
      const bad: string[] = [];
      let found = 0;
      for (const file of walk(join(__dirname, '../../frontend/src'))) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/\bcan\(\s*'(POST|PUT|PATCH|DELETE)'\s*,\s*(['`])([^'`]*)\2/g)) {
          found++;
          if (m[3].includes('${') || !keys.has(`${m[1]} ${m[3]}`)) bad.push(`${file.split('frontend/src/')[1]}: ${m[1]} ${m[3]}`);
        }
        for (const m of src.matchAll(/\bcan\(\s*'(POST|PUT|PATCH|DELETE)'\s*,\s*[^'`\s]/g)) bad.push(`${file.split('frontend/src/')[1]}: kunci bukan literal (${m[0]})`);
      }
      expect(bad).toEqual([]);
      expect(found).toBeGreaterThan(0);
    });
  });

  describe('uji langsung per peran', () => {
    it('Gudang ditolak membuat PO, supplier, faktur; Keuangan ditolak menerima barang; Sales ditolak mengirim barang', async () => {
      await call('WAREHOUSE', 'post', '/api/purchase-orders', {}).expect(403);
      await call('WAREHOUSE', 'post', '/api/suppliers', { code: 'X', name: 'X' }).expect(403);
      await call('WAREHOUSE', 'post', '/api/purchase-invoices', {}).expect(403);
      await call('FINANCE', 'post', '/api/purchase-orders/00000000-0000-4000-8000-000000000000/receipts', {}).expect(403);
      await call('SALES', 'post', '/api/sales-orders/00000000-0000-4000-8000-000000000000/deliver', {}).expect(403);
      await call('WAREHOUSE', 'post', '/api/inventory/counts/00000000-0000-4000-8000-000000000000/post', {}).expect(403);
    });
    it('SDM dan Kasir tidak bisa membaca data pembelian/penjualan/stok bernilai', async () => {
      for (const r of ['HR', 'CASHIER'] as const) {
        await call(r, 'get', '/api/purchase-invoices').expect(403);
        await call(r, 'get', '/api/purchase-orders').expect(403);
        await call(r, 'get', '/api/suppliers').expect(403);
        await call(r, 'get', '/api/invoices').expect(403);
        await call(r, 'get', '/api/inventory/moves').expect(403);
      }
      await call('SALES', 'get', '/api/purchase-invoices').expect(403);
    });
    it('Keuangan ditolak membukukan; Akuntan ditolak memegang uang; keduanya tetap bisa membaca laporan', async () => {
      await call('FINANCE', 'post', '/api/accounting/journals', {}).expect(403);
      await call('FINANCE', 'post', '/api/accounting/period/lock', { until: '2020-01-31' }).expect(403);
      await call('FINANCE', 'post', '/api/accounting/accounts', {}).expect(403);
      await call('FINANCE', 'post', '/api/assets/depreciation/run', {}).expect(403);
      await call('ACCOUNTANT', 'post', '/api/cash/transactions', {}).expect(403);
      await call('ACCOUNTANT', 'post', '/api/payments', {}).expect(403);
      await call('ACCOUNTANT', 'post', '/api/purchase-invoices/payments', {}).expect(403);
      await call('ACCOUNTANT', 'post', '/api/tax/payments', {}).expect(403);
      await call('ACCOUNTANT', 'post', '/api/payroll/runs/00000000-0000-4000-8000-000000000000/pay', {}).expect(403);
      await call('FINANCE', 'post', '/api/payroll/runs/00000000-0000-4000-8000-000000000000/post', {}).expect(403);
      for (const r of ['FINANCE', 'ACCOUNTANT'] as const) {
        await call(r, 'get', '/api/accounting/reports/trial-balance').expect(200);
        await call(r, 'get', '/api/accounting/journals').expect(200);
        await call(r, 'get', '/api/cash/accounts').expect(200);
        await call(r, 'get', '/api/tax/obligations').expect(200);
      }
      for (const r of ['SALES', 'WAREHOUSE', 'CASHIER', 'HR'] as const) await call(r, 'get', '/api/accounting/journals').expect(403);
    });
    it('Akuntan membukukan jurnal manual; Keuangan mencatat kas', async () => {
      const accs = (await call('OWNER', 'get', '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
      const id = (c: string) => accs.find((a) => a.code === c)!.id;
      const day = todayJakarta();
      await call('ACCOUNTANT', 'post', '/api/accounting/journals', { date: day, description: 'Jurnal akuntan', lines: [{ accountId: id('6-4000'), debit: '1000' }, { accountId: id('3-1000'), credit: '1000' }] }).expect(201);
      const cashAcc = ((await call('OWNER', 'get', '/api/cash/accounts').expect(200)).body as { id: string }[])[0].id;
      await call('FINANCE', 'post', '/api/cash/transactions', { type: 'IN', cashAccountId: cashAcc, date: day, description: 'Setoran', reference: 'S1', lines: [{ accountId: id('3-1000'), amount: '1000' }] }).expect(201);
    });
    it('peran yang berhak tetap bisa bekerja', async () => {
      await call('SALES', 'get', '/api/customers').expect(200);
      await call('SALES', 'get', '/api/invoices').expect(200);
      await call('WAREHOUSE', 'get', '/api/purchase-orders').expect(200);
      await call('WAREHOUSE', 'get', '/api/inventory/moves').expect(200);
      await call('FINANCE', 'get', '/api/purchase-invoices').expect(200);
      await call('CASHIER', 'get', '/api/customers').expect(200);
      await call('CASHIER', 'get', '/api/products').expect(200);
    });
  });

  describe('maker-checker: penyesuaian stok & pembayaran supplier', () => {
    let warehouseId: string;
    let productId: string;
    let supplierId: string;
    const day = todayJakarta();
    beforeAll(async () => {
      warehouseId = (await call('OWNER', 'get', '/api/warehouses').expect(200)).body[0].id;
      productId = (await call('OWNER', 'post', '/api/products', { sku: 'SOD-1', name: 'Barang SoD', sellPrice: '20000' }).expect(201)).body.id;
      supplierId = (await call('OWNER', 'post', '/api/suppliers', { code: 'SOD', name: 'Pemasok SoD' }).expect(201)).body.id;
    });

    it('penyesuaian stok bernilai besar oleh Gudang menunggu persetujuan lalu dijalankan', async () => {
      await http.put('/api/approvals/policy').set(as('OWNER')).send({ stockAdjustment: 1000000 }).expect(200);
      const lines = [{ productId, qty: '1000', unitCost: '5000' }]; // Rp5.000.000
      const r = await call('WAREHOUSE', 'post', '/api/inventory/adjustments', { warehouseId, date: day, reason: 'OTHER', notes: 'uji', lines });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('APPROVAL_REQUIRED');
      const bal = async () => Number(((await call('OWNER', 'get', `/api/inventory/balances?warehouseId=${warehouseId}`).expect(200)).body as { productId: string; qty: string }[]).find((b) => b.productId === productId)?.qty ?? 0);
      expect(await bal()).toBe(0);
      // kecil: langsung jalan
      await call('WAREHOUSE', 'post', '/api/inventory/adjustments', { warehouseId, date: day, reason: 'OTHER', notes: 'kecil', lines: [{ productId, qty: '10', unitCost: '5000' }] }).expect(201);
      expect(await bal()).toBe(10);
      const pending = ((await call('OWNER', 'get', '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string }[]).find((x) => x.kind === 'STOCK_ADJUSTMENT')!;
      expect(pending).toBeTruthy();
      await call('OWNER', 'post', `/api/approvals/${pending.id}/approve`, { note: 'OK' }).expect(201);
      expect(await bal()).toBe(1010);
    });

    it('pembayaran supplier besar oleh Keuangan menunggu persetujuan lalu dibayar', async () => {
      const cashAcc = ((await call('OWNER', 'get', '/api/cash/accounts').expect(200)).body as { id: string }[])[0].id;
      await call('OWNER', 'post', '/api/cash/transactions', { type: 'IN', cashAccountId: cashAcc, date: day, description: 'Modal', reference: 'M', lines: [{ accountId: ((await call('OWNER', 'get', '/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id, amount: '50000000' }] }).expect(201);
      const accs = (await call('OWNER', 'get', '/api/accounting/accounts').expect(200)).body as { id: string; type: string; isPostable: boolean; isCashAccount: boolean }[];
      const expense = accs.find((a) => a.type === 'EXPENSE' && a.isPostable)!;
      const bill = (await call('OWNER', 'post', '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: 'SOD-1', date: day, lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: expense.id, qty: '1', price: '3000000', ...{} }] }).expect(201)).body as { id: string };
      await http.put('/api/approvals/policy').set(as('OWNER')).send({ cashOut: 1000000 }).expect(200);
      const r = await call('FINANCE', 'post', '/api/purchase-invoices/payments', { purchaseInvoiceId: bill.id, amount: '2000000', date: day });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('APPROVAL_REQUIRED');
      const pending = ((await call('OWNER', 'get', '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string }[]).find((x) => x.kind === 'SUPPLIER_PAYMENT')!;
      expect(pending).toBeTruthy();
      await call('FINANCE', 'post', `/api/approvals/${pending.id}/approve`, {}).expect(403); // pembuat tidak menyetujui sendiri
      await call('OWNER', 'post', `/api/approvals/${pending.id}/approve`, { note: 'OK' }).expect(201);
      const inv = (await call('OWNER', 'get', `/api/purchase-invoices/${bill.id}`).expect(200)).body as { paidAmount: string };
      expect(Number(inv.paidAmount)).toBe(2000000);
    });
  });
});
