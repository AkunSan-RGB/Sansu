/**
 * Ritel: program loyalitas (poin diperoleh/ditukar/kedaluwarsa/retur, kewajiban cocok dengan buku besar) dan
 * rekonsiliasi pencairan QRIS/debit (MDR, selisih, toleransi, pembatalan, kontrol).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Ritel: loyalitas + pencairan QRIS/debit (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let owner = ''; let cashier = ''; let fin = ''; let adm = ''; let acct = ''; let other = '';
  let W = ''; let P = ''; let sessionId = ''; let ani = ''; let budi = '';
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `rl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return login(`rl-${n}-${stamp}@uji.id`, 'rahasia12345');
  };
  const sell = (qty: number, extra: object = {}, payments?: object[]) =>
    post(cashier, '/api/pos/orders', { sessionId, lines: [{ productId: P, qty: String(qty), price: '10000' }], payments: payments ?? [{ method: 'CASH', amount: '1000000' }], ...extra });
  const balanced = async () => expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  const summary = async () => (await get(acct, '/api/loyalty/summary').expect(200)).body;
  const balanceOf = async (c: string) => (await get(cashier, `/api/loyalty/members/${c}`).expect(200)).body.balance as number;
  const CFG = { enabled: true, earnPerRp: 10000, pointValueRp: 100, minRedeemPoints: 10, maxRedeemPct: 50, expiryMonths: 12 };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'Toko Ritel Poin', name: 'Pemilik', email: `rl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    P = (await post(owner, '/api/products', { sku: 'RL-1', name: 'Barang Ritel', sellPrice: '10000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: P, qty: '500', unitCost: '6000' }] }).expect(201);
    cashier = await mk('CASHIER', 'kasir');
    fin = await mk('FINANCE', 'fin');
    adm = await mk('ADMIN', 'adm');
    acct = await mk('ACCOUNTANT', 'akt');
    ani = (await post(owner, '/api/customers', { code: 'MB1', name: 'Ani Member', phone: '0811111' }).expect(201)).body.id;
    budi = (await post(owner, '/api/customers', { code: 'MB2', name: 'Budi Member' }).expect(201)).body.id;
    sessionId = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
    other = (await http.post('/api/auth/register').send({ companyName: 'Toko Lain', name: 'Lain', email: `rl-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  describe('loyalitas', () => {
    it('pengaturan: kasir hanya membaca; nilai tidak masuk akal ditolak; Admin mengubah dengan jejak audit', async () => {
      expect((await get(cashier, '/api/loyalty/settings').expect(200)).body.enabled).toBe(false);
      await put(cashier, '/api/loyalty/settings', CFG).expect(403);
      await put(adm, '/api/loyalty/settings', { ...CFG, pointValueRp: 10000 }).expect(400); // pengembalian ≥ 100%
      await put(adm, '/api/loyalty/settings', { ...CFG, maxRedeemPct: 0 }).expect(400);
      await put(adm, '/api/loyalty/settings', CFG).expect(200);
      const a = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'LoyaltySettings'`);
      expect(a.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    let earned = 0;
    it('belanja pelanggan terdaftar memberi poin; tanpa pelanggan tidak; kewajiban dijurnal', async () => {
      const none = (await sell(5).expect(201)).body;
      expect(none.loyaltyEarnedPoints).toBe(0);
      const o = (await sell(40, { customerId: ani }).expect(201)).body;
      earned = Math.floor(Number(o.total) / 10000);
      expect(earned).toBeGreaterThan(0);
      expect(o.loyaltyEarnedPoints).toBe(earned);
      expect(await balanceOf(ani)).toBe(earned);
      const s = await summary();
      expect(s.difference).toBe('0.00'); // buku poin = akun Utang Poin
      expect(Number(s.glLiability)).toBe(earned * 100);
      await balanced();
    });

    let redeemOrder = '';
    it('tukar poin: aturan saldo, minimum, batas persen, pelanggan; pembayaran tetap lengkap', async () => {
      await sell(5, {}, undefined).expect(201);
      await sell(5, { redeemPoints: 20 }).expect(400); // tanpa pelanggan
      await sell(5, { customerId: ani, redeemPoints: 5 }).expect(400); // di bawah minimum
      await sell(5, { customerId: ani, redeemPoints: 9999 }).expect(400); // melebihi saldo
      await sell(5, { customerId: budi, redeemPoints: 20 }).expect(400); // saldo nol
      // batas persentase terhadap total belanja: turunkan batas menjadi 1% lalu coba menukar 20 poin
      await put(adm, '/api/loyalty/settings', { ...CFG, maxRedeemPct: 1 }).expect(200);
      await sell(5, { customerId: ani, redeemPoints: 20 }).expect(400);
      await put(adm, '/api/loyalty/settings', CFG).expect(200);
      // bayar kurang dari sisa setelah potongan
      await sell(5, { customerId: ani, redeemPoints: 20 }, [{ method: 'CASH', amount: '1000' }]).expect(400);
      const before = await balanceOf(ani);
      const o = (await sell(5, { customerId: ani, redeemPoints: 20 }).expect(201)).body;
      redeemOrder = o.id;
      expect(o.loyaltyRedeemedPoints).toBe(20);
      expect(Number(o.loyaltyRedeemedValue)).toBe(2000);
      const earnedNow = Math.floor((Number(o.total) - 2000) / 10000);
      expect(await balanceOf(ani)).toBe(before - 20 + earnedNow);
      expect((await summary()).difference).toBe('0.00');
      await balanced();
    });

    it('satu transaksi satu penukaran dan satu perolehan (indeks unik)', async () => {
      const r = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM (SELECT order_id, kind FROM loyalty_ledger WHERE order_id IS NOT NULL AND kind IN ('EARN','REDEEM') GROUP BY order_id, kind HAVING COUNT(*) > 1) x`);
      expect(r.rows[0].n).toBe(0);
    });

    it('retur transaksi yang memakai poin: poin kembali, uang kembali hanya bagian yang dibayar nyata; kas laci cocok', async () => {
      const order = (await get(cashier, `/api/pos/orders/${redeemOrder}`).expect(200)).body;
      const before = await balanceOf(ani);
      const ret = (await post(owner, `/api/pos/orders/${redeemOrder}/return`, { all: true, reason: 'Barang dikembalikan pelanggan' }).expect(201)).body;
      // poin dipakai 20 dikembalikan; poin yang diperoleh dari transaksi ini dibalik
      expect(await balanceOf(ani)).toBe(before + 20 - order.loyaltyEarnedPoints);
      expect(Number(ret.pointsRefund)).toBe(2000);
      expect((await summary()).difference).toBe('0.00');
      await balanced();
      const row = await db.execute<{ total: string; points_refund: string }>(sql`SELECT total, points_refund FROM pos_returns WHERE id = ${ret.id}`);
      expect(Number(row.rows[0].total) - Number(row.rows[0].points_refund)).toBeCloseTo(Number(order.total) - 2000, 2);
    });

    it('penyesuaian manual: hanya Admin/Pemilik, wajib alasan, tidak melebihi saldo, tercatat dan cocok dengan buku besar', async () => {
      await post(cashier, '/api/loyalty/adjust', { customerId: budi, points: 50, reason: 'Kompensasi keluhan' }).expect(403);
      await post(fin, '/api/loyalty/adjust', { customerId: budi, points: 50, reason: 'Kompensasi keluhan' }).expect(403);
      await post(adm, '/api/loyalty/adjust', { customerId: budi, points: 50, reason: 'x' }).expect(400);
      await post(adm, '/api/loyalty/adjust', { customerId: budi, points: 0, reason: 'Nol poin tidak sah' }).expect(400);
      await post(adm, '/api/loyalty/adjust', { customerId: budi, points: 50, reason: 'Kompensasi keluhan' }).expect(201);
      expect(await balanceOf(budi)).toBe(50);
      await post(adm, '/api/loyalty/adjust', { customerId: budi, points: -80, reason: 'Koreksi salah input' }).expect(400);
      await post(adm, '/api/loyalty/adjust', { customerId: budi, points: -10, reason: 'Koreksi salah input' }).expect(201);
      expect(await balanceOf(budi)).toBe(40);
      const s = await summary();
      expect(s.difference).toBe('0.00');
      expect(s.recentAdjustments.length).toBeGreaterThanOrEqual(2);
      await balanced();
    });

    it('kedaluwarsa: poin lewat tanggal tidak bisa ditukar dan dijurnal; proses massal hanya Admin/Keuangan', async () => {
      await db.execute(sql`UPDATE loyalty_ledger SET expires_on = CURRENT_DATE - 1 WHERE customer_id = ${budi} AND remaining > 0`);
      expect((await summary()).dueForExpiry.points).toBe(40);
      // menukar poin yang sudah kedaluwarsa gagal (kedaluwarsa otomatis dulu, saldo menjadi 0)
      expect(await balanceOf(budi)).toBe(0); // tidak ditampilkan tersedia walau belum diproses
      await sell(5, { customerId: budi, redeemPoints: 10 }).expect(400);
      expect((await summary()).dueForExpiry.points).toBe(40);
      expect((await summary()).difference).toBe('0.00');
      // lot Ani dibuat kedaluwarsa lalu diproses massal
      await db.execute(sql`UPDATE loyalty_ledger SET expires_on = CURRENT_DATE - 1 WHERE customer_id = ${ani} AND remaining > 0`);
      await post(cashier, '/api/loyalty/expire').expect(403);
      await post(acct, '/api/loyalty/expire').expect(403);
      const r = (await post(fin, '/api/loyalty/expire').expect(201)).body;
      expect(r.points).toBeGreaterThan(0);
      expect(await balanceOf(ani)).toBe(0);
      const s = await summary();
      expect(s.difference).toBe('0.00');
      expect(Number(s.glLiability)).toBe(0);
      expect(s.pointsOutstanding).toBe(0);
      await balanced();
    });

    it('isolasi: perusahaan lain tidak melihat pelanggan/poin; pencarian pelanggan untuk kasir', async () => {
      expect((await get(other, '/api/loyalty/lookup?q=Ani').expect(200)).body).toHaveLength(0);
      await get(other, `/api/loyalty/members/${ani}`).expect(404);
      const hit = (await get(cashier, '/api/loyalty/lookup?q=Ani').expect(200)).body;
      expect(hit[0]).toMatchObject({ code: 'MB1' });
    });
  });

  describe('pencairan QRIS/debit', () => {
    const qrisSale = async (n: number) => (await sell(n, {}, [{ method: 'QRIS', amount: String(n * 10000) }, { method: 'CASH', amount: '1000000' }]).expect(201)).body;
    let p1: string[] = [];
    let gross = 0;

    it('pengaturan MDR: hanya Admin; nilai tak wajar ditolak', async () => {
      await put(fin, '/api/pos/card-settlements/settings', { qrisPct: 0.7, debitPct: 1, lateAfterDays: 4, toleranceRp: 5000 }).expect(403);
      await put(adm, '/api/pos/card-settlements/settings', { qrisPct: 50, debitPct: 1, lateAfterDays: 4, toleranceRp: 5000 }).expect(400);
      await put(adm, '/api/pos/card-settlements/settings', { qrisPct: 0.7, debitPct: 1, lateAfterDays: 4, toleranceRp: 5000 }).expect(200);
    });

    it('pembayaran QRIS belum cair terdaftar; pencairan pas dengan MDR kontrak menjurnal beban MDR dan mengurangi bank', async () => {
      const o1 = await qrisSale(3);
      const o2 = await qrisSale(4);
      const un = (await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body as { id: string; amount: string; orderNumber: string }[];
      p1 = un.filter((u) => [o1.number, o2.number].includes(u.orderNumber)).map((u) => u.id);
      expect(p1).toHaveLength(2);
      gross = un.filter((u) => p1.includes(u.id)).reduce((a, u) => a + Number(u.amount), 0);
      const mdr = Math.round(gross * 0.007);
      await post(cashier, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: p1, received: String(gross - mdr) }).expect(403);
      await post(acct, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: p1, received: String(gross - mdr) }).expect(403);
      await post(fin, '/api/pos/card-settlements', { method: 'DEBIT', paymentIds: p1, received: String(gross - mdr) }).expect(400); // metode tidak cocok
      await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [p1[0], p1[0]], received: '1' }).expect(400);
      await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: p1, received: String(gross + 1) }).expect(400); // melebihi kotor
      const s = (await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: p1, received: String(gross - mdr) }).expect(201)).body;
      expect(Number(s.difference)).toBe(0);
      expect(Number(s.mdr_expected)).toBe(mdr);
      expect(s.number).toMatch(/^PCS\//);
      // pembayaran yang sama tidak bisa dicairkan dua kali
      await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [p1[0]], received: '100' }).expect(400);
      const un2 = (await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body as { id: string }[];
      expect(un2.map((u) => u.id)).not.toContain(p1[0]);
      const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
      expect(tb.balanced).toBe(true);
      expect(Math.abs(Number(tb.rows.find((r: { code: string }) => r.code === '6-2450')?.balance ?? 0))).toBeCloseTo(mdr, 2);
    });

    it('selisih dari kontrak: wajib penjelasan; di atas toleransi hanya Admin/Pemilik; MDR efektif tinggi ditandai', async () => {
      const o = await qrisSale(10);
      const un = (await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body as { id: string; amount: string; orderNumber: string }[];
      const id = un.find((u) => u.orderNumber === o.number)!.id;
      const g = Number(un.find((u) => u.id === id)!.amount);
      const expectedNet = g - Math.round(g * 0.007);
      await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [id], received: String(expectedNet - 1000) }).expect(400); // selisih tanpa catatan
      // selisih kecil (≤ toleransi) boleh oleh Keuangan dengan catatan
      const small = (await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [id], received: String(expectedNet - 1000), note: 'Biaya admin tambahan penyelenggara' }).expect(201)).body;
      expect(Number(small.difference)).toBe(-1000);
      // selisih besar: Keuangan ditolak, Admin boleh
      const o2 = await qrisSale(10);
      const id2 = ((await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body as { id: string; orderNumber: string }[]).find((u) => u.orderNumber === o2.number)!.id;
      const big = String(expectedNet - 20000);
      await post(fin, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [id2], received: big, note: 'Potongan tidak dikenal' }).expect(403);
      const adminSettled = (await post(adm, '/api/pos/card-settlements', { method: 'QRIS', paymentIds: [id2], received: big, note: 'Potongan tidak dikenal' }).expect(201)).body;
      const c = (await get(acct, '/api/pos/card-settlements/controls').expect(200)).body;
      expect(c.withDifference.map((x: { number: string }) => x.number)).toEqual(expect.arrayContaining([small.number, adminSettled.number]));
      expect(c.highEffectiveMdr.map((x: { number: string }) => x.number)).toContain(adminSettled.number);
      const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
      expect(tb.balanced).toBe(true);
    });

    it('pembatalan: hanya Admin dengan alasan; jurnal dibalik dan pembayaran bisa dicairkan ulang', async () => {
      const list = (await get(fin, '/api/pos/card-settlements').expect(200)).body as { id: string; number: string; status: string }[];
      const target = list.find((x) => x.status === 'POSTED')!;
      await post(fin, `/api/pos/card-settlements/${target.id}/cancel`, { reason: 'Salah input jumlah' }).expect(403);
      await post(adm, `/api/pos/card-settlements/${target.id}/cancel`, { reason: 'x' }).expect(400);
      const before = (await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body.length;
      await post(adm, `/api/pos/card-settlements/${target.id}/cancel`, { reason: 'Salah input jumlah' }).expect(201);
      await post(adm, `/api/pos/card-settlements/${target.id}/cancel`, { reason: 'Salah input jumlah' }).expect(400); // sudah dibatalkan
      expect((await get(fin, '/api/pos/card-settlements/unsettled?method=QRIS').expect(200)).body.length).toBeGreaterThan(before);
      await balanced();
    });

    it('kontrol: pembayaran belum cair melewati batas hari ditandai; isolasi antar perusahaan', async () => {
      await db.execute(sql`UPDATE pos_orders SET date = CURRENT_DATE - 10 WHERE id IN (SELECT o.id FROM pos_orders o JOIN pos_payments p ON p.order_id = o.id WHERE p.method = 'QRIS' AND NOT EXISTS (SELECT 1 FROM pos_card_settlement_items i WHERE i.payment_id = p.id) AND o.tenant_id = (SELECT tenant_id FROM pos_sessions WHERE id = ${sessionId}))`);
      const c = (await get(acct, '/api/pos/card-settlements/controls').expect(200)).body;
      expect(c.notSettledLate.length).toBeGreaterThanOrEqual(1);
      expect((await get(other, '/api/pos/card-settlements').expect(200)).body).toHaveLength(0);
      expect((await get(other, '/api/pos/card-settlements/unsettled').expect(200)).body).toHaveLength(0);
    });
  });
});
