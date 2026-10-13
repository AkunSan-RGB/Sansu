/**
 * Pemisahan fungsi (e2e): matriks hak akses seluruh endpoint + uji langsung per peran.
 * Jika tes ini gagal setelah mengubah @Roles, berarti ada peran yang memegang dua fungsi yang seharusnya terpisah
 * (mis. memesan + menerima + menagih) atau ada endpoint penulisan tanpa batas peran. Perbaiki perannya, bukan tesnya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { routeMatrix, type RouteAccess } from '../scripts/rbac-matrix';
import { todayJakarta } from '../src/common/utils/dates';

const ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'CASHIER', 'HR'] as const;
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
