/**
 * Uji acak berbasis invarian akuntansi.
 * Menjalankan urutan operasi campuran (pembelian, penjualan, pembayaran, retur, stok, aset, kasir, kas, jurnal)
 * dengan generator acak berbenih tetap, lalu memeriksa bahwa hukum pembukuan tidak pernah dilanggar:
 *   - setiap jurnal seimbang; neraca saldo dan persamaan akuntansi seimbang
 *   - piutang/utang di buku besar = saldo dokumen; persediaan di buku besar = nilai stok
 *   - stok tidak negatif; pembayaran + retur tidak melebihi tagihan; status dokumen konsisten
 *   - tidak ada respons error server (5xx); penolakan bisnis (4xx) wajar
 * Ulangi satu benih: FUZZ_SEED=123 npx jest ... integrity-fuzz
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = process.env.FUZZ_SEEDS ? process.env.FUZZ_SEEDS.split(',').map(Number) : process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [101, 202, 303, 404, 505];
const STEPS = Number(process.env.FUZZ_STEPS ?? 70);

describe('Uji acak invarian akuntansi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it.each(SEEDS)('benih %i: invarian terjaga setelah setiap langkah', async (seed) => {
    const rand = rng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const log: string[] = [];
    const stats = { ok: 0, rejected: 0 };
    const byLabel: Record<string, [number, number]> = {};
    const reasons: Record<string, number> = {};

    const token = (
      await http.post('/api/auth/register').send({ companyName: `Fuzz ${seed}`, name: 'Pemilik', email: `fuzz-${seed}-${Date.now()}@uji.id`, password: 'rahasia123', ...(seed % 3 !== 1 ? { businessModel: 'MANUFAKTUR' } : {}) }).expect(201)
    ).body.accessToken;
    const tenantId = (await http.get('/api/auth/me').set({ Authorization: `Bearer ${token}` })).body.tenantId as string;
    const H = { Authorization: `Bearer ${token}` };
    // benih ganjil memakai MPKP/FIFO, genap rata-rata bergerak: invarian harus sama untuk keduanya
    await http.put('/api/settings/inventory-method').set(H).send({ method: seed % 2 === 1 ? 'FIFO' : 'AVERAGE' }).expect(200);
    const call = async (method: 'get' | 'post' | 'put' | 'patch', url: string, body?: object) => {
      const r = await (http as any)[method](`/api${url}`).set(H).send(body);
      if (r.status >= 500) throw new Error(`ERROR SERVER ${r.status} ${method.toUpperCase()} ${url} ${JSON.stringify(body)}\n${JSON.stringify(r.body).slice(0, 400)}\nlangkah: ${log.slice(-6).join(' | ')}`);
      return r;
    };
    const tryPost = async (label: string, url: string, body: object) => {
      const r = await call('post', url, body);
      log.push(`${label}:${r.status}`);
      r.status < 300 ? stats.ok++ : stats.rejected++;
      (byLabel[label] ??= [0, 0])[r.status < 300 ? 0 : 1]++;
      if (r.status >= 300 && process.env.FUZZ_WHY) {
        const m = String(r.body?.message ?? JSON.stringify(r.body)).replace(/[0-9a-f-]{36}/g, '<id>').replace(/\d[\d.,]*/g, 'N').slice(0, 110);
        reasons[`${label}: ${m}`] = (reasons[`${label}: ${m}`] ?? 0) + 1;
      }
      return r;
    };

    // ---- data dasar ----
    for (const app of ['pos', 'hr', 'payroll']) await call('post', `/apps/${app}/install`);
    const employee = await call('post', '/hr/employees', { code: `E-${seed}`, name: 'Pegawai Uji', ptkp: pick(['TK/0', 'K/1', 'K/3']), joinDate: `${new Date().getFullYear() - 2}-01-02`, baseSalary: String(int(5, 15) * 1000000), fixedAllowance: '500000', bpjsKes: true, bpjsTk: true, bpjsJp: true });
    const wh1 = (await call('get', '/warehouses')).body[0].id as string;
    const wh2 = (await call('post', '/warehouses', { code: 'GDG-02', name: 'Gudang Dua' })).body.id as string;
    const products: string[] = [];
    for (let i = 0; i < 3; i++) products.push((await call('post', '/products', { sku: `FZ-${seed}-${i}`, name: `Barang ${i}`, sellPrice: String(8000 + i * 3000) })).body.id);
    // Perusahaan manufaktur: hasil resep (barang ke-3) adalah barang setengah jadi dengan akun persediaan tersendiri
    if (seed % 3 !== 1) await call('patch', `/products/${products[2]}`, { inventoryKind: 'SEMI' });
    const customers: string[] = [];
    for (let i = 0; i < 2; i++) customers.push((await call('post', '/customers', { code: `C-${i}`, name: `Pelanggan ${i}`, creditLimit: '1000000000', paymentTermDays: 30 })).body.id);
    const suppliers: string[] = [];
    for (let i = 0; i < 2; i++) suppliers.push((await call('post', '/suppliers', { code: `S-${i}`, name: `Pemasok ${i}` })).body.id);
    const accs = (await call('get', '/accounting/accounts')).body as { id: string; code: string }[];
    const acc = (c: string) => accs.find((a) => a.code === c)!.id;
    const cashAccounts = (await call('get', '/cash/accounts')).body as { id: string; code: string }[];
    const kas = cashAccounts.find((c) => c.code === '1-1100')!.id;
    const bank = cashAccounts.find((c) => c.code === '1-1200')!.id;
    const categories = (await call('get', '/assets/categories')).body as { id: string; name: string }[];
    await call('post', '/inventory/adjustments', { warehouseId: wh1, reason: 'OPENING', lines: products.map((p) => ({ productId: p, qty: '50', unitCost: '5000' })) });
    await call('post', '/accounting/journals', {
      date: new Date().toISOString().slice(0, 10),
      description: 'Modal',
      lines: [{ accountId: acc('1-1100'), debit: '2000000000' }, { accountId: acc('1-1200'), debit: '2000000000' }, { accountId: acc('3-1000'), credit: '4000000000' }],
    });
    const thisYear = new Date().getFullYear();
    const todayStr = new Date().toISOString().slice(0, 10);
    /** 35% dokumen bertanggal mundur (tahun ini atau tahun lalu) agar ada laba rugi tahun lalu untuk ditutup */
    const maybePast = () => (rand() < 0.35 ? { date: `${rand() < 0.5 ? thisYear - 1 : thisYear}-${String(int(1, 9)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}` } : {});
    const salesInvoices: string[] = [];
    const assetIds: string[] = [];
    let boms: string | null = null;
    const payrollPeriods = new Set<string>();
    const purchaseInvoices: string[] = [];
    const journals: string[] = [];
    let posSession: string | null = null;
    let seq = 0;

    // ---- invarian ----
    const q = async <T = any>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
    const glBalance = async (code: string) => {
      const r = await q<{ v: string }>(
        `SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.tenant_id=$1 AND a.code=$2`,
        [tenantId, code],
      );
      return Number(r[0].v);
    };
    const checkInvariants = async (when: string) => {
      const ctx = `[benih ${seed} · ${when}] langkah terakhir: ${log.slice(-5).join(' | ')}`;
      const unbalanced = await q(`SELECT j.number, SUM(l.debit)-SUM(l.credit) AS d FROM journal_entries j JOIN journal_lines l ON l.journal_id=j.id WHERE j.tenant_id=$1 GROUP BY j.id, j.number HAVING SUM(l.debit)<>SUM(l.credit)`, [tenantId]);
      expect({ ctx, unbalancedJournals: unbalanced }).toEqual({ ctx, unbalancedJournals: [] });
      const negStock = await q(`SELECT product_id, warehouse_id, qty FROM stock_balances WHERE tenant_id=$1 AND qty < 0`, [tenantId]);
      expect({ ctx, negativeStock: negStock }).toEqual({ ctx, negativeStock: [] });
      const badInv = await q(`SELECT number, total, paid_amount, returned_amount, status FROM invoices WHERE tenant_id=$1 AND (paid_amount<0 OR returned_amount<0 OR paid_amount+returned_amount > total + 0.005)`, [tenantId]);
      expect({ ctx, overpaidInvoices: badInv }).toEqual({ ctx, overpaidInvoices: [] });
      const badPi = await q(`SELECT number, total, paid_amount, returned_amount FROM purchase_invoices WHERE tenant_id=$1 AND (paid_amount<0 OR returned_amount<0 OR paid_amount+returned_amount > total + 0.005)`, [tenantId]);
      expect({ ctx, overpaidPurchaseInvoices: badPi }).toEqual({ ctx, overpaidPurchaseInvoices: [] });
      const badStatus = await q(`SELECT number, status, total, paid_amount, returned_amount FROM invoices WHERE tenant_id=$1 AND ((status='PAID') <> (paid_amount + returned_amount >= total - 0.005))`, [tenantId]);
      expect({ ctx, inconsistentInvoiceStatus: badStatus }).toEqual({ ctx, inconsistentInvoiceStatus: [] });

      const ar = Number((await q(`SELECT COALESCE(SUM(total - paid_amount - returned_amount),0) AS v FROM invoices WHERE tenant_id=$1`, [tenantId]))[0].v);
      expect({ ctx, ar: await glBalance('1-1300') }).toEqual({ ctx, ar: expect.closeTo(ar, 1) });
      const ap = Number((await q(`SELECT COALESCE(SUM(total - paid_amount - returned_amount),0) AS v FROM purchase_invoices WHERE tenant_id=$1`, [tenantId]))[0].v);
      expect({ ctx, ap: -(await glBalance('2-1100')) }).toEqual({ ctx, ap: expect.closeTo(ap, 1) });
      const stockOf = async (kind: string) => Number((await q(`SELECT COALESCE(SUM(b.qty*b.avg_cost),0) AS v FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.tenant_id=$1 AND p.inventory_kind=$2`, [tenantId, kind]))[0].v);
      // Persediaan di gudang (1-1400) = nilai stok barang biasa; barang setengah jadi di 1-1430; barang dalam perjalanan di 1-1410 (nol bila tak ada transfer berjalan)
      expect({ ctx, inventoryGL: await glBalance('1-1400') }).toEqual({ ctx, inventoryGL: expect.closeTo(await stockOf('GOODS'), -1) }); // toleransi pembulatan biaya rata-rata
      expect({ ctx, semiGL: await glBalance('1-1430') }).toEqual({ ctx, semiGL: expect.closeTo(await stockOf('SEMI'), -1) });
      // Barang diterima belum ditagih (2-1160) = nilai penerimaan aktif yang belum difakturkan (jalur terima dulu)
      const grni = Number((await q(`SELECT COALESCE(SUM(l.value - l.billed_value),0) AS v FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l.receipt_id WHERE g.tenant_id=$1 AND g.status='RECEIVED' AND g.auto_invoice_id IS NULL`, [tenantId]))[0].v);
      expect({ ctx, grni: -(await glBalance('2-1160')) }).toEqual({ ctx, grni: expect.closeTo(grni, 1) });
      const inTransit = Number((await q(`SELECT COUNT(*) AS n FROM stock_transfers WHERE tenant_id=$1 AND status='IN_TRANSIT'`, [tenantId]))[0].n);
      const transitGL = await glBalance('1-1410');
      expect({ ctx, transitGL }).toEqual({ ctx, transitGL: inTransit ? expect.any(Number) : expect.closeTo(0, 1) });
      expect(transitGL).toBeGreaterThanOrEqual(-0.5);
    };

    // ---- operasi ----
    const stockOf = async (p: string, w: string) => Number((await q<{ qty: string }>(`SELECT qty FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 AND warehouse_id=$3`, [tenantId, p, w]))[0]?.qty ?? 0);
    /** Sepertiga faktur datang dengan harga berbeda dari PO (harga volatil) */
    const repriced = (po: { lines: { id: string; price: string }[] }) =>
      rand() < 0.35 ? { varianceReason: 'MARKET_VOLATILITY', prices: po.lines.map((l) => ({ orderLineId: l.id, price: String(Math.max(1, Math.round(Number(l.price) * (0.7 + rand() * 0.7)))) })) } : {};
    const ops: Record<string, () => Promise<void>> = {
      async buy() {
        const lines = Array.from({ length: int(1, 2) }, () => ({ productId: pick(products), qty: String(int(1, 40)), price: String(int(3, 9) * 1000) }));
        const when = maybePast();
        const po = await tryPost('po', '/purchase-orders', { supplierId: pick(suppliers), warehouseId: pick([wh1, wh1, wh2]), lines, ...when });
        if (po.status !== 201) return;
        await tryPost('po-confirm', `/purchase-orders/${po.body.id}/confirm`, {});
        const pi = await tryPost('pi', '/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: `F-${seed}-${++seq}`, ...repriced(po.body), ...when });
        if (pi.status === 201) purchaseInvoices.push(pi.body.id);
      },
      /** Jalur terima dulu: penerimaan bertahap (kadang dibatalkan) lalu faktur bertahap atau penuh */
      async receiveThenBill() {
        const lines = Array.from({ length: int(1, 2) }, () => ({ productId: pick(products), qty: String(int(2, 30)), price: String(int(3, 9) * 1000) }));
        const when = maybePast();
        const po = await tryPost('po', '/purchase-orders', { supplierId: pick(suppliers), warehouseId: pick([wh1, wh1, wh2]), lines, ...when });
        if (po.status !== 201) return;
        await tryPost('po-confirm', `/purchase-orders/${po.body.id}/confirm`, {});
        const full = (await http.get(`/api/purchase-orders/${po.body.id}`).set(H)).body as { lines: { id: string; qty: string }[] };
        const part = full.lines.map((l) => ({ orderLineId: l.id, qty: String(Math.max(1, Math.floor(Number(l.qty) * (0.3 + rand() * 0.5)))) }));
        const g1 = await tryPost('gr', `/purchase-orders/${po.body.id}/receipts`, { lines: part, ...when });
        if (g1.status !== 201) return;
        if (rand() < 0.2) {
          await tryPost('gr-cancel', `/goods-receipts/${g1.body.id}/cancel`, {});
          return;
        }
        if (rand() < 0.5) {
          const bill1 = await tryPost('pi-gr', '/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: `G-${seed}-${++seq}`, lines: part.map((l) => ({ ...l, qty: String(Math.max(1, Math.floor(Number(l.qty) / 2))) })), ...repriced(po.body), ...when });
          if (bill1.status === 201) purchaseInvoices.push(bill1.body.id);
        }
        await tryPost('gr', `/purchase-orders/${po.body.id}/receipts`, { ...when });
        const bill2 = await tryPost('pi-gr', '/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: `G-${seed}-${++seq}`, ...repriced(po.body), ...when });
        if (bill2.status === 201) purchaseInvoices.push(bill2.body.id);
      },
      async sell() {
        const w = pick([wh1, wh1, wh2]);
        const p = pick(products);
        const have = await stockOf(p, w);
        const qty = have > 0 && rand() < 0.9 ? int(1, Math.max(1, Math.min(have, 12))) : int(1, 5);
        const when = maybePast();
        const so = await tryPost('so', '/sales-orders', { customerId: pick(customers), warehouseId: w, ...when, lines: [{ productId: p, qty: String(qty), ...(rand() < 0.3 ? { price: String(int(5, 20) * 1000) } : {}) }] });
        if (so.status !== 201) return;
        await tryPost('so-confirm', `/sales-orders/${so.body.id}/confirm`, {});
        const inv = await tryPost('inv', '/invoices', { salesOrderId: so.body.id, ...when });
        if (inv.status === 201) salesInvoices.push(inv.body.id);
      },
      /** Jalur kirim dulu: surat jalan → (batal | faktur kemudian, mungkin bertanggal berbeda) */
      async deliverThenInvoice() {
        const w = pick([wh1, wh1, wh2]);
        const p = pick(products);
        const have = await stockOf(p, w);
        const qty = have > 0 && rand() < 0.9 ? int(1, Math.max(1, Math.min(have, 8))) : int(1, 4);
        const when = maybePast();
        const so = await tryPost('so', '/sales-orders', { customerId: pick(customers), warehouseId: w, ...when, lines: [{ productId: p, qty: String(qty) }] });
        if (so.status !== 201) return;
        await tryPost('so-confirm', `/sales-orders/${so.body.id}/confirm`, {});
        const del = await tryPost('deliver', `/sales-orders/${so.body.id}/deliver`, { ...when });
        if (del.status !== 201) return;
        if (rand() < 0.3) {
          await tryPost('deliver-cancel', `/deliveries/${del.body.id}/cancel`, {});
          return;
        }
        const inv = await tryPost('inv-after-delivery', '/invoices', { salesOrderId: so.body.id, ...when });
        if (inv.status === 201) salesInvoices.push(inv.body.id);
      },
      async payAR() {
        if (!salesInvoices.length) return;
        const id = pick(salesInvoices);
        const inv = (await call('get', `/invoices/${id}`)).body;
        const open = Number(inv.total) - Number(inv.paidAmount) - Number(inv.returnedAmount);
        const amount = rand() < 0.5 ? open : Math.max(1, Math.floor(open * rand()));
        await tryPost('pay-ar', '/payments', { invoiceId: id, amount: String(amount), cashAccountId: pick([kas, bank]), method: 'TRANSFER' });
      },
      async payAP() {
        if (!purchaseInvoices.length) return;
        const id = pick(purchaseInvoices);
        const pi = (await call('get', `/purchase-invoices/${id}`)).body;
        const open = Number(pi.total) - Number(pi.paidAmount) - Number(pi.returnedAmount);
        const amount = rand() < 0.5 ? open : Math.max(1, Math.floor(open * rand()));
        await tryPost('pay-ap', '/purchase-invoices/payments', { purchaseInvoiceId: id, amount: String(amount) });
      },
      async salesReturn() {
        if (!salesInvoices.length) return;
        const inv = (await call('get', `/invoices/${pick(salesInvoices)}`)).body;
        const line = pick(inv.lines as { id: string; qty: string }[]);
        await tryPost('ret-s', '/sales-returns', { invoiceId: inv.id, lines: [{ invoiceLineId: line.id, qty: String(int(1, Math.max(1, Math.floor(Number(line.qty))))) }] });
      },
      async purchaseReturn() {
        if (!purchaseInvoices.length) return;
        const pi = (await call('get', `/purchase-invoices/${pick(purchaseInvoices)}`)).body;
        if (!pi.lines?.length) return;
        const line = pick(pi.lines as { id: string; qty: string }[]);
        await tryPost('ret-p', '/purchase-returns', { invoiceId: pi.id, reason: 'Uji', lines: [{ invoiceLineId: line.id, qty: String(int(1, Math.max(1, Math.floor(Number(line.qty))))) }] });
      },
      async adjust() {
        const p = pick(products);
        const w = pick([wh1, wh2]);
        const have = await stockOf(p, w);
        if (rand() < 0.5 || have < 2) await tryPost('adj+', '/inventory/adjustments', { warehouseId: w, reason: pick(['OPENING', 'OTHER']), lines: [{ productId: p, qty: String(int(1, 20)), unitCost: String(int(3, 8) * 1000) }] });
        else await tryPost('adj-', '/inventory/adjustments', { warehouseId: w, reason: 'DAMAGED', lines: [{ productId: p, qty: String(-int(1, Math.floor(have))) }] });
      },
      async transfer() {
        const p = pick(products);
        const have = await stockOf(p, wh1);
        if (have < 1) return;
        const t = await tryPost('trf', '/inventory/transfers', { mode: pick(['DIRECT', 'IN_TRANSIT']), fromWarehouseId: wh1, toWarehouseId: wh2, lines: [{ productId: p, qty: String(int(1, Math.min(have, 10))) }] });
        if (t.status === 201 && t.body.status === 'IN_TRANSIT' && rand() < 0.8) await tryPost('trf-recv', `/inventory/transfers/${t.body.id}/receive`, {});
      },
      async pos() {
        if (!posSession) {
          const s = await tryPost('pos-open', '/pos/sessions', { warehouseId: wh1, openingCash: '100000' });
          if (s.status === 201) posSession = s.body.id;
          return;
        }
        if (rand() < 0.15) {
          await tryPost('pos-close', `/pos/sessions/${posSession}/close`, { countedCash: '0' });
          posSession = null;
          return;
        }
        const p = pick(products);
        const price = 8000 + products.indexOf(p) * 3000;
        const qty = int(1, 3);
        await tryPost('pos-order', '/pos/orders', { sessionId: posSession, lines: [{ productId: p, qty: String(qty) }], payments: [{ method: 'CASH', amount: String(Math.ceil(price * qty * 1.11) + 100000) }] });
      },
      async journal() {
        const amount = String(int(1, 500) * 1000);
        const j = await tryPost('jv', '/accounting/journals', { ...{ date: todayStr }, ...maybePast(), description: 'Beban uji', lines: [{ accountId: acc(pick(['6-4000', '6-6000', '6-7000'])), debit: amount }, { accountId: acc(pick(['1-1100', '1-1200'])), credit: amount }] });
        if (j.status === 201) journals.push(j.body.id);
      },
      async reverse() {
        if (!journals.length) return;
        await tryPost('jv-rev', `/accounting/journals/${journals.splice(int(0, journals.length - 1), 1)[0]}/reverse`, {});
      },
      async bill() {
        await tryPost('bill', '/purchase-invoices/bills', {
          supplierId: pick(suppliers),
          supplierInvoiceNo: `B-${seed}-${++seq}`,
          withholdingType: rand() < 0.5 ? 'PPH23' : undefined,
          withVat: rand() < 0.5,
          lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: acc('6-7200'), price: String(int(1, 20) * 100000) }],
        });
      },
      async asset() {
        const cat = pick(categories.filter((c) => c.name !== 'Tanah'));
        const a = await tryPost('asset', '/assets', { name: `Aset ${++seq}`, categoryId: cat.id, acquisitionDate: maybePast().date ?? todayStr, cost: String(int(2, 90) * 1000000), funding: 'CASH', cashAccountId: kas });
        if (a.status === 201) assetIds.push(a.body.id);
      },
      async cash() {
        const t = pick(['TRANSFER', 'IN', 'OUT']);
        const amount = String(int(1, 300) * 1000);
        if (t === 'TRANSFER') await tryPost('cash', '/cash/transactions', { type: 'TRANSFER', cashAccountId: kas, toCashAccountId: bank, amount, description: 'Pindah' });
        else await tryPost('cash', '/cash/transactions', { type: t, cashAccountId: pick([kas, bank]), description: 'Kas uji', lines: [{ accountId: acc(t === 'IN' ? '3-1000' : '6-4000'), amount }] });
      },
      async opname() {
        const c = await tryPost('count', '/inventory/counts', { warehouseId: wh1 });
        if (c.status !== 201) return;
        await call('put', `/inventory/counts/${c.body.id}`, { lines: products.map((p) => ({ productId: p, countedQty: String(int(0, 60)) })) });
        await tryPost('count-post', `/inventory/counts/${c.body.id}/post`, {});
      },
    };
    Object.assign(ops, {
      async depreciate() {
        const month = String(int(1, 9)).padStart(2, '0');
        await tryPost('depr', '/assets/depreciation/run', { period: `${rand() < 0.5 ? thisYear - 1 : thisYear}-${month}` });
      },
      async disposeAsset() {
        if (!assetIds.length) return;
        const id = assetIds.splice(int(0, assetIds.length - 1), 1)[0];
        await tryPost('dispose', `/assets/${id}/dispose`, { date: todayStr, price: String(int(0, 40) * 1000000), cashAccountId: kas });
      },
      async production() {
        if (!boms) {
          const b = await tryPost('bom', '/production/boms', { name: `Resep ${seed}`, productId: products[2], outputQty: '5', laborCost: '20000', overheadCost: '10000', lines: [{ productId: products[0], qty: '4' }, { productId: products[1], qty: '2' }] });
          if (b.status === 201) boms = b.body.id;
          return;
        }
        const o = await tryPost('prod-order', '/production/orders', { bomId: boms, warehouseId: wh1, batches: String(int(1, 3)), date: todayStr });
        if (o.status !== 201) return;
        const st = await tryPost('prod-start', `/production/orders/${o.body.id}/start`, { date: todayStr });
        if (st.status !== 201) return;
        if (rand() < 0.85) await tryPost('prod-done', `/production/orders/${o.body.id}/complete`, { date: todayStr, outputQty: String(Math.max(1, Math.floor(Number(o.body.plannedQty) * (0.8 + rand() * 0.2)))) });
        else await tryPost('prod-cancel', `/production/orders/${o.body.id}/cancel`, {});
      },
      async payroll() {
        if (employee.status >= 300) return;
        const period = `${thisYear - 1}-${String(int(1, 12)).padStart(2, '0')}`;
        if (payrollPeriods.has(period)) return;
        const r = await tryPost('payroll', '/payroll/runs', { period });
        if (r.status !== 201) return;
        payrollPeriods.add(period);
        const posted = await tryPost('payroll-post', `/payroll/runs/${r.body.id}/post`, {});
        if (posted.status === 201 && rand() < 0.7) await tryPost('payroll-pay', `/payroll/runs/${r.body.id}/pay`, { date: todayStr });
      },
      async taxPayment() {
        const type = pick(['PPH21', 'PPH23', 'PPN', 'BPJS']);
        const period = `${thisYear - 1}-${String(int(1, 12)).padStart(2, '0')}`;
        await tryPost('tax-pay', '/tax/payments', { type, period, date: todayStr });
      },
    });
    const weighted: [string, number][] = [['buy', 6], ['receiveThenBill', 5], ['sell', 10], ['deliverThenInvoice', 6], ['payAR', 7], ['payAP', 5], ['salesReturn', 4], ['purchaseReturn', 3], ['adjust', 4], ['transfer', 3], ['pos', 6], ['journal', 3], ['reverse', 1], ['bill', 2], ['asset', 1], ['cash', 3], ['opname', 1], ['depreciate', 2], ['disposeAsset', 1], ['production', 4], ['payroll', 2], ['taxPayment', 2]];
    const bag = weighted.flatMap(([k, w]) => Array(w).fill(k) as string[]);

    // bekal awal agar ada dokumen untuk dibayar/diretur
    for (const k of ['buy', 'buy', 'sell', 'sell']) await ops[k]();
    await checkInvariants('awal');

    for (let i = 1; i <= STEPS; i++) {
      const name = pick(bag);
      await ops[name]();
      await checkInvariants(`langkah ${i} (${name})`);
    }

    // ---- tutup buku tahun lalu: laba rugi tahun itu ternol, laporan tetap terbaca, neraca tetap seimbang ----
    const lastYear = thisYear - 1;
    const pnl = async (excludeClosing: boolean) =>
      Number((await q(`SELECT COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END * CASE WHEN a.type='REVENUE' THEN 1 ELSE -1 END),0) AS v FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.tenant_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND j.date BETWEEN $2 AND $3 ${excludeClosing ? "AND j.source_type<>'CLOSING'" : ''}`, [tenantId, `${lastYear}-01-01`, `${lastYear}-12-31`]))[0].v);
    const profitBefore = await pnl(true);
    const closed = await call('post', '/accounting/period/close-year', { year: lastYear });
    byLabel['tutup-buku'] = [closed.status === 201 ? 1 : 0, closed.status === 201 ? 0 : 1];
    if (closed.status === 201) {
      expect(await pnl(false)).toBeCloseTo(0, 2); // semua akun sementara tahun lalu nol
      expect(Number(closed.body.netIncome)).toBeCloseTo(profitBefore, 2);
      const again = await call('post', '/accounting/period/close-year', { year: lastYear });
      expect(again.status).toBe(400); // tidak boleh ditutup dua kali
      // laporan tahun yang sudah ditutup tetap terbaca utuh (jurnal penutup diabaikan) dan neraca akhir tahun seimbang
      const inc = (await call('get', `/accounting/statements/income?from=${lastYear}-01-01&to=${lastYear}-12-31`)).body;
      expect(Number(inc.lines.find((l: { key: string }) => l.key === 'NET_PROFIT').amount)).toBeCloseTo(profitBefore, 2);
      const fpEnd = (await call('get', `/accounting/statements/financial-position?asOf=${lastYear}-12-31`)).body;
      expect(fpEnd.balanced).toBe(true);
      await checkInvariants('setelah tutup buku');
    } else {
      // hanya boleh ditolak karena tidak ada saldo pendapatan/beban di tahun itu (tidak ada dokumen bertanggal mundur terpilih)
      expect({ status: closed.status, message: closed.body.message }).toEqual({ status: 400, message: expect.stringMatching(/Tidak ada saldo pendapatan\/beban/) });
    }

    // ---- pemeriksaan akhir lewat API ----
    const tb = (await call('get', '/accounting/reports/trial-balance')).body;
    expect(tb.balanced).toBe(true);
    const fp = (await call('get', '/accounting/statements/financial-position')).body;
    expect(fp.balanced).toBe(true);
    const health = (await call('get', '/accounting/health')).body as { checks: { key: string; status: string; message: string }[] };
    const errors = health.checks.filter((c) => c.status === 'ERROR');
    expect({ seed, healthErrors: errors }).toEqual({ seed, healthErrors: [] });
    if (process.env.FUZZ_WHY) console.log('ALASAN PENOLAKAN\n' + Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}× ${k}`).join('\n'));
    expect(stats.ok).toBeGreaterThan(STEPS / 4); // sebagian besar operasi benar-benar berjalan, bukan ditolak semua
    // eslint-disable-next-line no-console
    console.log(`benih ${seed}: ${stats.ok} operasi berhasil, ${stats.rejected} ditolak bisnis · ${Object.entries(byLabel).map(([k, [a, b]]) => `${k} ${a}/${a + b}`).join(' ')}`);
  }, 240_000);
});
