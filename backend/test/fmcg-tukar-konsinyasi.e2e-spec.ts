/**
 * FMCG: retur tukar-guling (butuh persetujuan, pengganti identik, batas per baris faktur) dan konsinyasi (titipan di gudang outlet,
 * laporan penjualan outlet diperiksa lalu ditagih orang lain, nomor laporan unik, batas nilai titipan).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('FMCG: tukar-guling & konsinyasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let tenantId: string;
  let wh: string;
  let P: string;
  let cust: string;
  const tok: Record<string, { token: string; id: string }> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const mk = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `tk-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `tk-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    tok[n] = { token: r.accessToken, id: r.user.id };
  };
  const qtyAt = async (warehouseId: string) => Number((await db.execute<{ q: string }>(sql`SELECT COALESCE(SUM(qty), 0)::text AS q FROM stock_balances WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${P}`)).rows[0].q);
  const bal = async (code: string) => Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Tukar Uji', name: 'Pemilik', email: `tk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    for (const [role, n] of [['ADMIN', 'adm'], ['ADMIN', 'adm2'], ['FINANCE', 'fin'], ['SALES', 'sls'], ['WAREHOUSE', 'gdg']] as const) await mk(role, n);
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: P, qty: '1000', unitCost: '600' }] }).expect(201);
    cust = (await post('/api/customers', { code: 'OTL', name: 'Outlet' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  describe('tukar-guling', () => {
    let invoiceId: string;
    let lineId: string;
    const invoiceFor = async (customerId: string, qty: string, date?: string) => {
      const so = (await post('/api/sales-orders', { customerId, warehouseId: wh, ...(date ? { date } : {}), lines: [{ productId: P, qty }] }).expect(201)).body;
      await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
      const inv = (await post('/api/invoices', { salesOrderId: so.id, ...(date ? { date } : {}) }).expect(201)).body;
      return inv.id as string;
    };
    beforeAll(async () => {
      invoiceId = await invoiceFor(cust, '100');
      lineId = (await get(`/api/invoices/${invoiceId}`).expect(200)).body.lines[0].id;
    });

    let swapId: string;
    it('dibuat sales sebagai usulan: stok & jurnal belum bergerak; barang pengganti identik dengan jumlah sama', async () => {
      const before = await qtyAt(wh);
      const r = await post('/api/goods-swaps', { invoiceId, reason: 'EXPIRED', lines: [{ invoiceLineId: lineId, qty: '10', lotNo: 'MIE-OLD' }] }, tok.sls.token).expect(201);
      swapId = r.body.id;
      expect(r.body.status).toBe('PENDING');
      expect(await qtyAt(wh)).toBe(before);
      expect(await bal('6-2160')).toBe(0);
    });

    it('batas per baris faktur: kumulatif termasuk yang menunggu; tidak bisa melebihi yang pernah dijual', async () => {
      const over = await post('/api/goods-swaps', { invoiceId, reason: 'DAMAGED', lines: [{ invoiceLineId: lineId, qty: '95' }] }, tok.sls.token);
      expect(over.status).toBe(400);
      expect(JSON.stringify(over.body)).toMatch(/melebihi/);
      expect((await post('/api/goods-swaps', { invoiceId, reason: 'DAMAGED', lines: [{ invoiceLineId: lineId, qty: '0' }] }, tok.sls.token)).status).toBe(400);
    });

    it('retur penjualan tidak bisa melebihi sisa setelah tukar-guling (tidak ada kompensasi ganda)', async () => {
      // baris faktur 100: tukar-guling 10 menunggu → retur 95 ditolak; retur 90 masih diperbolehkan oleh batas itu
      const over = await post('/api/sales-returns', { invoiceId, lines: [{ invoiceLineId: lineId, qty: '95' }] });
      expect(over.status).toBe(400);
      expect(JSON.stringify(over.body)).toMatch(/ditukar-guling/);
    });

    it('faktur terlalu lama (> 180 hari) ditolak', async () => {
      const old = await invoiceFor((await post('/api/customers', { code: 'LAMA', name: 'Outlet Lama' }).expect(201)).body.id, '5', daysAgo(200));
      const lid = (await get(`/api/invoices/${old}`).expect(200)).body.lines[0].id;
      const r = await post('/api/goods-swaps', { invoiceId: old, reason: 'EXPIRED', lines: [{ invoiceLineId: lid, qty: '1' }] }, tok.sls.token);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/180 hari/);
    });

    it('persetujuan: Sales/Gudang tidak berhak; pembuat Admin tidak menyetujui sendiri; Keuangan menyetujui → stok & beban tercatat, piutang tetap', async () => {
      expect((await post(`/api/goods-swaps/${swapId}/approve`, {}, tok.sls.token)).status).toBe(403);
      expect((await post(`/api/goods-swaps/${swapId}/approve`, {}, tok.gdg.token)).status).toBe(403);
      const mine = (await post('/api/goods-swaps', { invoiceId, reason: 'RECALL', lines: [{ invoiceLineId: lineId, qty: '5' }] }, tok.adm.token).expect(201)).body.id;
      expect((await post(`/api/goods-swaps/${mine}/approve`, {}, tok.adm.token)).status).toBe(403); // pemisahan fungsi
      const arBefore = await bal('1-1300');
      const before = await qtyAt(wh);
      const ok = (await post(`/api/goods-swaps/${swapId}/approve`, {}, tok.fin.token).expect(201)).body;
      expect(ok.status).toBe('APPROVED');
      expect(Number(ok.cost)).toBe(6000); // 10 × 600
      expect(await qtyAt(wh)).toBe(before - 10);
      expect(await bal('6-2160')).toBe(6000);
      expect(await bal('1-1300')).toBe(arBefore);
      expect((await post(`/api/goods-swaps/${swapId}/approve`, {}, tok.fin.token)).status).toBe(400); // tidak dobel
      // menolak
      await post(`/api/goods-swaps/${mine}/reject`, { reason: 'Tidak sesuai bukti foto' }, tok.fin.token).expect(201);
      const list = (await get('/api/goods-swaps?status=REJECTED').expect(200)).body;
      expect(list.map((x: { id: string }) => x.id)).toContain(mine);
    });
  });

  describe('konsinyasi', () => {
    let cw: string;
    let reportA: string;
    let reportB: string;
    let outlet: string;
    beforeAll(async () => {
      outlet = (await post('/api/customers', { code: 'TITIP', name: 'Toko Titipan', creditLimit: '30000' }).expect(201)).body.id;
    });

    it('kirim titipan: dibatasi limit kredit outlet (nilai pada harga pokok); gudang konsinyasi dibuat otomatis', async () => {
      // 100 pcs × 600 = 60.000 > limit 30.000
      const r = await post('/api/consignments/ship', { customerId: outlet, fromWarehouseId: wh, lines: [{ productId: P, qty: '100' }] }, tok.gdg.token);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/limit kredit/);
      await http.patch(`/api/customers/${outlet}`).set(as(owner)).send({ creditLimit: '0' }).expect(200);
      const before = await qtyAt(wh);
      await post('/api/consignments/ship', { customerId: outlet, fromWarehouseId: wh, notes: 'Titip perdana', lines: [{ productId: P, qty: '100' }] }, tok.gdg.token).expect(201);
      expect(await qtyAt(wh)).toBe(before - 100);
      const stock = (await get('/api/consignments/stock').expect(200)).body;
      const mine = stock.find((s: { customerId: string }) => s.customerId === outlet);
      cw = mine.warehouseId;
      expect(Number(mine.items[0].qty)).toBe(100);
      expect(Number(mine.costValue)).toBe(60000);
      expect(mine.stale).toBe(false);
      expect(await qtyAt(cw)).toBe(100);
    });

    it('titipan tidak bisa dipindah lewat transfer biasa atau dikoreksi lewat penyesuaian stok (hanya konsinyasi / opname)', async () => {
      const t = await post('/api/inventory/transfers', { fromWarehouseId: cw, toWarehouseId: wh, mode: 'DIRECT', lines: [{ productId: P, qty: '1' }] });
      expect(t.status).toBe(400);
      expect(JSON.stringify(t.body)).toMatch(/Konsinyasi/);
      expect((await post('/api/inventory/adjustments', { warehouseId: cw, reason: 'DAMAGED', lines: [{ productId: P, qty: '-1' }] })).status).toBe(400);
    });

    it('outlet peritel modern (wajib PO) tetap bisa ditagih lewat laporan konsinyasi; promo bonus tidak menambah baris', async () => {
      await post('/api/promos', { name: 'Bonus uji', kind: 'BONUS', productId: P, minQty: '1', bonusProductId: P, bonusQty: '1' }).expect(201);
      const po = (await post('/api/customers', { code: 'RTL', name: 'Peritel Modern', requirePo: true }).expect(201)).body.id;
      await post('/api/consignments/ship', { customerId: po, fromWarehouseId: wh, lines: [{ productId: P, qty: '20' }] }, tok.gdg.token).expect(201);
      const rep = (await post('/api/consignments/reports', { customerId: po, reference: 'LP-RTL-1', lines: [{ productId: P, qty: '10' }] }, tok.sls.token).expect(201)).body.id;
      const r = (await post(`/api/consignments/reports/${rep}/invoice`, {}, tok.fin.token).expect(201)).body;
      const inv = (await get(`/api/invoices/${r.invoiceId}`).expect(200)).body;
      expect(inv.lines).toHaveLength(1); // tanpa baris bonus
      expect(Number(inv.lines[0].qty)).toBe(10);
    });

    it('titipan tidak bisa dijual lewat pesanan biasa (harus lewat laporan outlet)', async () => {
      const r = await post('/api/sales-orders', { customerId: outlet, warehouseId: cw, lines: [{ productId: P, qty: '1' }] });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/konsinyasi/);
    });

    it('laporan penjualan outlet: nomor unik, tidak melebihi sisa titipan (termasuk laporan yang belum ditagih), hak peran', async () => {
      expect((await post('/api/consignments/reports', { customerId: outlet, reference: 'LP-0001', lines: [{ productId: P, qty: '30' }] }, tok.gdg.token)).status).toBe(403);
      reportA = (await post('/api/consignments/reports', { customerId: outlet, reference: 'LP-0001', lines: [{ productId: P, qty: '30' }] }, tok.sls.token).expect(201)).body.id;
      const dup = await post('/api/consignments/reports', { customerId: outlet, reference: 'LP-0001', lines: [{ productId: P, qty: '1' }] }, tok.sls.token);
      expect(dup.status).toBe(400);
      expect(JSON.stringify(dup.body)).toMatch(/dua kali/);
      const over = await post('/api/consignments/reports', { customerId: outlet, reference: 'LP-0002', lines: [{ productId: P, qty: '75' }] }, tok.sls.token);
      expect(over.status).toBe(400); // 100 − 30 belum ditagih = 70 tersisa
      reportB = (await post('/api/consignments/reports', { customerId: outlet, reference: 'LP-0002', lines: [{ productId: P, qty: '10' }] }, tok.adm.token).expect(201)).body.id;
    });

    it('penagihan oleh orang lain dari pelapor: faktur terbit, stok titipan berkurang, pendapatan & HPP diakui', async () => {
      expect((await post(`/api/consignments/reports/${reportB}/invoice`, {}, tok.adm.token)).status).toBe(403); // pelapor sendiri
      expect((await post(`/api/consignments/reports/${reportA}/invoice`, {}, tok.sls.token)).status).toBe(403); // peran
      const salesBefore = await bal('4-1000');
      const r = (await post(`/api/consignments/reports/${reportA}/invoice`, {}, tok.fin.token).expect(201)).body;
      expect(r.status).toBe('INVOICED');
      expect(r.invoiceNumber).toMatch(/^INV/);
      expect(await qtyAt(cw)).toBe(70);
      expect(await bal('4-1000')).toBe(salesBefore - 30000); // 30 × 1000
      expect((await post(`/api/consignments/reports/${reportA}/invoice`, {}, tok.fin.token)).status).toBe(400); // tidak dobel
      await post(`/api/consignments/reports/${reportB}/reject`, { reason: 'Angka tidak cocok dengan opname' }, tok.fin.token).expect(201);
    });

    it('tarik sisa: tidak boleh melebihi yang ada di outlet; kembali ke gudang biasa', async () => {
      const over = await post('/api/consignments/return', { customerId: outlet, toWarehouseId: wh, lines: [{ productId: P, qty: '71' }] }, tok.gdg.token);
      expect(over.status).toBe(400);
      const before = await qtyAt(wh);
      await post('/api/consignments/return', { customerId: outlet, toWarehouseId: wh, lines: [{ productId: P, qty: '20' }] }, tok.gdg.token).expect(201);
      expect(await qtyAt(wh)).toBe(before + 20);
      expect(await qtyAt(cw)).toBe(50);
      const docs = (await get(`/api/consignments/docs?customerId=${outlet}`).expect(200)).body;
      expect(docs.map((d: { kind: string }) => d.kind).sort()).toEqual(['REPORT', 'REPORT', 'RETURN', 'SHIP']);
    });

    it('nilai persediaan total tidak berubah oleh perpindahan ke gudang konsinyasi', async () => {
      const inv = await bal('1-1400');
      const stockValue = Number((await db.execute<{ v: string }>(sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE tenant_id = ${tenantId}`)).rows[0].v);
      expect(inv).toBeCloseTo(stockValue, 1);
    });
  });
});
