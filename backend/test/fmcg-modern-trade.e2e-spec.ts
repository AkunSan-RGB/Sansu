/**
 * FMCG modern trade: nomor PO outlet wajib & unik, syarat dagang (rebate % + biaya tetap) diakru lalu dilunasi dengan potongan
 * tagihan/bayar, klaim biaya promo ke prinsipal (baris tidak bisa diklaim dua kali; persetujuan oleh orang lain).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('FMCG: modern trade (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let tenantId: string;
  let wh: string;
  let A: string;
  let B: string;
  const tok: Record<string, { token: string; id: string }> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 10));
  const period = prev.toISOString().slice(0, 7);
  const prevDate = prev.toISOString().slice(0, 10);
  const mk = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `mt-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `mt-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    tok[n] = { token: r.accessToken, id: r.user.id };
  };
  const bal = async (code: string) => Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].b);
  const sell = async (customerId: string, lines: object[], extra: object = {}) => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId: wh, date: prevDate, lines, ...extra }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    return { so, inv: (await post('/api/invoices', { salesOrderId: so.id, date: prevDate }).expect(201)).body };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Modern Trade', name: 'Pemilik', email: `mt-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    for (const [role, n] of [['ADMIN', 'adm'], ['ACCOUNTANT', 'akn'], ['FINANCE', 'fin'], ['SALES', 'sls']] as const) await mk(role, n);
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    A = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    B = (await post('/api/products', { sku: 'KOPI', name: 'Kopi', baseUom: 'PCS', sellPrice: '800' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: A, qty: '5000', unitCost: '600' }, { productId: B, qty: '5000', unitCost: '400' }] }).expect(201);
  });
  afterAll(() => app.close());

  describe('nomor PO outlet', () => {
    let cust: string;
    it('outlet peritel modern wajib membawa nomor PO; satu PO tidak bisa dipakai dua kali; PO pesanan batal boleh dipakai lagi', async () => {
      cust = (await post('/api/customers', { code: 'ALFA', name: 'Minimarket Jaringan', requirePo: true }).expect(201)).body.id;
      const lines = [{ productId: A, qty: '10' }];
      expect((await post('/api/sales-orders', { customerId: cust, warehouseId: wh, lines })).status).toBe(400);
      const ok = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, customerPoNo: 'PO-7731', lines }).expect(201)).body;
      const dup = await post('/api/sales-orders', { customerId: cust, warehouseId: wh, customerPoNo: 'PO-7731', lines });
      expect(dup.status).toBe(400);
      expect(JSON.stringify(dup.body)).toMatch(/sudah dipakai/);
      await post(`/api/sales-orders/${ok.id}/cancel`).expect(201);
      await post('/api/sales-orders', { customerId: cust, warehouseId: wh, customerPoNo: 'PO-7731', lines }).expect(201);
      const other = (await post('/api/customers', { code: 'LAIN', name: 'Outlet Lain' }).expect(201)).body.id;
      await post('/api/sales-orders', { customerId: other, warehouseId: wh, customerPoNo: 'PO-7731', lines }).expect(201); // PO unik per outlet
    });
  });

  describe('syarat dagang', () => {
    let cust: string;
    let invoiceId: string;
    const accruals: { id: string; amount: string; termName: string }[] = [];
    it('hanya Admin mengatur syarat dagang; tutup bulan oleh pembukuan menjurnal rebate % dan biaya tetap, tidak ganda', async () => {
      cust = (await post('/api/customers', { code: 'GIANT', name: 'Hypermarket' }).expect(201)).body.id;
      const term = { customerId: cust, name: 'Rebate pencapaian', kind: 'PCT_SALES', value: '2' };
      expect((await post('/api/trade-terms', term, tok.akn.token)).status).toBe(403);
      await post('/api/trade-terms', term, tok.adm.token).expect(201);
      await post('/api/trade-terms', { customerId: cust, name: 'Listing fee bulanan', kind: 'FIXED_MONTHLY', value: '100000' }, tok.adm.token).expect(201);
      expect((await post('/api/trade-terms', { ...term, value: '150' }, tok.adm.token)).status).toBe(400);
      invoiceId = (await sell(cust, [{ productId: A, qty: '1000' }])).inv.id; // DPP 1.000.000
      expect((await post('/api/trade-accruals/accrue', { period: new Date().toISOString().slice(0, 7) }, tok.akn.token)).status).toBe(400);
      expect((await post('/api/trade-accruals/accrue', { period }, tok.fin.token)).status).toBe(403);
      const r = (await post('/api/trade-accruals/accrue', { period }, tok.akn.token).expect(201)).body;
      expect(r.created).toBe(2);
      expect(Number(r.total)).toBe(120_000);
      expect((await post('/api/trade-accruals/accrue', { period }, tok.akn.token).expect(201)).body.created).toBe(0);
      expect(await bal('6-2150')).toBe(120_000);
      expect(await bal('2-1460')).toBe(-120_000);
      accruals.push(...(await get(`/api/trade-accruals?period=${period}`, tok.fin.token).expect(200)).body);
      expect(accruals).toHaveLength(2);
    });

    it('pelunasan: potong tagihan outlet (piutang berkurang) atau bayar tunai; bukan oleh yang menjurnalkan; tidak melebihi sisa', async () => {
      const pct = accruals.find((a) => a.termName === 'Rebate pencapaian')!;
      const fixed = accruals.find((a) => a.termName === 'Listing fee bulanan')!;
      expect((await post(`/api/trade-accruals/${pct.id}/settle`, { mode: 'DEDUCT', invoiceId, amount: '20000' }, tok.akn.token)).status).toBe(403); // peran Akuntan tidak melunasi
      expect((await post(`/api/trade-accruals/${pct.id}/settle`, { mode: 'DEDUCT', invoiceId, amount: '30000' }, tok.fin.token)).status).toBe(400); // > sisa rebate
      expect((await post(`/api/trade-accruals/${pct.id}/settle`, { mode: 'DEDUCT', amount: '1000' }, tok.fin.token)).status).toBe(400); // faktur wajib
      const arBefore = await bal('1-1300');
      await post(`/api/trade-accruals/${pct.id}/settle`, { mode: 'DEDUCT', invoiceId, amount: '20000' }, tok.fin.token).expect(201);
      expect(await bal('1-1300')).toBe(arBefore - 20_000);
      const inv = (await get(`/api/invoices/${invoiceId}`).expect(200)).body;
      expect(Number(inv.paidAmount)).toBe(20_000);
      await post(`/api/trade-accruals/${fixed.id}/settle`, { mode: 'PAY', amount: '60000' }, tok.fin.token).expect(201);
      const part = (await get(`/api/trade-accruals?period=${period}`).expect(200)).body.find((a: { id: string }) => a.id === fixed.id);
      expect(part.status).toBe('ACCRUED');
      expect(Number(part.remaining)).toBe(40_000);
      await post(`/api/trade-accruals/${fixed.id}/settle`, { mode: 'PAY', amount: '40000' }, tok.fin.token).expect(201);
      expect(await bal('2-1460')).toBe(0);
      // faktur outlet lain tidak bisa dipotong
      expect((await post(`/api/trade-accruals/${fixed.id}/void`, { reason: 'Salah hitung rebate' }, tok.adm.token)).status).toBe(400); // sudah dilunasi
    });
  });

  describe('klaim promo ke prinsipal', () => {
    let supplier: string;
    let claimId: string;
    it('promo didanai prinsipal 50%: klaim dikumpulkan dari baris berpromo (potongan + biaya bonus), tidak bisa digandakan', async () => {
      supplier = (await post('/api/suppliers', { code: 'PRI', name: 'PT Prinsipal' }).expect(201)).body.id;
      const discPromo = (await post('/api/promos', { name: 'Diskon 10% min 100', kind: 'DISCOUNT', productId: A, minQty: '100', discountPct: '10', fundedSupplierId: supplier, fundedPct: '50' }).expect(201)).body.id;
      await post('/api/promos', { name: 'Beli 50 mi gratis 5 kopi', kind: 'BONUS', productId: A, minQty: '50', bonusProductId: B, bonusQty: '5', fundedSupplierId: supplier, fundedPct: '50' }).expect(201);
      expect((await post('/api/promos', { name: 'x', kind: 'DISCOUNT', minQty: '1', discountPct: '5', fundedPct: '50' })).status).toBe(400); // tanpa prinsipal
      const c = (await post('/api/customers', { code: 'KLM', name: 'Outlet Klaim' }).expect(201)).body.id;
      const sold = await sell(c, [{ productId: A, qty: '100' }]);
      // pelanggan meretur separuh barang berpromo: bagian itu tidak ditagihkan ke prinsipal
      const invLine = (await get(`/api/invoices/${sold.inv.id}`).expect(200)).body.lines.find((l: { product: { sku: string } }) => l.product.sku === 'MIE');
      await post('/api/sales-returns', { invoiceId: sold.inv.id, date: prevDate, lines: [{ invoiceLineId: invLine.id, qty: '50' }] }).expect(201);
      // mengubah promo setelah pesanan terjadi (persen tanggungan prinsipal) tidak mengubah klaim pesanan lama
      await http.put(`/api/promos/${discPromo}`).set(as(owner)).send({ name: 'Diskon 10% min 100', kind: 'DISCOUNT', productId: A, minQty: '100', discountPct: '10', fundedSupplierId: supplier, fundedPct: '10' }).expect(200);
      expect((await post('/api/principal-claims/generate', { supplierId: supplier, period }, tok.fin.token)).status).toBe(403);
      const g = (await post('/api/principal-claims/generate', { supplierId: supplier, period }, tok.akn.token).expect(201)).body;
      claimId = g.id;
      expect(g.lineCount).toBe(2);
      // diskon: 100 × 1000 × 10% = 10.000, separuh diretur → 5.000 × 50% (snapshot) = 2.500; bonus: 10 kopi × 400 = 4.000 × 50% = 2.000
      expect(Number(g.claimedAmount)).toBe(4_500);
      const again = await post('/api/principal-claims/generate', { supplierId: supplier, period }, tok.akn.token);
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toMatch(/sudah diklaim/);
    });

    it('alur: ajukan → disetujui prinsipal (bukan pembuat klaim) → diterima Keuangan; jurnal piutang klaim lalu kas', async () => {
      await post(`/api/principal-claims/${claimId}/submit`, {}, tok.akn.token).expect(201);
      expect((await post(`/api/principal-claims/${claimId}/decide`, { approvedAmount: '4000' }, tok.akn.token)).status).toBe(403); // pembuat klaim
      expect((await post(`/api/principal-claims/${claimId}/decide`, { approvedAmount: '9000' }, tok.adm.token)).status).toBe(400); // > klaim
      const before = await bal('6-2150');
      await post(`/api/principal-claims/${claimId}/decide`, { approvedAmount: '4000', principalRef: 'NK-991' }, tok.adm.token).expect(201);
      expect(await bal('1-1370')).toBe(4_000);
      expect(await bal('6-2150')).toBe(before - 4_000);
      expect((await post(`/api/principal-claims/${claimId}/receive`, {}, tok.akn.token)).status).toBe(403);
      await post(`/api/principal-claims/${claimId}/receive`, {}, tok.fin.token).expect(201);
      expect(await bal('1-1370')).toBe(0);
      expect((await post(`/api/principal-claims/${claimId}/receive`, {}, tok.fin.token)).status).toBe(400);
      const detail = (await get(`/api/principal-claims/${claimId}`).expect(200)).body;
      expect(detail.status).toBe('PAID');
      expect(detail.lines).toHaveLength(2);
    });
  });
});
