/**
 * Lokasi rak tahap 3 dan 4 (e2e): opname per rak (koreksi tepat di rak), persetujuan pindah rak bernilai besar,
 * laporan kontrol rak, dan impor rak dari berkas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

type Row = { binId: string; binCode: string; productId: string; lotNo: string | null; lotId: string | null; qty: string };

describe('Lokasi rak tahap 3-4: opname per rak, persetujuan, kontrol, impor (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let owner: string;
  let wh: string;
  let W: string;
  let P: string;
  let Q: string;
  let sup: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}, t = owner) => http.post(u).set(as(t)).send(b);
  const put = (u: string, b: object, t = owner) => http.put(u).set(as(t)).send(b);
  const rows = async (pid?: string, binId?: string) => (await get(`/api/inventory/bins/stock?warehouseId=${W}${pid ? `&productId=${pid}` : ''}${binId ? `&binId=${binId}` : ''}`).expect(200)).body.rows as Row[];
  const sum = (rs: Row[]) => rs.reduce((a, r) => a + Number(r.qty), 0);
  const stock = async (pid: string) => Number((await get(`/api/inventory/balances?productId=${pid}&warehouseId=${W}`).expect(200)).body[0]?.qty ?? 0);
  const binId = async (code: string) => ((await get(`/api/inventory/bins?warehouseId=${W}`).expect(200)).body.bins as { id: string; code: string }[]).find((b) => b.code === code)!.id;
  const lotIn = async (pid: string, bin: string) => (await rows(pid, bin)).find((r) => r.lotId)!.lotId!;
  const check = async () => (await get(`/api/inventory/bins/check?warehouseId=${W}`).expect(200)).body;
  const receive = async (product: string, qty: string, extra: object = {}) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: W, date: today, lines: [{ productId: product, qty, price: '1000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return post(`/api/purchase-orders/${po.id}/receipts`, { date: today, lines: [{ orderLineId: po.lines[0].id, qty, ...extra }] }).expect(201);
  };
  const countOf = async (binCode: string, counted: Record<string, string>, expectPost = 201) => {
    const c = (await post('/api/inventory/counts', { warehouseId: W, binId: await binId(binCode), date: today }).expect(201)).body;
    const d = (await get(`/api/inventory/counts/${c.id}`).expect(200)).body;
    await put(`/api/inventory/counts/${c.id}`, { lines: d.lines.map((l: { productId: string }) => ({ productId: l.productId, countedQty: counted[l.productId] ?? null })) }).expect(200);
    const r = await post(`/api/inventory/counts/${c.id}/post`);
    expect(r.status).toBe(expectPost);
    return { id: c.id as string, detail: d, res: r.body };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Opname Rak', name: 'Pemilik', email: `opr-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'Gudang', email: `opr-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    wh = (await http.post('/api/auth/login').send({ email: `opr-g-${stamp}@uji.id`, password: 'gudang12345' }).expect(200)).body.accessToken;
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'OP-1', name: 'Sirup', sellPrice: '20000', category: 'Lain-lain' }).expect(201)).body.id;
    Q = (await post('/api/products', { sku: 'OP-2', name: 'Teh Kotak', sellPrice: '9000', category: 'Lain-lain' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'S-OP', name: 'Pemasok' }).expect(201)).body.id;
    await post('/api/inventory/bins/activate', { warehouseId: W }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W, codes: ['A-01', 'A-02', 'B-01'], zone: 'Z1' }).expect(201);
    const a1 = await binId('A-01');
    await receive(P, '30', { binId: a1, lotNo: 'S-1', expiryDate: addDays(today, 90) });
    const adjR = await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: P, qty: '10', unitCost: '1000', binId: a1 }, { productId: Q, qty: '20', unitCost: '500', binId: a1 }] }); if (adjR.status !== 201) throw new Error(JSON.stringify(adjR.body));
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('opname per rak: lembar hanya berisi isi rak, rak kosong ditolak, satu opname berjalan per cakupan', async () => {
    const a1 = await binId('A-01');
    await post('/api/inventory/counts', { warehouseId: W, binId: await binId('B-01'), date: today }).expect(400); // rak kosong
    const c = (await post('/api/inventory/counts', { warehouseId: W, binId: a1, date: today }).expect(201)).body;
    expect(c.lines).toBe(2);
    await post('/api/inventory/counts', { warehouseId: W, binId: a1, date: today }).expect(400); // rak yang sama masih berjalan
    await post('/api/inventory/counts', { warehouseId: W, date: today }).expect(400); // opname gudang diblokir oleh opname rak yang berjalan
    const d = (await get(`/api/inventory/counts/${c.id}`).expect(200)).body;
    expect(d.binCode).toBe('A-01');
    expect(d.lines.find((l: { sku: string }) => l.sku === 'OP-1').systemQty).toBe('40.0000');
    expect((await get(`/api/inventory/counts?warehouseId=${W}`).expect(200)).body.find((x: { id: string }) => x.id === c.id).binCode).toBe('A-01');
    await post(`/api/inventory/counts/${c.id}/cancel`).expect(201);
  });

  it('opname per rak: kurang dikurangi tepat dari rak itu (tanpa lot dulu, lalu lot); lebih masuk ke rak itu; rak lain tidak tersentuh', async () => {
    const a1 = await binId('A-01');
    const a2 = await binId('A-02');
    // sebagian OP-1 lot S-1 dipindah ke A-02 supaya kita bisa memastikan A-02 tidak tersentuh
    const lot = (await rows(P, a1)).find((r) => r.lotNo === 'S-1')!;
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: P, lotId: lot.lotId, fromBinId: a1, toBinId: a2, qty: '10' }] }).expect(201);
    // A-01: OP-1 = lot 20 + tanpa lot 10; OP-2 = 20. Hitung: OP-1 = 25 (−5), OP-2 = 23 (+3)
    const r1 = await countOf('A-01', { [P]: '25', [Q]: '23' });
    expect(r1.res.adjustmentNumber).toBeTruthy();
    const inA1 = await rows(P, a1);
    expect(sum(inA1)).toBe(25);
    expect(inA1.find((r) => r.lotNo === null)!.qty).toBe('5.0000'); // yang tanpa lot terpakai lebih dulu
    expect(inA1.find((r) => r.lotNo === 'S-1')!.qty).toBe('20.0000');
    expect(sum(await rows(Q, a1))).toBe(23);
    expect(sum(await rows(P, a2))).toBe(10); // rak lain tidak tersentuh
    expect(await stock(P)).toBe(35);
    expect(await stock(Q)).toBe(23);
    expect((await check()).ok).toBe(true);
    // kurang lebih dalam: OP-1 = 12 → kurangi 13: tanpa lot 5 habis, lot S-1 berkurang 8
    await countOf('A-01', { [P]: '12', [Q]: '23' });
    const after = await rows(P, a1);
    expect(sum(after)).toBe(12);
    expect(after.some((r) => r.lotNo === null)).toBe(false);
    expect(after.find((r) => r.lotNo === 'S-1')!.qty).toBe('12.0000');
    expect(await stock(P)).toBe(22);
    expect((await check()).ok).toBe(true);
    // jurnal selisih persediaan seimbang
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
  });

  it('pindah rak bernilai besar oleh Gudang menunggu persetujuan; kecil langsung jalan; Pemilik tidak perlu', async () => {
    await put('/api/approvals/policy', { stockAdjustment: 20_000 }).expect(200);
    const a1 = await binId('A-01');
    const b1 = await binId('B-01');
    // nilai: 12 × Rp1.000 = Rp12.000 (< Rp20.000) → langsung
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: P, lotId: await lotIn(P, a1), fromBinId: a1, toBinId: b1, qty: '3' }] }, wh).expect(201);
    // nilai: 23 × Rp500 = 11.500 + OP-1 9 × 1.000 = 9.000 → 20.500 ≥ 20.000 → minta persetujuan
    const lines = [{ productId: Q, fromBinId: a1, toBinId: b1, qty: '23' }, { productId: P, lotId: (await rows(P, a1)).find((r) => r.lotNo === 'S-1')!.lotId, fromBinId: a1, toBinId: b1, qty: '9' }];
    const req = await post('/api/inventory/bins/move', { warehouseId: W, lines }, wh);
    expect(req.status).toBe(409);
    expect(req.body.code).toBe('APPROVAL_REQUIRED');
    expect(sum(await rows(Q, a1))).toBe(23); // belum berpindah
    await post(`/api/approvals/${req.body.requestId}/approve`, {}).expect(201);
    expect(sum(await rows(Q, b1))).toBe(23);
    expect(sum(await rows(Q, a1))).toBe(0);
    expect((await check()).ok).toBe(true);
    // Pemilik tidak diminta persetujuan
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: Q, fromBinId: b1, toBinId: a1, qty: '23' }] }).expect(201);
    await put('/api/approvals/policy', { stockAdjustment: 0 }).expect(200);
  });

  it('laporan kontrol rak: barang lama belum ditata, rusak menumpuk, selisih opname berulang, dan masuk ke Kontrol persediaan', async () => {
    const un = await binId('BELUM-DITEMPATKAN');
    await post('/api/inventory/bins', { warehouseId: W, codes: ['RSK-9'], kind: 'DAMAGED' }).expect(201);
    const rsk = await binId('RSK-9');
    await receive(Q, '8'); // masuk BELUM-DITEMPATKAN
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: P, lotId: await lotIn(P, await binId('B-01')), fromBinId: await binId('B-01'), toBinId: rsk, qty: '3' }] }).expect(201);
    // tua-kan riwayat masuk (hanya INSERT yang diizinkan; riwayat tidak bisa diubah) supaya melewati batas hari
    const cx = await pool.connect();
    try {
      await cx.query("SELECT set_config('app.bypass_rls', 'on', false)");
      const t = (await cx.query('SELECT tenant_id FROM warehouses WHERE id = $1', [W])).rows[0].tenant_id;
      await cx.query("INSERT INTO bin_moves (tenant_id, warehouse_id, product_id, to_bin_id, qty, kind, created_at) VALUES ($1,$2,$3,$4,1,'RECEIVE', now() - interval '12 days')", [t, W, Q, un]);
      await cx.query("INSERT INTO bin_moves (tenant_id, warehouse_id, product_id, to_bin_id, qty, kind, created_at) VALUES ($1,$2,$3,$4,1,'RECEIVE', now() - interval '45 days')", [t, W, P, rsk]);
    } finally {
      cx.release();
    }
    // opname rak A-02 dua kali dengan selisih
    const first = await countOf('A-02', { [P]: '9' });
    expect(first.res.adjusted).toBe(1);
    await post('/api/inventory/bins/move', { warehouseId: W, lines: [{ productId: P, lotId: await lotIn(P, await binId('B-01')), fromBinId: await binId('B-01'), toBinId: await binId('A-02'), qty: '1' }] }).expect(201);
    await countOf('A-02', { [P]: '5' });
    const f = (await get(`/api/inventory/bins/controls?warehouseId=${W}`).expect(200)).body as { key: string; level: string; refs: string[] }[];
    const keys = f.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['BIN_UNPLACED_OLD', 'BIN_DAMAGED_OLD', 'BIN_COUNT_REPEAT']));
    expect(keys).not.toContain('BIN_MISMATCH');
    expect(f.find((x) => x.key === 'BIN_UNPLACED_OLD')!.refs.join()).toContain('OP-2');
    const all = (await get('/api/inventory-controls').expect(200)).body.items as { key: string }[];
    expect(all.some((x) => x.key === 'BIN_COUNT_REPEAT')).toBe(true);
    await get(`/api/inventory/bins/controls?warehouseId=${W}`, wh).expect(403);
  });

  it('impor rak: periksa dulu (dry-run), baris bermasalah menggagalkan seluruhnya, alias jenis dikenali, rak yang ada dilewati', async () => {
    const rowsIn = [
      { code: 'c-01-01', zone: 'C', kind: 'Simpan' },
      { code: 'C-01-02', zone: 'C', kind: 'penyiapan', name: 'Meja bungkus' },
      { code: 'A-01', zone: 'A' }, // sudah ada
      { code: 'C-02-01', kind: 'Rusak' },
    ];
    const dry = (await post('/api/inventory/bins/import', { warehouseId: W, rows: rowsIn, dryRun: true }).expect(201)).body;
    expect(dry.summary).toEqual({ total: 4, create: 3, skip: 1, errors: 0 });
    expect(((await get(`/api/inventory/bins?warehouseId=${W}`).expect(200)).body.bins as { code: string }[]).some((b) => b.code === 'C-01-01')).toBe(false);
    const bad = await post('/api/inventory/bins/import', { warehouseId: W, rows: [...rowsIn, { code: 'X 1' }, { code: 'C-01-01' }, { code: 'D-1', kind: 'ngawur' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.summary.errors).toBe(3);
    expect(((await get(`/api/inventory/bins?warehouseId=${W}`).expect(200)).body.bins as { code: string }[]).some((b) => b.code === 'C-01-01')).toBe(false);
    await post('/api/inventory/bins/import', { warehouseId: W, rows: rowsIn }, wh).expect(403);
    const ok = (await post('/api/inventory/bins/import', { warehouseId: W, rows: rowsIn }).expect(201)).body;
    expect(ok.summary.create).toBe(3);
    const bins = (await get(`/api/inventory/bins?warehouseId=${W}`).expect(200)).body.bins as { code: string; kind: string; zone: string | null; name: string | null }[];
    expect(bins.find((b) => b.code === 'C-01-01')!.kind).toBe('STORAGE');
    expect(bins.find((b) => b.code === 'C-01-02')).toMatchObject({ kind: 'STAGING', zone: 'C', name: 'Meja bungkus' });
    expect(bins.find((b) => b.code === 'C-02-01')!.kind).toBe('DAMAGED');
  });
});
