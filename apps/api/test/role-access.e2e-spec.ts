/**
 * Hak akses per peran (prinsip "perlu tahu"): data keuangan, biaya produksi, nilai proyek, dan langganan
 * tidak boleh terbaca oleh peran operasional yang tidak membutuhkannya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const ROLES = ['ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'CASHIER', 'HR'] as const;
type Role = (typeof ROLES)[number] | 'OWNER';

describe('Hak akses per peran (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const tokens = {} as Record<Role, string>;
  const stamp = Date.now();
  let billingInvoiceId = '00000000-0000-0000-0000-000000000000';
  const get = (role: Role, url: string) => http.get(url).set({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    tokens.OWNER = (await http.post('/api/auth/register').send({ companyName: 'PT Peran', name: 'Pemilik', email: `peran-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const O = { Authorization: `Bearer ${tokens.OWNER}` };
    for (const a of ['pos', 'crm', 'hr', 'payroll']) await http.post(`/api/apps/${a}/install`).set(O).send({});
    for (const role of ROLES) {
      const email = `peran-${role}-${stamp}@uji.id`;
      await http.post('/api/users').set(O).send({ name: role, email, password: 'rahasia123', role }).expect(201);
      tokens[role] = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body.accessToken;
    }
    // data agar angka tidak nol dan bukan sekadar kosong
    const wh = (await http.get('/api/warehouses').set(O)).body[0].id;
    const p = (await http.post('/api/products').set(O).send({ sku: 'RL-1', name: 'Barang', sellPrice: '10000' }).expect(201)).body.id;
    await http.post('/api/inventory/adjustments').set(O).send({ warehouseId: wh, reason: 'OPENING', lines: [{ productId: p, qty: '10', unitCost: '5000' }] }).expect(201);
    const c = (await http.post('/api/customers').set(O).send({ code: 'C-1', name: 'Pelanggan', creditLimit: '1000000000' }).expect(201)).body.id;
    const so = (await http.post('/api/sales-orders').set(O).send({ customerId: c, warehouseId: wh, lines: [{ productId: p, qty: '2' }] }).expect(201)).body;
    await http.post(`/api/sales-orders/${so.id}/confirm`).set(O).expect(201);
    await http.post('/api/invoices').set(O).send({ salesOrderId: so.id }).expect(201);
    const bill = (await http.get('/api/billing').set(O)).body;
    billingInvoiceId = bill.invoices?.[0]?.id ?? billingInvoiceId;
  });
  afterAll(() => app.close());

  const allowed = (roles: Role[]) => ROLES.filter((r) => roles.includes(r));
  const expectAccess = async (url: string, ok: Role[]) => {
    const got: Record<string, number> = {};
    for (const r of ['OWNER', ...ROLES] as Role[]) got[r] = (await get(r, url)).status;
    const expected: Record<string, number> = {};
    for (const r of ['OWNER', ...ROLES] as Role[]) expected[r] = r === 'OWNER' || ok.includes(r) ? 200 : 403;
    expect({ url, got }).toEqual({ url, got: expected });
  };

  it('biaya produksi (resep & perintah): hanya Admin, Gudang, Keuangan', async () => {
    for (const url of ['/api/production/boms', '/api/production/orders']) await expectAccess(url, ['ADMIN', 'WAREHOUSE', 'FINANCE']);
  });

  it('nilai proyek dan uang muka pelanggan: hanya Admin, Keuangan, Sales', async () => {
    for (const url of ['/api/services/projects', '/api/services/deposits']) await expectAccess(url, ['ADMIN', 'FINANCE', 'SALES']);
  });

  it('langganan & tagihan SaaS: hanya Pemilik dan Admin; kontak dukungan terbuka', async () => {
    await expectAccess('/api/billing', ['ADMIN']);
    await expectAccess('/api/billing/support', [...ROLES]);
    // dokumen tagihan: peran lain ditolak (403) sebelum data dicari; Pemilik/Admin sampai ke pencarian (404 bila tidak ada)
    for (const r of ROLES) {
      const status = (await get(r, `/api/billing/invoices/${billingInvoiceId}`)).status;
      expect([r, r === 'ADMIN' ? status !== 403 : status]).toEqual([r, r === 'ADMIN' ? true : 403]);
    }
  });

  it('beranda: angka keuangan dipotong menurut peran', async () => {
    const dash = async (r: Role) => (await get(r, '/api/dashboard').expect(200)).body;
    const finance = ['salesMonth', 'grossProfitMonth', 'grossMarginPct', 'arOutstanding', 'stockValue', 'apOutstanding', 'cashBalance'];
    for (const r of ['OWNER', 'ADMIN', 'FINANCE'] as Role[]) {
      const d = await dash(r);
      for (const k of finance) expect([r, k, d[k] !== null && d[k] !== undefined]).toEqual([r, k, true]);
      expect(d.recentInvoices.length).toBeGreaterThan(0);
    }
    // Sales: penjualan dan piutang untuk menagih; bukan laba, kas, utang, nilai stok
    const s = await dash('SALES');
    expect(s.salesMonth).not.toBeNull();
    expect(s.arOutstanding).not.toBeNull();
    for (const k of ['grossProfitMonth', 'grossMarginPct', 'stockValue', 'apOutstanding', 'cashBalance']) expect([k, s[k]]).toEqual([k, null]);
    expect(s.recentInvoices.length).toBeGreaterThan(0);
    // Kasir, Gudang, HR: tidak ada angka keuangan sama sekali
    for (const r of ['CASHIER', 'WAREHOUSE', 'HR'] as Role[]) {
      const d = await dash(r);
      for (const k of finance) expect([r, k, d[k]]).toEqual([r, k, null]);
      expect([r, d.recentInvoices]).toEqual([r, []]);
    }
  });

  it('akses yang memang dibutuhkan tetap terbuka', async () => {
    expect((await get('CASHIER', '/api/cash/accounts')).status).toBe(200); // tutup kasir
    expect((await get('CASHIER', '/api/pos/sessions/current')).status).toBe(200);
    expect((await get('WAREHOUSE', '/api/inventory/low-stock')).status).toBe(200);
    expect((await get('SALES', '/api/crm/leads')).status).toBe(200);
    expect((await get('HR', '/api/hr/employees')).status).toBe(200);
    expect((await get('FINANCE', '/api/accounting/health')).status).toBe(200);
  });
});
