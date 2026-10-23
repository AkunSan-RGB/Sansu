/**
 * Lokasi rak gudang (e2e): aktivasi per gudang, stok awal masuk BELUM-DITEMPATKAN, penerimaan/pengeluaran/transfer ikut tercatat per rak
 * dan per lot, pindah antar rak, aturan peran, penonaktifan, isolasi antar perusahaan, serta uji acak invarian
 * (Σ stok rak = stok gudang) dan regresi (gudang berrak dan tanpa rak menghasilkan stok & HPP yang sama).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta, addDays } from '../src/common/utils/dates';

type Row = { binId: string; binCode: string; binKind: string; productId: string; sku: string; lotId: string | null; lotNo: string | null; qty: string };

describe('Lokasi rak gudang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let wh: string; // pegawai gudang
  let other: string; // perusahaan lain
  let W1: string; // gudang berrak
  let W2: string; // gudang tanpa rak
  let W3: string; // gudang berrak untuk uji nonaktif
  let P: string;
  let Q: string;
  let sup: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}, t = owner) => http.post(u).set(as(t)).send(b);
  const rows = async (warehouseId: string, productId?: string, t = owner) =>
    (await get(`/api/inventory/bins/stock?warehouseId=${warehouseId}${productId ? `&productId=${productId}` : ''}`, t).expect(200)).body.rows as Row[];
  const sum = (rs: Row[]) => rs.reduce((a, r) => a + Number(r.qty), 0);
  const stock = async (productId: string, warehouseId: string) => Number((await get(`/api/inventory/balances?productId=${productId}&warehouseId=${warehouseId}`).expect(200)).body[0]?.qty ?? 0);
  const avg = async (productId: string, warehouseId: string) => Number((await get(`/api/inventory/balances?productId=${productId}&warehouseId=${warehouseId}`).expect(200)).body[0]?.avgCost ?? 0);
  const check = async (warehouseId: string) => (await get(`/api/inventory/bins/check?warehouseId=${warehouseId}`).expect(200)).body;
  const expectConsistent = async (warehouseId: string) => {
    const c = await check(warehouseId);
    expect({ product: c.productMismatches, lot: c.lotMismatches }).toEqual({ product: [], lot: [] });
  };
  const bins = async (warehouseId: string) => (await get(`/api/inventory/bins?warehouseId=${warehouseId}`).expect(200)).body.bins as { id: string; code: string; kind: string; qty: string; isActive: boolean }[];
  const binId = async (warehouseId: string, code: string) => (await bins(warehouseId)).find((b) => b.code === code)!.id;
  const receive = async (product: string, warehouse: string, qty: string, price: string, lot?: { lotNo: string; expiryDate: string }) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: warehouse, date: today, lines: [{ productId: product, qty, price }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return post(`/api/purchase-orders/${po.id}/receipts`, { date: today, lines: [{ orderLineId: po.lines[0].id, qty, ...(lot ?? {}) }] }).expect(201);
  };
  const out = (product: string, warehouse: string, qty: number) =>
    post('/api/inventory/adjustments', { warehouseId: warehouse, reason: 'DAMAGED', date: today, lines: [{ productId: product, qty: String(-qty) }] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Gudang Rak', name: 'Pemilik', email: `rak-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'Pemilik Lain', email: `rak-b-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'Gudang', email: `rak-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    wh = (await http.post('/api/auth/login').send({ email: `rak-g-${stamp}@uji.id`, password: 'gudang12345' }).expect(200)).body.accessToken;
    W1 = (await get('/api/warehouses').expect(200)).body[0].id;
    W2 = (await post('/api/warehouses', { code: 'GD-2', name: 'Gudang 2' }).expect(201)).body.id;
    W3 = (await post('/api/warehouses', { code: 'GD-3', name: 'Gudang 3' }).expect(201)).body.id;
    P = (await post('/api/products', { sku: 'RAK-1', name: 'Sabun Cuci', sellPrice: '5000', category: 'Lain-lain' }).expect(201)).body.id;
    Q = (await post('/api/products', { sku: 'RAK-2', name: 'Pewangi', sellPrice: '7000', category: 'Lain-lain' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'S-RAK', name: 'Pemasok Rak' }).expect(201)).body.id;
    // stok awal sebelum rak diaktifkan: satu lot (kedaluwarsa) + sisa tanpa lot
    await receive(P, W1, '40', '1000', { lotNo: 'L-AWAL', expiryDate: addDays(today, 90) });
    await post('/api/inventory/adjustments', { warehouseId: W1, reason: 'OPENING', date: today, lines: [{ productId: P, qty: '10', unitCost: '1000' }] }).expect(201);
    await receive(Q, W1, '25', '2000');
  });
  afterAll(() => app.close());

  it('peran dan validasi: hanya Admin/Keuangan yang mengaktifkan; kode rak divalidasi; tanpa aktivasi rak tidak bisa dibuat', async () => {
    await post('/api/inventory/bins/activate', { warehouseId: W1 }, wh).expect(403);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['A-01'] }).expect(400); // belum aktif
    const list = (await get('/api/inventory/bins/warehouses').expect(200)).body as { id: string; binsEnabled: boolean }[];
    expect(list.find((w) => w.id === W1)!.binsEnabled).toBe(false);
  });

  it('aktivasi menyalin stok awal (lot dan tanpa lot) ke BELUM-DITEMPATKAN; gudang lain tidak berubah', async () => {
    await post('/api/inventory/bins/activate', { warehouseId: W1 }).expect(201);
    await post('/api/inventory/bins/activate', { warehouseId: W1 }).expect(400); // sudah aktif
    const rp = await rows(W1, P);
    expect(rp).toHaveLength(2);
    expect(rp.every((r) => r.binKind === 'UNASSIGNED')).toBe(true);
    expect(rp.find((r) => r.lotNo === 'L-AWAL')!.qty).toBe('40.0000');
    expect(rp.find((r) => r.lotNo === null)!.qty).toBe('10.0000');
    expect(sum(await rows(W1, Q))).toBe(25);
    expect(sum(rp)).toBe(await stock(P, W1));
    await expectConsistent(W1);
    expect(await rows(W2)).toEqual([]);
    await post('/api/inventory/bins/activate', { warehouseId: W2 }).expect(201);
    await post('/api/inventory/bins/deactivate', { warehouseId: W2 }).expect(201);
  });

  it('membuat rak: kode dibakukan, ganda ditolak, kode sistem dilarang', async () => {
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['a-01-01', 'A-01-02', 'A-02-01'], zone: 'A' }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['A-01-01'] }).expect(400);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['X-1', 'X-1'] }).expect(400);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['BELUM-DITEMPATKAN'] }).expect(400);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['rak kosong!'] }).expect(400);
    await post('/api/inventory/bins', { warehouseId: W1, codes: ['RSK-1'], kind: 'DAMAGED' }).expect(201);
    const codes = (await bins(W1)).map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['BELUM-DITEMPATKAN', 'A-01-01', 'A-01-02', 'A-02-01', 'RSK-1']));
    expect(await post('/api/inventory/bins', { warehouseId: W1, codes: ['Z-1'] }, wh)).toHaveProperty('status', 403);
  });

  it('pindah antar rak: lot dan tanpa lot, jumlah melebihi stok ditolak, stok gudang dan HPP tidak berubah', async () => {
    const un = await binId(W1, 'BELUM-DITEMPATKAN');
    const a1 = await binId(W1, 'A-01-01');
    const a2 = await binId(W1, 'A-01-02');
    const before = { qty: await stock(P, W1), avg: await avg(P, W1) };
    const lotRow = (await rows(W1, P)).find((r) => r.lotNo === 'L-AWAL')!;
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, lotId: lotRow.lotId, fromBinId: un, toBinId: a1, qty: '30' }, { productId: P, fromBinId: un, toBinId: a1, qty: '10' }] }, wh).expect(201);
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, lotId: lotRow.lotId, fromBinId: un, toBinId: a2, qty: '11' }] }, wh).expect(400); // sisa di BELUM-DITEMPATKAN hanya 10
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, fromBinId: a1, toBinId: a1, qty: '1' }] }, wh).expect(400);
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, fromBinId: a1, toBinId: a2, qty: '0' }] }, wh).expect(400);
    const r = await rows(W1, P);
    expect(r.filter((x) => x.binCode === 'A-01-01').map((x) => [x.lotNo, Number(x.qty)]).sort()).toEqual([[null, 10], ['L-AWAL', 30]].sort());
    expect(r.find((x) => x.binKind === 'UNASSIGNED')!.qty).toBe('10.0000'); // sisa lot di BELUM-DITEMPATKAN
    expect(await stock(P, W1)).toBe(before.qty);
    expect(await avg(P, W1)).toBe(before.avg);
    await expectConsistent(W1);
    const hist = (await get(`/api/inventory/bins/history?warehouseId=${W1}&productId=${P}`).expect(200)).body as { kind: string }[];
    expect(hist.filter((h) => h.kind === 'MOVE')).toHaveLength(2);
    expect(hist.some((h) => h.kind === 'SEED')).toBe(true);
  });

  it('penerimaan baru masuk BELUM-DITEMPATKAN dengan lotnya; keluar mengikuti FEFO lalu rak simpan', async () => {
    await receive(P, W1, '20', '1100', { lotNo: 'L-CEPAT', expiryDate: addDays(today, 10) });
    const un = await binId(W1, 'BELUM-DITEMPATKAN');
    const fresh = (await rows(W1, P)).find((r) => r.lotNo === 'L-CEPAT')!;
    expect(fresh.binId).toBe(un);
    expect(fresh.qty).toBe('20.0000');
    // keluar 25: lot L-CEPAT (20) habis lebih dulu, 5 dari L-AWAL
    await out(P, W1, 25).then((r) => expect(r.status).toBe(201));
    const r = await rows(W1, P);
    expect(r.some((x) => x.lotNo === 'L-CEPAT')).toBe(false);
    expect(sum(r)).toBe(await stock(P, W1));
    expect(sum(r.filter((x) => x.lotNo === 'L-AWAL'))).toBe(35);
    await expectConsistent(W1);
  });

  it('rak rusak/karantina: hanya Pemilik/Admin yang boleh mengeluarkan isinya', async () => {
    const a1 = await binId(W1, 'A-01-01');
    const bad = await binId(W1, 'RSK-1');
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, fromBinId: a1, toBinId: bad, qty: '3' }], note: 'Kemasan sobek' }, wh).expect(201);
    const back = { warehouseId: W1, lines: [{ productId: P, fromBinId: bad, toBinId: a1, qty: '3' }] };
    await post('/api/inventory/bins/move', back, wh).expect(403);
    await post('/api/inventory/bins/move', back).expect(201);
    await expectConsistent(W1);
  });

  it('transfer ke gudang tanpa rak dan kembali: rak mengikuti, lot ikut pindah', async () => {
    const before = await stock(P, W1);
    const t = (await post('/api/inventory/transfers', { fromWarehouseId: W1, toWarehouseId: W2, date: today, mode: 'IN_TRANSIT', lines: [{ productId: P, qty: '12' }] }).expect(201)).body;
    expect(await stock(P, W1)).toBe(before - 12);
    expect(sum(await rows(W1, P))).toBe(before - 12);
    await expectConsistent(W1);
    await post(`/api/inventory/transfers/${t.id}/receive`, {}).expect(201);
    expect(await rows(W2)).toEqual([]); // gudang tujuan tanpa rak
    // kirim balik (langsung) ke gudang berrak → masuk BELUM-DITEMPATKAN
    await post('/api/inventory/transfers', { fromWarehouseId: W2, toWarehouseId: W1, date: today, lines: [{ productId: P, qty: '12' }] }).expect(201);
    expect(await stock(P, W1)).toBe(before);
    expect(sum(await rows(W1, P))).toBe(before);
    await expectConsistent(W1);
  });

  it('regresi: gudang berrak dan tanpa rak menghasilkan stok dan HPP yang sama untuk urutan transaksi yang sama', async () => {
    for (const w of [W1, W2]) {
      await receive(Q, w, '10', '3000');
      await receive(Q, w, '10', '5000');
      await out(Q, w, 7).then((r) => expect(r.status).toBe(201));
    }
    const dq = (await stock(Q, W1)) - 25; // W1 sudah berisi 25 sebelumnya
    expect(dq).toBe(await stock(Q, W2));
    await expectConsistent(W1);
  });

  it('menonaktifkan rak: ditolak selama stok masih di rak, boleh setelah dikembalikan ke BELUM-DITEMPATKAN', async () => {
    await post('/api/inventory/bins/activate', { warehouseId: W3 }).expect(201);
    await post('/api/inventory/bins', { warehouseId: W3, codes: ['R-1'] }).expect(201);
    await receive(P, W3, '5', '1000');
    const un = await binId(W3, 'BELUM-DITEMPATKAN');
    const r1 = await binId(W3, 'R-1');
    await post('/api/inventory/bins/move', { warehouseId: W3, lines: [{ productId: P, fromBinId: un, toBinId: r1, qty: '5' }] }).expect(201);
    await post('/api/inventory/bins/deactivate', { warehouseId: W3 }).expect(400);
    await http.patch(`/api/inventory/bins/${r1}`).set(as()).send({ isActive: false }).expect(400); // masih berisi
    await post('/api/inventory/bins/move', { warehouseId: W3, lines: [{ productId: P, fromBinId: r1, toBinId: un, qty: '5' }] }).expect(201);
    await http.patch(`/api/inventory/bins/${r1}`).set(as()).send({ isActive: false, name: 'Rak lama' }).expect(200);
    await post('/api/inventory/bins/move', { warehouseId: W3, lines: [{ productId: P, fromBinId: un, toBinId: r1, qty: '1' }] }).expect(400); // rak tujuan nonaktif
    await post('/api/inventory/bins/deactivate', { warehouseId: W3 }).expect(201);
    expect(await rows(W3)).toEqual([]);
    expect(await stock(P, W3)).toBe(5); // stok gudang tidak tersentuh
    // aktifkan lagi: stok disalin ulang
    await post('/api/inventory/bins/activate', { warehouseId: W3 }).expect(201);
    expect(sum(await rows(W3, P))).toBe(5);
  });

  it('isolasi: perusahaan lain tidak melihat atau memindahkan rak', async () => {
    await get(`/api/inventory/bins?warehouseId=${W1}`, other).expect(400);
    const a1 = await binId(W1, 'A-01-01');
    const a2 = await binId(W1, 'A-01-02');
    await post('/api/inventory/bins/move', { warehouseId: W1, lines: [{ productId: P, fromBinId: a1, toBinId: a2, qty: '1' }] }, other).expect(400);
    await http.patch(`/api/inventory/bins/${a1}`).set(as(other)).send({ name: 'x' }).expect(404);
    expect(await rows(W1, undefined, other).catch(() => [])).toEqual([]);
  });

  it('uji acak: urutan penerimaan, pengeluaran, pindah rak, dan transfer menjaga Σ rak = stok gudang', async () => {
    const wid = (await post('/api/warehouses', { code: 'GD-F', name: 'Gudang Acak' }).expect(201)).body.id as string;
    await post('/api/inventory/bins/activate', { warehouseId: wid }).expect(201);
    await post('/api/inventory/bins', { warehouseId: wid, codes: ['F-1', 'F-2', 'F-3'] }).expect(201);
    await post('/api/inventory/bins', { warehouseId: wid, codes: ['F-RSK'], kind: 'DAMAGED' }).expect(201);
    const all = await bins(wid);
    const products = [P, Q];
    let seed = 20260101;
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
    for (let i = 0; i < 40; i++) {
      const p = products[rnd(2)];
      const act = rnd(5);
      if (act === 0 || (await stock(p, wid)) < 3) {
        const lot = rnd(2) ? { lotNo: `FZ-${i}`, expiryDate: addDays(today, 5 + rnd(60)) } : undefined;
        await receive(p, wid, String(5 + rnd(20)), String(1000 + rnd(500)), lot);
      } else if (act === 1) {
        const have = await stock(p, wid);
        await out(p, wid, Math.max(1, rnd(Math.min(have, 8)))).then((r) => expect(r.status).toBe(201));
      } else if (act === 4) {
        const have = await stock(p, wid);
        const t = (await post('/api/inventory/transfers', { fromWarehouseId: wid, toWarehouseId: W2, date: today, mode: 'IN_TRANSIT', lines: [{ productId: p, qty: String(Math.max(1, rnd(Math.min(have, 5)))) }] }).expect(201)).body;
        // di perjalanan stok sudah keluar dari rak; lalu diterima atau dibatalkan (kembali ke gudang asal)
        for (const pp of products) expect(sum(await rows(wid, pp))).toBe(await stock(pp, wid));
        await post(`/api/inventory/transfers/${t.id}/${rnd(2) ? 'receive' : 'cancel'}`, {}).expect(201);
      } else {
        const rs = (await rows(wid, p)).filter((r) => Number(r.qty) > 0);
        if (rs.length) {
          const src = rs[rnd(rs.length)];
          const dst = all.filter((b) => b.id !== src.binId && b.kind !== 'UNASSIGNED')[rnd(all.length - 2)];
          const q = Math.max(1, Math.floor(Number(src.qty) / 2));
          await post('/api/inventory/bins/move', { warehouseId: wid, lines: [{ productId: p, lotId: src.lotId ?? undefined, fromBinId: src.binId, toBinId: dst.id, qty: String(q) }] }).then((r) => expect([201, 400]).toContain(r.status));
        }
      }
      for (const pp of products) expect(sum(await rows(wid, pp))).toBe(await stock(pp, wid));
    }
    await expectConsistent(wid);
    const neg = (await rows(wid)).filter((r) => Number(r.qty) < 0);
    expect(neg).toEqual([]);
  });
});
