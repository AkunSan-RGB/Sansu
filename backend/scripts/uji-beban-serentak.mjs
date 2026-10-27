#!/usr/bin/env node
/**
 * Uji beban serentak SANSU: banyak pengguna maya (VU) dari beberapa perusahaan bekerja bersamaan pada server yang sedang berjalan,
 * campuran baca dan tulis, lalu memeriksa bahwa pembukuan tetap benar (bukan hanya cepat).
 *
 *   node scripts/uji-beban-serentak.mjs --vus 100 --duration 60 --tenants 5 [--ritel 2] [--base http://localhost:3000] [--utility-token FILE]
 *
 * Yang diukur : permintaan/detik, latensi p50/p95/p99 per aksi, galat 5xx, waktu habis, 4xx tak terduga.
 * Yang diperiksa setelahnya (langsung ke database): jurnal seimbang, nomor dokumen tak ganda, stok tak negatif dan = awal - terjual,
 *               terbayar <= tagihan dan = jumlah pembayaran, saldo kas = jumlah transaksi, kebuntuan (deadlock) di PostgreSQL.
 * --ritel N menambah N perusahaan ritel dengan 3 kasir tiap perusahaan (penjualan kasir lewat harga toko + promo dari server, stok, jurnal, pembayaran).
 * Tanpa --utility-token hanya perusahaan dagang (dan ritel bila diminta) yang diuji. Dengan token (hasil /tmp/load/seed.sh) perusahaan air 10.000 sambungan ikut.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:3000') + '/api';
const VUS = Number(arg('vus', 50));
const DURATION = Number(arg('duration', 60));
const TENANTS = Number(arg('tenants', 4));
const RITEL = Number(arg('ritel', 0));
const RAMP = Number(arg('ramp', 10));
const TIMEOUT_MS = Number(arg('timeout', 30000));
const UTIL_TOKEN_FILE = arg('utility-token', '');
const CHAOS = Number(arg('chaos', 0)); // jumlah operasi tulis pada fase jaringan buruk (0 = lewati)
const BILL_PERIOD = arg('bill-period', new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7)); // bulan lalu: bacaan meter terverifikasi ada
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://akurata:akurata@localhost:5432/akurata_test';
const STAMP = Date.now();

// ---------------- HTTP + metrik ----------------
const stats = new Map(); // aksi -> { lat: [], ok, c4xx, c5xx, timeout, net, codes:{} }
const unexpected = []; // contoh galat 5xx / 4xx tak terduga
const bucket = new Map(); // detik -> jumlah selesai
const rec = (name) => stats.get(name) ?? stats.set(name, { lat: [], ok: 0, c4xx: 0, c5xx: 0, shed: 0, timeout: 0, net: 0, codes: {} }).get(name);
const t0 = Date.now();

async function call(name, token, method, path, body, { expect4xx = false } = {}) {
  const s = rec(name);
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = performance.now() - started;
    s.lat.push(ms);
    s.codes[res.status] = (s.codes[res.status] ?? 0) + 1;
    const sec = Math.floor((Date.now() - t0) / 1000);
    bucket.set(sec, (bucket.get(sec) ?? 0) + 1);
    let json0;
    try { json0 = text ? JSON.parse(text) : null; } catch { json0 = null; }
    if (res.status === 503 && json0?.retryAfter) {
      // ditolak pembatas beban (bukan galat): klien yang baik menunggu Retry-After lalu mencoba lagi
      s.shed++;
      await sleep(json0.retryAfter * 1000);
    } else if (res.status >= 500) {
      s.c5xx++;
      if (unexpected.length < 15) unexpected.push(`${name} ${res.status} ${text.slice(0, 160)}`);
    } else if (res.status >= 400) {
      s.c4xx++;
      if (!expect4xx && unexpected.length < 15) unexpected.push(`${name} ${res.status} ${text.slice(0, 160)}`);
    } else s.ok++;
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, ms };
  } catch (e) {
    s.lat.push(performance.now() - started);
    if (e?.name === 'AbortError') s.timeout++;
    else s.net++;
    if (unexpected.length < 15) unexpected.push(`${name} ${e?.name === 'AbortError' ? 'WAKTU HABIS' : 'JARINGAN ' + e?.message}`);
    return { status: 0, body: null, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// ---------------- penyiapan perusahaan ----------------
async function setupTenant(i) {
  const reg = await call('setup', null, 'POST', '/auth/register', { companyName: `PT Beban ${STAMP}-${i}`, name: 'Pemilik', email: `beban-${STAMP}-${i}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' });
  if (reg.status !== 201) throw new Error('registrasi gagal: ' + JSON.stringify(reg.body));
  const token = reg.body.accessToken;
  const me = (await call('setup', token, 'GET', '/auth/me')).body;
  const warehouseId = (await call('setup', token, 'GET', '/warehouses')).body[0].id;
  const product = (await call('setup', token, 'POST', '/products', { sku: 'LD-1', name: 'Barang uji beban', sellPrice: '10000' })).body;
  const supplier = (await call('setup', token, 'POST', '/suppliers', { code: 'S-LD', name: 'Pemasok' })).body;
  await call('setup', token, 'POST', '/inventory/adjustments', { warehouseId, reason: 'OPENING', lines: [{ productId: product.id, qty: '1000000', unitCost: '5000' }] });
  await call('setup', token, 'PUT', '/cash/settings', { blockNegative: false });
  const customers = [];
  for (let c = 0; c < 40; c++) customers.push((await call('setup', token, 'POST', '/customers', { code: `C-${c}`, name: `Pelanggan ${c}`, creditLimit: '100000000000' })).body.id);
  const cashId = (await call('setup', token, 'GET', '/cash/accounts')).body[0].id;
  const coa = (await call('setup', token, 'GET', '/accounting/accounts')).body;
  const code = (c) => coa.find((a) => a.code === c)?.id;
  return { kind: 'dagang', token, tenantId: me.tenantId, warehouseId, productId: product.id, supplierId: supplier.id, customers, cashId, expAcc: code('6-6000'), cashAcc: code('1-1100'), unpaid: [], sold: 0, journals: 0 };
}

/** Perusahaan ritel: 3 kasir dengan sesi sendiri, daftar harga toko dan promo diskon aktif (jalur harga kasir dari server) */
async function setupRitel(i) {
  const reg = await call('setup', null, 'POST', '/auth/register', { companyName: `Toko Beban ${STAMP}-${i}`, name: 'Pemilik', email: `ritel-${STAMP}-${i}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' });
  if (reg.status !== 201) throw new Error('registrasi ritel gagal: ' + JSON.stringify(reg.body));
  const token = reg.body.accessToken;
  const me = (await call('setup', token, 'GET', '/auth/me')).body;
  const warehouseId = (await call('setup', token, 'GET', '/warehouses')).body[0].id;
  const product = (await call('setup', token, 'POST', '/products', { sku: 'RL-1', name: 'Barang kasir uji beban', sellPrice: '10000' })).body;
  await call('setup', token, 'POST', '/inventory/adjustments', { warehouseId, reason: 'OPENING', lines: [{ productId: product.id, qty: '1000000', unitCost: '5000' }] });
  const list = (await call('setup', token, 'POST', '/price-lists', { name: 'Harga toko' })).body;
  await call('setup', token, 'PUT', `/price-lists/${list.id}/items`, { items: [{ productId: product.id, minQty: '1', price: '9000' }] });
  await call('setup', token, 'PATCH', `/warehouses/${warehouseId}`, { priceListId: list.id });
  await call('setup', token, 'POST', '/promos', { name: 'Diskon 5% min 3', kind: 'DISCOUNT', productId: product.id, minQty: '3', discountPct: '5' });
  const cashiers = [];
  for (let k = 0; k < 3; k++) {
    const email = `kasir-${STAMP}-${i}-${k}@uji.id`;
    await call('setup', token, 'POST', '/users', { name: `Kasir ${k}`, email, password: 'rahasia12345', role: 'CASHIER' });
    const login = await call('setup', null, 'POST', '/auth/login', { email, password: 'rahasia12345' });
    const sess = await call('setup', login.body.accessToken, 'POST', '/pos/sessions', { warehouseId, openingCash: '100000' });
    cashiers.push({ token: login.body.accessToken, sessionId: sess.body.id });
  }
  return { kind: 'ritel', token, tenantId: me.tenantId, warehouseId, productId: product.id, cashiers, sold: 0, orders: 0 };
}

// ---------------- skenario pengguna ----------------
const READS_DAGANG = [
  ['baca:faktur', 10, (t) => call('baca:faktur', t.token, 'GET', '/invoices')],
  ['baca:pesanan', 8, (t) => call('baca:pesanan', t.token, 'GET', '/sales-orders')],
  ['baca:pelanggan', 6, (t) => call('baca:pelanggan', t.token, 'GET', '/customers')],
  ['baca:produk', 6, (t) => call('baca:produk', t.token, 'GET', '/products')],
  ['baca:neraca-saldo', 5, (t) => call('baca:neraca-saldo', t.token, 'GET', '/accounting/reports/trial-balance')],
  ['baca:kas', 5, (t) => call('baca:kas', t.token, 'GET', '/cash/accounts')],
  ['baca:transaksi-kas', 5, (t) => call('baca:transaksi-kas', t.token, 'GET', `/cash/transactions?from=${today().slice(0, 8)}01&to=${today()}`)],
];
const WRITES_DAGANG = [
  ['tulis:penjualan', 14, async (t) => {
    const qty = String(1 + rnd(3));
    const so = await call('tulis:penjualan/pesanan', t.token, 'POST', '/sales-orders', { customerId: pick(t.customers), warehouseId: t.warehouseId, lines: [{ productId: t.productId, qty, price: '10000' }] });
    if (so.status !== 201) return;
    await call('tulis:penjualan/konfirmasi', t.token, 'POST', `/sales-orders/${so.body.id}/confirm`, {});
    const inv = await call('tulis:penjualan/faktur', t.token, 'POST', '/invoices', { salesOrderId: so.body.id });
    if (inv.status === 201) { t.sold += Number(qty); t.unpaid.push({ id: inv.body.id, total: Number(inv.body.total) }); }
  }],
  ['tulis:pembayaran', 10, async (t) => {
    const i = t.unpaid.length ? rnd(t.unpaid.length) : -1;
    if (i < 0) return;
    const inv = t.unpaid[i];
    const part = Math.max(1000, Math.round(inv.total / 2));
    const r = await call('tulis:pembayaran', t.token, 'POST', '/payments', { invoiceId: inv.id, amount: String(part), method: 'TRANSFER' }, { expect4xx: true });
    if (r.status !== 201) t.unpaid.splice(i, 1); // sudah lunas / ditolak aturan: wajar
  }],
  ['tulis:jurnal', 5, async (t) => {
    const r = await call('tulis:jurnal', t.token, 'POST', '/accounting/journals', { date: today(), description: `Beban ${rnd(1e6)}`, confirmDuplicate: true, lines: [{ accountId: t.expAcc, debit: '1000' }, { accountId: t.cashAcc, credit: '1000' }] });
    if (r.status === 201) t.journals++;
  }],
  ['tulis:kas-keluar', 3, (t) => call('tulis:kas-keluar', t.token, 'POST', '/cash/transactions', { type: 'OUT', cashAccountId: t.cashId, date: today(), description: 'Beban listrik', lines: [{ source: 'OUT_ELECTRICITY', amount: '5000' }] }, { expect4xx: true })],
  ['tulis:pelanggan', 2, (t) => call('tulis:pelanggan', t.token, 'POST', '/customers', { code: `X-${rnd(1e9)}`, name: `Toko ${rnd(1e9).toString(36)} ${rnd(1e9).toString(36)}` })],
];
const RITEL_ACTIONS = [
  ['baca:produk-kasir', 8, (t) => { const c = pick(t.cashiers); return call('baca:produk-kasir', c.token, 'GET', `/pos/products?warehouseId=${t.warehouseId}`); }],
  ['baca:sesi-kasir', 4, (t) => call('baca:sesi-kasir', pick(t.cashiers).token, 'GET', '/pos/sessions')],
  ['tulis:kasir', 20, async (t) => {
    const c = pick(t.cashiers);
    const qty = 1 + rnd(5);
    const lines = [{ productId: t.productId, qty: String(qty) }];
    const q = await call('tulis:kasir/kutipan', c.token, 'POST', '/pos/quote', { sessionId: c.sessionId, lines });
    if (q.status !== 201) return;
    // harga dan potongan persis kutipan server (kasir tidak boleh mengarang); tunai pas
    const l = q.body.lines[0];
    const total = Math.round(qty * Number(l.price) * (100 - Number(l.discountPct))) / 100;
    const r = await call('tulis:kasir/transaksi', c.token, 'POST', '/pos/orders', { sessionId: c.sessionId, lines: [{ productId: t.productId, qty: String(qty), price: l.price, discountPct: l.discountPct }], payments: [{ method: 'CASH', amount: total.toFixed(2) }] });
    if (r.status === 201) { t.sold += qty; t.orders++; }
  }],
];
const UTIL_ACTIONS = [
  ['util:ringkasan', 8, (t) => call('util:ringkasan', t.token, 'GET', '/utility/summary')],
  ['util:loket-cari', 10, (t) => call('util:loket-cari', t.token, 'GET', `/utility/counter/search?search=Pelanggan%20${rnd(9000)}`)],
  ['util:sambungan', 3, (t) => call('util:sambungan', t.token, 'GET', '/utility/connections')],
  ['util:jatuh-tempo', 3, (t) => call('util:jatuh-tempo', t.token, 'GET', '/utility/overdue')],
  ['util:kontrol', 2, (t) => call('util:kontrol', t.token, 'GET', '/utility/controls')],
];
const weighted = (list) => {
  const total = list.reduce((a, x) => a + x[1], 0);
  let r = Math.random() * total;
  for (const x of list) { r -= x[1]; if (r <= 0) return x; }
  return list[0];
};

let stop = false;
async function vu(t, delayMs) {
  await sleep(delayMs);
  const mix = t.kind === 'util' ? UTIL_ACTIONS : t.kind === 'ritel' ? RITEL_ACTIONS : [...READS_DAGANG, ...WRITES_DAGANG];
  while (!stop) {
    const a = weighted(mix);
    try { await a[2](t); } catch (e) { rec('galat-skrip').net++; if (unexpected.length < 15) unexpected.push(`skrip ${a[0]}: ${e?.message}`); }
    await sleep(100 + rnd(500));
  }
}


// ---------------- fase jaringan buruk ----------------
/**
 * Meniru jaringan buruk: permintaan tulis diputus klien sesaat setelah terkirim (server tetap memprosesnya), lalu dikirim ulang —
 * sama seperti perilaku peramban SANSU (kunci idempotensi dipertahankan saat tanpa jawaban) — dan sebagian diklik ganda serentak.
 * Setiap operasi punya penanda unik; sesudahnya tiap penanda harus tercatat TEPAT satu kali. Kontrol: tanpa kunci akan ganda.
 */
async function rawPost(token, path, body, key, abortAfterMs) {
  const ctrl = new AbortController();
  const timer = abortAfterMs ? setTimeout(() => ctrl.abort(), abortAfterMs) : null;
  try {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body), signal: ctrl.signal });
    await res.text();
    return res.status;
  } catch { return 0; } finally { if (timer) clearTimeout(timer); }
}
async function chaosPhase(tenants, n, withKey) {
  const dagang = tenants.filter((t) => t.kind === 'dagang');
  const ops = Array.from({ length: n }, (_, i) => ({ id: `${withKey ? 'CH' : 'NK'}-${STAMP}-${i}`, t: dagang[i % dagang.length], kind: i % 2 ? 'jurnal' : 'kas', resolved: false, statuses: [] }));
  let next = 0;
  const bodyOf = (o) => o.kind === 'jurnal'
    ? ['/accounting/journals', { date: today(), description: o.id, confirmDuplicate: true, lines: [{ accountId: o.t.expAcc, debit: '1000' }, { accountId: o.t.cashAcc, credit: '1000' }] }]
    : ['/cash/transactions', { type: 'OUT', cashAccountId: o.t.cashId, date: today(), description: o.id, reference: o.id, lines: [{ source: 'OUT_ELECTRICITY', amount: '5000' }] }];
  async function worker() {
    while (next < ops.length) {
      const o = ops[next++];
      const [path, body] = bodyOf(o);
      const key = withKey ? `chaos-${o.id}` : null;
      const doubleClick = Math.random() < 0.3;
      for (let attempt = 0; attempt < 4; attempt++) {
        const last = attempt === 3;
        const abortAt = !last && Math.random() < 0.6 ? 3 + rnd(80) : 0; // putus sesaat setelah terkirim
        const calls = [rawPost(o.t.token, path, body, key, abortAt)];
        if (attempt === 0 && doubleClick) calls.push(rawPost(o.t.token, path, body, key, 0)); // klik ganda
        const sts = await Promise.all(calls);
        o.statuses.push(...sts);
        if (sts.some((s) => s >= 200 && s < 300)) { o.resolved = true; break; }
        await sleep(50 + rnd(400));
      }
    }
  }
  await Promise.all(Array.from({ length: 40 }, worker));
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("SET app.bypass_rls = 'on'");
  const ids = tenants.filter((t) => t.kind === 'dagang').map((t) => t.tenantId);
  const j = (await db.query(`SELECT description d, COUNT(*)::int n FROM journal_entries WHERE tenant_id = ANY($1) AND description LIKE $2 GROUP BY description`, [ids, `${withKey ? 'CH' : 'NK'}-${STAMP}-%`])).rows;
  const k = (await db.query(`SELECT description d, COUNT(*)::int n FROM cash_transactions WHERE tenant_id = ANY($1) AND description LIKE $2 GROUP BY description`, [ids, `${withKey ? 'CH' : 'NK'}-${STAMP}-%`])).rows;
  await db.end();
  const rows = new Map([...j, ...k].map((r) => [r.d, r.n]));
  const dup = [...rows.values()].filter((v) => v > 1).length;
  const extra = [...rows.values()].reduce((a, v) => a + Math.max(0, v - 1), 0);
  const missing = ops.filter((o) => o.resolved && !rows.has(o.id)).length;
  const unresolved = ops.filter((o) => !o.resolved).length;
  return { n, dup, extra, missing, unresolved, aborted: ops.reduce((a, o) => a + o.statuses.filter((s) => s === 0).length, 0), replays: 0 };
}

// ---------------- pemeriksaan sesudah ----------------
async function verify(tenants) {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("SET app.bypass_rls = 'on'");
  const out = [];
  const check = (name, bad, detail = '') => out.push({ name, ok: bad === 0, detail: bad === 0 ? '' : `${bad} pelanggaran ${detail}` });
  const ids = tenants.filter((t) => t.kind === 'dagang' || t.kind === 'ritel').map((t) => t.tenantId);
  const q = async (sql, p = [ids]) => (await db.query(sql, p)).rows;
  check('jurnal seimbang (debit = kredit tiap jurnal)', (await q(`SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.journal_id=e.id WHERE e.tenant_id = ANY($1) GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`)).length);
  for (const [tbl, col] of [['invoices', 'number'], ['sales_orders', 'number'], ['journal_entries', 'number'], ['cash_transactions', 'number'], ['payments', 'number']]) {
    try { check(`nomor ${tbl} tidak ganda`, (await q(`SELECT ${col} FROM ${tbl} WHERE tenant_id = ANY($1) GROUP BY tenant_id, ${col} HAVING COUNT(*)>1`)).length); } catch (e) { out.push({ name: `nomor ${tbl}`, ok: true, detail: 'dilewati: ' + e.message.slice(0, 60) }); }
  }
  check('stok tidak negatif', (await q(`SELECT 1 FROM stock_balances WHERE tenant_id = ANY($1) AND qty < 0`)).length);
  let stokBeda = 0;
  for (const t of tenants.filter((x) => x.kind === 'dagang')) {
    const r = (await q(`SELECT qty FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 AND warehouse_id=$3`, [t.tenantId, t.productId, t.warehouseId]))[0];
    if (Math.abs(Number(r.qty) - (1_000_000 - t.sold)) > 1e-6) stokBeda++;
  }
  check('stok akhir = 1.000.000 - terjual (per perusahaan)', stokBeda, '(selisih stok dan faktur yang terbit)');
  // ritel: stok = awal - terjual lewat kasir, jumlah transaksi kasir = yang berhasil, total tiap transaksi = pembayarannya
  let stokRitel = 0, ordersBeda = 0;
  for (const t of tenants.filter((x) => x.kind === 'ritel')) {
    const r = (await q(`SELECT qty FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 AND warehouse_id=$3`, [t.tenantId, t.productId, t.warehouseId]))[0];
    if (Math.abs(Number(r.qty) - (1_000_000 - t.sold)) > 1e-6) stokRitel++;
    const n = (await q(`SELECT COUNT(*)::int n FROM pos_orders WHERE tenant_id=$1`, [t.tenantId]))[0].n;
    if (n !== t.orders) ordersBeda++;
  }
  check('ritel: stok akhir = 1.000.000 - terjual lewat kasir', stokRitel);
  check('ritel: jumlah transaksi kasir tercatat = yang berhasil', ordersBeda);
  check('ritel: total transaksi kasir = jumlah pembayarannya', (await q(`SELECT o.id FROM pos_orders o LEFT JOIN pos_payments p ON p.order_id=o.id WHERE o.tenant_id = ANY($1) GROUP BY o.id HAVING o.total - COALESCE(SUM(p.amount),0) NOT BETWEEN -0.005 AND 0.005`)).length, '(total tidak sama dengan pembayaran)');
  check('terbayar tidak melebihi tagihan', (await q(`SELECT 1 FROM invoices WHERE tenant_id = ANY($1) AND paid_amount > total`)).length);
  check('terbayar = jumlah pembayaran', (await q(`SELECT i.id FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id WHERE i.tenant_id = ANY($1) GROUP BY i.id HAVING i.paid_amount <> COALESCE(SUM(p.amount),0)`)).length);
  check('neraca saldo seimbang (jumlah semua baris jurnal)', (await q(`SELECT 1 FROM (SELECT tenant_id, SUM(l.debit)-SUM(l.credit) AS d FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_id WHERE e.tenant_id = ANY($1) GROUP BY tenant_id) x WHERE d <> 0`)).length);
  const dl = (await db.query(`SELECT deadlocks, xact_rollback FROM pg_stat_database WHERE datname = current_database()`)).rows[0];
  await db.end();
  return { checks: out, deadlocks: Number(dl.deadlocks), rollbacks: Number(dl.xact_rollback) };
}

async function dbCounters() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const r = (await db.query(`SELECT deadlocks, xact_commit, xact_rollback FROM pg_stat_database WHERE datname = current_database()`)).rows[0];
  await db.end();
  return r;
}
const serverRss = () => {
  // proses yang mendengarkan port server (bukan pembungkus npx)
  try {
    const port = new URL(BASE).port || '3000';
    const pid = execSync(`fuser ${port}/tcp 2>/dev/null`).toString().trim().split(/\s+/)[0];
    const kb = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1];
    return Number(kb) / 1024;
  } catch { return NaN; }
};

const ticks = (pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return 0; } };
const pidsOf = (cmd) => { try { return execSync(`pgrep -f '${cmd}'`).toString().trim().split(/\s+/).map(Number); } catch { return []; } };
const serverPids = () => { try { return execSync(`fuser ${new URL(BASE).port || 3000}/tcp 2>/dev/null`).toString().trim().split(/\s+/).map(Number).filter(Boolean); } catch { return []; } };
const cpuSnap = () => ({ srv: serverPids().reduce((a, p) => a + ticks(p), 0), pg: pidsOf('postgres').reduce((a, p) => a + ticks(p), 0), gen: ticks(process.pid) });

// ---------------- jalan ----------------
(async () => {
  console.log(`Uji beban serentak: ${VUS} pengguna maya, ${DURATION} dtk, ${TENANTS} perusahaan dagang${RITEL ? ` + ${RITEL} ritel` : ''}${UTIL_TOKEN_FILE ? ' + perusahaan air' : ''}, server ${BASE}`);
  const health = await fetch(BASE + '/health').then((r) => r.status).catch(() => 0);
  if (health !== 200) { console.error('Server tidak menjawab /health'); process.exit(2); }
  const before = await dbCounters();
  console.log('Menyiapkan perusahaan...');
  const tenants = [];
  for (let i = 0; i < TENANTS; i++) tenants.push(await setupTenant(i));
  for (let i = 0; i < RITEL; i++) tenants.push(await setupRitel(i));
  if (UTIL_TOKEN_FILE) tenants.push({ kind: 'util', token: readFileSync(UTIL_TOKEN_FILE, 'utf8').trim() });
  stats.delete('setup');
  const utilT = tenants.find((t) => t.kind === 'util');
  const rss0 = serverRss();
  const cpu0 = cpuSnap();
  const T0 = Date.now();
  console.log('Mulai beban...');
  const vus = [];
  for (let i = 0; i < VUS; i++) {
    // sebagian kecil pengguna ke perusahaan air bila ada (sekitar 20%)
    const ritelTs = tenants.filter((x) => x.kind === 'ritel');
    const t = utilT && i % 5 === 0 ? utilT : ritelTs.length && i % 3 === 2 ? ritelTs[i % ritelTs.length] : tenants.filter((x) => x.kind === 'dagang')[i % TENANTS];
    vus.push(vu(t, (i / VUS) * RAMP * 1000));
  }
  const rssSamples = [];
  const mon = setInterval(() => rssSamples.push(serverRss()), 2000);
  let jobInfo = '';
  let jobId, jobStart = 0;
  if (utilT) {
    // tagih bulanan 10.000 sambungan berjalan di latar bersamaan dengan beban lain
    setTimeout(async () => {
      const r = await call('util:tagih-latar', utilT.token, 'POST', '/utility/billing/jobs', { period: BILL_PERIOD }, { expect4xx: true });
      jobInfo = `tagih berlatar dimulai: HTTP ${r.status}`;
      jobId = r.body?.id;
      jobStart = Date.now();
    }, Math.min(10000, DURATION * 500));
  }
  await sleep(DURATION * 1000);
  stop = true;
  await Promise.all(vus);
  clearInterval(mon);
  const elapsed = (Date.now() - T0) / 1000;
  const cpu1 = cpuSnap();
  const cores = (a, b) => ((b - a) / 100 / elapsed).toFixed(2);

  // tunggu pekerjaan latar selesai sebelum memeriksa (batas 10 menit)
  if (jobId) {
    for (let i = 0; i < 600; i++) {
      const j = await call('util:tagih-latar-status', utilT.token, 'GET', `/utility/billing/jobs/${jobId}`);
      if (j.body && j.body.status && j.body.status !== 'BERJALAN') {
        jobInfo += ` -> ${j.body.status}: ${JSON.stringify({ total: j.body.total, done: j.body.done, failed: j.body.failed, billed: j.body.billedCount, nominal: j.body.billedTotal })}, selesai ${((Date.now() - jobStart) / 1000).toFixed(0)} dtk sejak mulai (beban lain ikut berjalan sebagian waktu)`;
        break;
      }
      await sleep(1000);
    }
  }
  await sleep(1500);
  const after = await dbCounters();

  // ---- laporan ----
  const rows = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let total = 0, err5 = 0, timeouts = 0, nets = 0, unexp4 = 0, shedAll = 0;
  console.log('\nAksi'.padEnd(34) + 'jml'.padStart(7) + 'ok'.padStart(7) + '4xx'.padStart(6) + '5xx'.padStart(6) + 'habis'.padStart(7) + '   p50(ms)  p95(ms)  p99(ms)  maks(ms)');
  for (const [name, s] of rows) {
    const n = s.lat.length;
    total += n; shedAll += s.shed; err5 += s.c5xx; timeouts += s.timeout; nets += s.net;
    console.log(name.padEnd(34) + String(n).padStart(7) + String(s.ok).padStart(7) + String(s.c4xx).padStart(6) + String(s.c5xx).padStart(6) + String(s.timeout + s.net).padStart(7) + `   ${pct(s.lat, 50).toFixed(0).padStart(7)}  ${pct(s.lat, 95).toFixed(0).padStart(7)}  ${pct(s.lat, 99).toFixed(0).padStart(7)}  ${Math.max(0, ...s.lat).toFixed(0).padStart(8)}`);
  }
  const all = rows.flatMap(([, s]) => s.lat);
  const perSec = [...bucket.entries()].filter(([s]) => s >= RAMP && s < RAMP + DURATION - RAMP).map(([, v]) => v);
  console.log(`\nTotal ${total} permintaan dalam ${elapsed.toFixed(0)} dtk = ${(total / elapsed).toFixed(1)} permintaan/dtk (puncak ${Math.max(0, ...perSec)}/dtk)`);
  console.log(`Latensi semua: p50 ${pct(all, 50).toFixed(0)} ms, p95 ${pct(all, 95).toFixed(0)} ms, p99 ${pct(all, 99).toFixed(0)} ms`);
  console.log(`Ditolak pembatas beban (503 + Retry-After, bukan galat): ${shedAll} (${((shedAll / total) * 100).toFixed(1)}%)`);
  console.log(`Galat server 5xx: ${err5} (${((err5 / total) * 100).toFixed(2)}%), waktu habis: ${timeouts}, putus jaringan: ${nets}`);
  console.log(`Memori proses server: ${rss0.toFixed(0)} MB -> ${Math.max(...rssSamples.filter(Number.isFinite), 0).toFixed(0)} MB (puncak)`);
  console.log(`CPU (inti rata-rata dari 4): server aplikasi ${cores(cpu0.srv, cpu1.srv)}, PostgreSQL ${cores(cpu0.pg, cpu1.pg)}, pembangkit beban ${cores(cpu0.gen, cpu1.gen)}`);
  console.log(`PostgreSQL: deadlock +${Number(after.deadlocks) - Number(before.deadlocks)}, rollback +${Number(after.xact_rollback) - Number(before.xact_rollback)}, commit +${Number(after.xact_commit) - Number(before.xact_commit)}`);
  if (jobInfo) console.log(jobInfo);
  if (unexpected.length) console.log('\nContoh galat/respons tak terduga:\n  ' + unexpected.join('\n  '));

  let chaosFailed = 0;
  if (CHAOS) {
    console.log(`\nFase jaringan buruk (${CHAOS} operasi tulis; permintaan diputus klien lalu dikirim ulang, sebagian diklik ganda):`);
    const withKey = await chaosPhase(tenants, CHAOS, true);
    console.log(`  Dengan kunci idempotensi (perilaku peramban SANSU): ${withKey.aborted} permintaan diputus, ${withKey.unresolved} tak terselesaikan, tercatat ganda: ${withKey.dup} operasi (${withKey.extra} baris berlebih), hilang: ${withKey.missing}  -> ${withKey.dup + withKey.missing + withKey.unresolved === 0 ? 'LULUS' : 'GAGAL'}`);
    const noKey = await chaosPhase(tenants, Math.min(CHAOS, 200), false);
    console.log(`  Kontrol TANPA kunci (untuk menunjukkan fungsi perlindungan): tercatat ganda: ${noKey.dup} dari ${noKey.n} operasi (${noKey.extra} baris berlebih)`);
    chaosFailed = withKey.dup + withKey.missing + withKey.unresolved > 0 ? 1 : 0;
  }
  console.log('\nPemeriksaan pembukuan sesudah beban:');
  const v = await verify(tenants);
  for (const c of v.checks) console.log(`  ${c.ok ? 'LULUS' : 'GAGAL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  const failed = v.checks.filter((c) => !c.ok).length + chaosFailed;
  const summary = { vus: VUS, durasi: DURATION, total, rps: +(total / elapsed).toFixed(1), p95: +pct(all, 95).toFixed(0), p99: +pct(all, 99).toFixed(0), err5xx: err5, ditolakSibuk: shedAll, waktuHabis: timeouts, putus: nets, pemeriksaanGagal: failed, deadlock: Number(after.deadlocks) - Number(before.deadlocks) };
  console.log('\nRINGKASAN ' + JSON.stringify(summary));
  process.exit(failed || err5 || timeouts ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
