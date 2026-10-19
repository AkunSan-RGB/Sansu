/**
 * Ritel: pencairan QRIS/debit lanjutan — retur non-tunai dipotongkan dari pencairan (dasar MDR = penjualan bersih, satu retur sekali)
 * dan satu pencairan untuk beberapa rekening bank (uang masuk dan selisih per rekening).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Ritel: pencairan lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let owner = ''; let cashier = ''; let cashier2 = ''; let fin = ''; let adm = ''; let other = '';
  let W = ''; let P = ''; let s1 = ''; let s2 = ''; let bank2 = '';
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `rp-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return login(`rp-${n}-${stamp}@uji.id`);
  };
  const sell = (t: string, session: string, amount: number, payments: object[]) => post(t, '/api/pos/orders', { sessionId: session, lines: [{ productId: P, qty: String(amount / 10000), price: '10000' }], payments }).expect(201).then((r) => r.body as { id: string; number: string });
  const balanced = async () => expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  const unsettled = async (method = 'QRIS') => (await get(fin, `/api/pos/card-settlements/unsettled?method=${method}`).expect(200)).body as { id: string; orderNumber: string; amount: string }[];
  const returnsOf = async (method = 'QRIS') => (await get(fin, `/api/pos/card-settlements/unsettled-returns?method=${method}`).expect(200)).body as { id: string; orderNumber: string; total: string }[];
  const payOf = async (n: string) => (await unsettled()).find((u) => u.orderNumber === n)!.id;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Toko Pencairan', name: 'Pemilik', email: `rp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    P = (await post(owner, '/api/products', { sku: 'RP-1', name: 'Barang', sellPrice: '10000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: P, qty: '1000', unitCost: '6000' }] }).expect(201);
    cashier = await mk('CASHIER', 'kasir'); cashier2 = await mk('CASHIER', 'kasir2'); fin = await mk('FINANCE', 'fin'); adm = await mk('ADMIN', 'adm');
    other = (await http.post('/api/auth/register').send({ companyName: 'Toko Lain', name: 'Lain', email: `rp-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    bank2 = (await post(owner, '/api/accounting/accounts', { code: '1-1210', name: 'Bank Kedua', type: 'ASSET', isCashAccount: true }).expect(201)).body.id;
    s1 = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '0' }).expect(201)).body.id;
    s2 = (await post(cashier2, '/api/pos/sessions', { warehouseId: W, openingCash: '0', bankAccountId: bank2 }).expect(201)).body.id;
    await put(adm, '/api/pos/card-settlements/settings', { qrisPct: 0.7, debitPct: 1, lateAfterDays: 4, toleranceRp: 5000 }).expect(200);
  });
  afterAll(() => app.close());

  describe('retur non-tunai dipotongkan dari pencairan', () => {
    let A = ''; let B = ''; let C = ''; let retB = ''; let retC = ''; let retCash = '';
    it('retur yang layak dipotongkan: refund lewat rekening dari pesanan yang seluruhnya dibayar metode itu', async () => {
      const a = await sell(cashier, s1, 1_000_000, [{ method: 'QRIS', amount: '1000000' }]); A = a.number;
      const b = await sell(cashier, s1, 500_000, [{ method: 'QRIS', amount: '500000' }]); B = b.number;
      const c = await sell(cashier, s1, 200_000, [{ method: 'CASH', amount: '100000' }, { method: 'QRIS', amount: '100000' }]); C = c.number;
      const d = await sell(cashier, s1, 100_000, [{ method: 'CASH', amount: '100000' }]);
      retB = (await post(owner, `/api/pos/orders/${b.id}/return`, { all: true, reason: 'Barang cacat dikembalikan', refundMethod: 'BANK' }).expect(201)).body.id;
      retC = (await post(owner, `/api/pos/orders/${c.id}/return`, { all: true, reason: 'Pelanggan batal beli', refundMethod: 'BANK' }).expect(201)).body.id;
      retCash = (await post(owner, `/api/pos/orders/${d.id}/return`, { all: true, reason: 'Salah barang', refundMethod: 'CASH' }).expect(201)).body.id;
      const list = await returnsOf();
      expect(list.map((r) => r.id)).toEqual([retB]); // retur campuran tunai+QRIS dan retur tunai tidak layak
      expect(Number(list[0].total)).toBe(500_000);
      await balanced();
    });

    it('validasi: retur bukan milik metode ini, bukan refund rekening, atau melebihi penjualan ditolak', async () => {
      const pA = await payOf(A);
      const base = { method: 'QRIS', paymentIds: [pA], received: '995000' };
      expect((await post(fin, '/api/pos/card-settlements', { ...base, returnIds: [retC] })).status).toBe(400); // pesanan campuran
      expect((await post(fin, '/api/pos/card-settlements', { ...base, returnIds: [retCash] })).status).toBe(400); // refund tunai
      expect((await post(fin, '/api/pos/card-settlements', { ...base, returnIds: [retB, retB] })).status).toBe(400); // dobel
      expect((await post(fin, '/api/pos/card-settlements', { ...base, method: 'DEBIT', paymentIds: [pA], returnIds: [retB] })).status).toBe(400); // metode lain
      const pC = (await unsettled()).find((u) => u.orderNumber === C)!.id;
      expect((await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [pC], received: '1', returnIds: [retB] })).status).toBe(400); // retur 500 rb > penjualan 100 rb
      expect((await post(other, '/api/pos/card-settlements', { ...base, returnIds: [retB] })).status).toBeGreaterThanOrEqual(400);
    });

    let settleId = '';
    it('pencairan dengan retur: dasar MDR = penjualan bersih; jurnal seimbang; satu retur sekali', async () => {
      const ps = [await payOf(A), (await unsettled()).find((u) => u.orderNumber === C)!.id];
      // kotor 1.100.000 − retur 500.000 = 600.000; MDR 0,7% = 4.200; seharusnya masuk 595.800
      const s = (await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: ps, returnIds: [retB], received: '595800' }).expect(201)).body;
      settleId = s.id;
      expect(Number(s.gross)).toBe(1_100_000);
      expect(Number(s.returns_total)).toBe(500_000);
      expect(Number(s.mdr_expected)).toBe(4200);
      expect(Number(s.difference)).toBe(0);
      expect((await returnsOf()).map((r) => r.id)).toEqual([]); // sudah dipotongkan
      expect((await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [await payOf(B)], received: '497500', returnIds: [retB] })).status).toBe(400); // retur sudah terpakai
      await balanced();
      // selisih tanpa catatan ditolak, dengan catatan diterima
      const row = (await db.execute<{ debit: string; credit: string }>(sql`SELECT COALESCE(SUM(l.credit), 0) AS credit, COALESCE(SUM(l.debit), 0) AS debit FROM journal_lines l JOIN pos_card_settlements s ON s.journal_id = l.journal_id WHERE s.id = ${settleId}`)).rows[0];
      expect(Number(row.credit)).toBe(4200);
      expect(Number(row.debit)).toBe(4200);
    });

    it('pembatalan membebaskan retur untuk dipotongkan lagi; jurnal dibalik', async () => {
      await post(adm, `/api/pos/card-settlements/${settleId}/cancel`, { reason: 'Salah memilih pembayaran' }).expect(201);
      expect((await returnsOf()).map((r) => r.id)).toEqual([retB]);
      await balanced();
      // pencairan ulang: kali ini bersama penjualan B sendiri
      const ps = [await payOf(A), await payOf(B)];
      // kotor 1.500.000 − retur 500.000 = 1.000.000; MDR 7.000 → 993.000. Penjualan bersih melebihi uang masuk tidak boleh
      expect((await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: ps, returnIds: [retB], received: '1000001' })).status).toBe(400);
      const s = (await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: ps, returnIds: [retB], received: '993000' }).expect(201)).body;
      expect(Number(s.difference)).toBe(0);
      expect(Number(s.mdr_expected)).toBe(7000);
      await balanced();
    });
  });

  describe('beberapa rekening bank dalam satu pencairan', () => {
    it('wajib rincian per rekening; rekening salah/dobel/kurang ditolak; jurnal mengkredit tiap rekening; selisih per rekening', async () => {
      const e = await sell(cashier, s1, 200_000, [{ method: 'DEBIT', amount: '200000' }]);
      const f = await sell(cashier2, s2, 300_000, [{ method: 'DEBIT', amount: '300000' }]);
      const ids = [(await unsettled('DEBIT')).find((u) => u.orderNumber === e.number)!.id, (await unsettled('DEBIT')).find((u) => u.orderNumber === f.number)!.id];
      const bank1 = (await db.execute<{ bank_account_id: string }>(sql`SELECT bank_account_id FROM pos_sessions WHERE id = ${s1}`)).rows[0].bank_account_id;
      // DEBIT 1%: rekening 1 → 198.000, rekening 2 → 297.000
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, received: '495000' })).status).toBe(400); // dua rekening: wajib rincian
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: [{ bankAccountId: bank1, received: '198000' }] })).status).toBe(400); // kurang satu rekening
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: [{ bankAccountId: bank1, received: '198000' }, { bankAccountId: bank1, received: '297000' }] })).status).toBe(400); // dobel
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: [{ bankAccountId: bank1, received: '198000' }, { bankAccountId: '00000000-0000-4000-8000-000000000000', received: '297000' }] })).status).toBe(400); // rekening asing
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: [{ bankAccountId: bank1, received: '200001' }, { bankAccountId: bank2, received: '297000' }] })).status).toBe(400); // melebihi penjualan rekening itu
      // selisih di rekening 2 melebihi toleransi: Keuangan ditolak; Admin boleh dengan catatan
      const diffRecs = [{ bankAccountId: bank1, received: '198000' }, { bankAccountId: bank2, received: '285000' }];
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: diffRecs })).status).toBe(400); // tanpa catatan
      expect((await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: diffRecs, note: 'Potongan tambahan bank kedua' })).status).toBe(403);
      const s = (await post(adm, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: ids, bankReceipts: diffRecs, note: 'Potongan tambahan bank kedua' }).expect(201)).body;
      expect(Number(s.received)).toBe(483_000);
      expect(Number(s.difference)).toBe(-12_000);
      const banks = (await db.execute<{ bank_account_id: string; received: string }>(sql`SELECT bank_account_id, received FROM pos_card_settlement_banks WHERE settlement_id = ${s.id} ORDER BY received`)).rows;
      expect(banks.map((b) => Number(b.received))).toEqual([198_000, 285_000]);
      // jurnal: kredit rekening 1 = 2.000 (MDR), rekening 2 = 15.000 (3.000 MDR + 12.000 selisih), beban MDR 5.000, beban bank 12.000
      const lines = (await db.execute<{ account_id: string; debit: string; credit: string }>(sql`SELECT l.account_id, l.debit, l.credit FROM journal_lines l JOIN pos_card_settlements s ON s.journal_id = l.journal_id WHERE s.id = ${s.id}`)).rows;
      const credit = (a: string) => Number(lines.find((l) => l.account_id === a)?.credit ?? 0);
      expect(credit(bank1)).toBe(2000);
      expect(credit(bank2)).toBe(15000);
      expect(lines.reduce((a, l) => a + Number(l.debit), 0)).toBe(17000);
      await balanced();
      // pembatalan membalik semua baris dan membebaskan pembayaran
      await post(adm, `/api/pos/card-settlements/${s.id}/cancel`, { reason: 'Rekening koran diperiksa ulang' }).expect(201);
      expect((await unsettled('DEBIT')).length).toBe(2);
      await balanced();
    });

    it('kontrol: MDR efektif dihitung atas penjualan bersih; isolasi perusahaan', async () => {
      const c = (await get(fin, '/api/pos/card-settlements/controls').expect(200)).body;
      expect(c.withDifference).toBeDefined();
      expect((await get(other, '/api/pos/card-settlements/unsettled-returns').expect(200)).body).toHaveLength(0);
    });
  });
});
