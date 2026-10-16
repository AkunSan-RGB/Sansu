/**
 * Meja, pesanan terbuka, dapur, dan pisah bill (e2e): satu meja satu pesanan terbuka, kirim ke dapur dengan cek stok bahan,
 * alur status dapur, pembatalan terkontrol, bayar sebagian, retur tetap lewat kasir, dan pembukuan seimbang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Tab = { id: string; number: string; status: string; tableLabel: string | null; lines: { id: string; status: string; paidOrderId: string | null; product: { sku: string } }[]; unpaidSubtotal: string };

describe('Meja, pesanan terbuka, dapur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  let waiter: string;
  let W: string;
  let W2: string;
  let T1: string;
  let T2: string;
  let T3: string;
  let kopi: string;
  let susu: string;
  let menu: string;
  let air: string;
  let cashierSession: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const patch = (t: string, u: string, b: object = {}) => http.patch(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const qty = async (p: string) => Number((await get(owner, `/api/inventory/balances?productId=${p}&warehouseId=${W}`).expect(200)).body[0]?.qty ?? 0);
  const bal = async (code: string) => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const tab = async (id: string) => (await get(cashier, `/api/pos/tabs/${id}`).expect(200)).body as Tab;
  const mkTab = async (tableId: string, lines: object[]) => (await post(cashier, '/api/pos/tabs', { warehouseId: W, tableId, lines }).expect(201)).body as Tab;
  const kitchen = async () => (await get(owner, `/api/pos/kitchen?warehouseId=${W}`).expect(200)).body as { tickets: { tabId: string; number: string; tableLabel: string; items: { id: string; status: string; notes: string | null; product: string; qty: string }[] }[]; summary: Record<string, number> };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Meja', name: 'Pemilik', email: `mj-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    W2 = (await post(owner, '/api/warehouses', { code: 'OUT-2', name: 'Outlet Dua' }).expect(201)).body.id;
    await post(owner, '/api/users', { name: 'Kasir', email: `mj-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    await post(owner, '/api/users', { name: 'Gudang', email: `mj-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    cashier = await login(`mj-k-${stamp}@uji.id`, 'kasir12345');
    waiter = await login(`mj-g-${stamp}@uji.id`, 'gudang12345');
    const mk = async (sku: string, body: object) => (await post(owner, '/api/products', { sku, sellPrice: '0', ...body }).expect(201)).body.id as string;
    kopi = await mk('BB-KOPI', { name: 'Biji Kopi', baseUom: 'GRAM' });
    susu = await mk('BB-SUSU', { name: 'Susu', baseUom: 'ML' });
    menu = await mk('MN-KOPSU', { name: 'Kopi Susu', baseUom: 'PCS', sellPrice: '24000', madeToOrder: true });
    air = await mk('BR-AIR', { name: 'Air Mineral', baseUom: 'BOTOL', sellPrice: '6000' });
    await post(owner, '/api/production/boms', { name: 'Resep Kopi Susu', productId: menu, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: '18' }, { productId: susu, qty: '150' }] }).expect(201);
    await post(owner, '/api/inventory/adjustments', {
      warehouseId: W,
      reason: 'OPENING',
      date: today,
      lines: [
        { productId: kopi, qty: '1000', unitCost: '140' },
        { productId: susu, qty: '2000', unitCost: '18' },
        { productId: air, qty: '100', unitCost: '3000' },
      ],
    }).expect(201);
    T1 = (await post(owner, '/api/pos/tables', { warehouseId: W, code: 'm1', name: 'Meja 1', seats: 4 }).expect(201)).body.id;
    T2 = (await post(owner, '/api/pos/tables', { warehouseId: W, code: 'M2', name: 'Meja 2' }).expect(201)).body.id;
    T3 = (await post(owner, '/api/pos/tables', { warehouseId: W, code: 'M3', name: 'Meja 3' }).expect(201)).body.id;
    cashierSession = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('meja: kode ganda ditolak; hanya admin yang mengatur meja; peran lain tanpa akses ditolak', async () => {
    await post(owner, '/api/pos/tables', { warehouseId: W, code: 'M1', name: 'Duplikat' }).expect(400); // kode disamakan huruf besar
    await post(cashier, '/api/pos/tables', { warehouseId: W, code: 'M9', name: 'X' }).expect(403);
    await get(waiter, '/api/pos/tables').expect(403);
    const list = (await get(cashier, `/api/pos/tables?warehouseId=${W}`).expect(200)).body as { code: string; openTab: unknown }[];
    expect(list.map((t) => t.code)).toEqual(['M1', 'M2', 'M3']);
    expect(list.every((t) => t.openTab === null)).toBe(true);
  });

  let t1: Tab;
  it('pesanan terbuka: meja wajib untuk makan di tempat; satu meja satu pesanan; jumlah tidak sah ditolak', async () => {
    await post(cashier, '/api/pos/tabs', { warehouseId: W, orderType: 'DINE_IN' }).expect(400);
    await post(cashier, '/api/pos/tabs', { warehouseId: W, tableId: T1, lines: [{ productId: menu, qty: '0' }] }).expect(400);
    await post(cashier, '/api/pos/tabs', { warehouseId: W, tableId: T1, lines: [{ productId: menu, qty: '1.00001' }] }).expect(400);
    t1 = await mkTab(T1, [{ productId: menu, qty: '2', notes: 'Tanpa gula' }, { productId: air, qty: '1' }]);
    expect(t1.tableLabel).toBe('Meja 1');
    expect(t1.number).toMatch(/^PSN\//);
    expect(t1.lines.every((l) => l.status === 'DRAFT')).toBe(true);
    expect(Number(t1.unpaidSubtotal)).toBe(2 * 24000 + 6000);
    await post(cashier, '/api/pos/tabs', { warehouseId: W, tableId: T1 }).expect(400); // meja sudah terisi
    await post(cashier, '/api/pos/tabs', { warehouseId: W2, tableId: T1 }).expect(400); // meja milik outlet lain
    const tables = (await get(cashier, `/api/pos/tables?warehouseId=${W}`).expect(200)).body as { code: string; openTab: { number: string; items: number } | null }[];
    expect(tables.find((t) => t.code === 'M1')!.openTab).toMatchObject({ number: t1.number, items: 2 });
  });

  it('kirim ke dapur: menu antre di dapur, barang biasa langsung disajikan; belum dikirim tidak muncul di dapur', async () => {
    expect((await kitchen()).tickets).toEqual([]);
    const sent = (await post(cashier, `/api/pos/tabs/${t1.id}/send`).expect(201)).body as Tab;
    const byStatus = Object.fromEntries(sent.lines.map((l) => [l.product.sku, l.status]));
    expect(byStatus).toEqual({ 'MN-KOPSU': 'NEW', 'BR-AIR': 'SERVED' });
    const k = await kitchen();
    expect(k.summary).toMatchObject({ NEW: 1, PREPARING: 0, READY: 0 });
    expect(k.tickets).toHaveLength(1);
    expect(k.tickets[0]).toMatchObject({ number: t1.number, tableLabel: 'Meja 1' });
    expect(k.tickets[0].items[0]).toMatchObject({ product: 'Kopi Susu', notes: 'Tanpa gula', status: 'NEW' });
    await post(cashier, `/api/pos/tabs/${t1.id}/send`).expect(400); // tidak ada yang baru
    expect(await qty(kopi)).toBe(1000); // stok baru berkurang saat dibayar
  });

  it('cek stok bahan saat kirim memperhitungkan pesanan terbuka lain', async () => {
    // Susu 2000 ml: pesanan Meja 1 sudah butuh 300 ml. Meja 2 minta 12 porsi (1800) → total 2100 > 2000
    const t2 = await mkTab(T2, [{ productId: menu, qty: '12' }]);
    const r = await post(cashier, `/api/pos/tabs/${t2.id}/send`).expect(400);
    expect(JSON.stringify(r.body)).toContain('tidak cukup');
    expect((await tab(t2.id)).lines[0].status).toBe('DRAFT'); // gagal total, tidak setengah terkirim
    // hapus baris (belum dikirim) lalu pesan 3 porsi (450 + 300 = 750 ≤ 2000)
    await post(cashier, `/api/pos/tabs/${t2.id}/lines/${t2.lines[0].id}/void`).expect(201);
    expect((await tab(t2.id)).lines).toHaveLength(0);
    await post(cashier, `/api/pos/tabs/${t2.id}/lines`, { lines: [{ productId: menu, qty: '3' }] }).expect(201);
    await post(cashier, `/api/pos/tabs/${t2.id}/send`).expect(201);
    expect((await kitchen()).tickets).toHaveLength(2);
  });

  it('status dapur hanya maju; menu yang belum dikirim tidak bisa diubah', async () => {
    const k = await kitchen();
    const line = k.tickets.find((t) => t.number === t1.number)!.items[0];
    await post(owner, `/api/pos/kitchen/lines/${line.id}/status`, { status: 'READY' }).expect(201); // boleh melompat maju
    await post(owner, `/api/pos/kitchen/lines/${line.id}/status`, { status: 'PREPARING' }).expect(400); // mundur ditolak
    await post(owner, `/api/pos/kitchen/lines/${line.id}/status`, { status: 'BEKU' }).expect(400);
    const l = (await tab(t1.id)).lines.find((x) => x.id === line.id)!;
    expect(l.status).toBe('READY');
    await post(owner, `/api/pos/kitchen/lines/${line.id}/status`, { status: 'SERVED' }).expect(201);
    expect((await kitchen()).tickets.find((t) => t.number === t1.number)).toBeUndefined(); // sudah disajikan: hilang dari antrean
    await post(owner, `/api/pos/kitchen/lines/00000000-0000-4000-8000-000000000000/status`, { status: 'READY' }).expect(404);
  });

  it('pembatalan terkontrol: menu baru boleh dengan alasan; yang sudah dimasak/disajikan hanya supervisor', async () => {
    const t3 = await mkTab(T3, [{ productId: menu, qty: '1' }, { productId: menu, qty: '1' }]);
    await post(cashier, `/api/pos/tabs/${t3.id}/send`).expect(201);
    const [a, b] = (await tab(t3.id)).lines;
    await post(cashier, `/api/pos/tabs/${t3.id}/lines/${a.id}/void`, {}).expect(400); // alasan wajib untuk menu yang sudah dikirim
    await post(cashier, `/api/pos/tabs/${t3.id}/lines/${a.id}/void`, { reason: 'x' }).expect(400);
    await post(cashier, `/api/pos/tabs/${t3.id}/lines/${a.id}/void`, { reason: 'Pelanggan salah pesan' }).expect(201);
    await post(owner, `/api/pos/kitchen/lines/${b.id}/status`, { status: 'PREPARING' }).expect(201);
    await post(cashier, `/api/pos/tabs/${t3.id}/lines/${b.id}/void`, { reason: 'Pelanggan pergi' }).expect(403); // sudah dimasak
    await post(cashier, `/api/pos/tabs/${t3.id}/cancel`, { reason: 'Pelanggan pergi' }).expect(403);
    await post(owner, `/api/pos/tabs/${t3.id}/lines/${b.id}/void`, { reason: 'Pelanggan pergi, menu dibuang' }).expect(201);
    const closed = await tab(t3.id);
    expect(closed.status).toBe('CANCELLED'); // semua baris batal → pesanan batal otomatis
    await post(cashier, `/api/pos/tabs/${t3.id}/lines`, { lines: [{ productId: menu, qty: '1' }] }).expect(400); // sudah ditutup
    expect((await kitchen()).tickets.find((t) => t.number === t3.number)).toBeUndefined();
    // meja kembali kosong dan bisa dipakai lagi
    await mkTab(T3, [{ productId: air, qty: '1' }]);
  });

  it('pindah meja: ke meja kosong berhasil, ke meja terpakai ditolak', async () => {
    await patch(cashier, `/api/pos/tabs/${t1.id}/move`, { tableId: T2 }).expect(400); // Meja 2 dipakai
    const t = (await patch(cashier, `/api/pos/tabs/${t1.id}/move`, { tableLabel: 'Teras A' }).expect(200)).body as Tab;
    expect(t.tableLabel).toBe('Teras A');
    const free = (await get(cashier, `/api/pos/tables?warehouseId=${W}`).expect(200)).body as { code: string; openTab: unknown }[];
    expect(free.find((x) => x.code === 'M1')!.openTab).toBeNull();
    await patch(cashier, `/api/pos/tabs/${t1.id}/move`, { tableId: T1 }).expect(200);
    await post(owner, `/api/pos/tables`, { warehouseId: W, code: 'M4', name: 'Meja 4' }).expect(201);
    await patch(owner, `/api/pos/tables/${T1}`, { isActive: false }).expect(400); // masih ada pesanan terbuka
  });

  it('bayar sebagian (pisah bill): hanya baris terpilih dibayar; stok dan jurnal mengikuti; sisanya tetap terbuka', async () => {
    const before = await tab(t1.id);
    const airLine = before.lines.find((l) => l.product.sku === 'BR-AIR')!;
    const kopsuLine = before.lines.find((l) => l.product.sku === 'MN-KOPSU')!;
    const pb0 = await bal('2-1210');
    // sesi kasir di outlet lain ditolak
    const s2 = (await post(owner, '/api/pos/sessions', { warehouseId: W2, openingCash: '0' }).expect(201)).body.id;
    await post(owner, `/api/pos/tabs/${t1.id}/pay`, { sessionId: s2, lineIds: [airLine.id], payments: [{ method: 'CASH', amount: '100000' }] }).expect(400);
    // baris yang tidak ada di pesanan ditolak
    await post(cashier, `/api/pos/tabs/${t1.id}/pay`, { sessionId: cashierSession, lineIds: ['00000000-0000-4000-8000-000000000000'], payments: [{ method: 'CASH', amount: '100000' }] }).expect(400);
    const o1 = (await post(cashier, `/api/pos/tabs/${t1.id}/pay`, { sessionId: cashierSession, lineIds: [airLine.id], payments: [{ method: 'CASH', amount: '10000' }] }).expect(201)).body;
    expect(o1.orderType).toBe('DINE_IN');
    expect(o1.tableLabel).toBe('Meja 1');
    expect(o1.tabId).toBe(t1.id);
    expect(Number(o1.subtotal)).toBe(6000);
    expect(await qty(air)).toBe(99);
    expect(await qty(kopi)).toBe(1000); // menu belum dibayar → bahan belum terpotong
    const mid = await tab(t1.id);
    expect(mid.status).toBe('OPEN');
    expect(mid.lines.find((l) => l.id === airLine.id)!.paidOrderId).toBe(o1.id);
    expect(mid.lines.find((l) => l.id === kopsuLine.id)!.paidOrderId).toBeNull();
    // baris yang sama tidak bisa dibayar dua kali
    await post(cashier, `/api/pos/tabs/${t1.id}/pay`, { sessionId: cashierSession, lineIds: [airLine.id], payments: [{ method: 'CASH', amount: '100000' }] }).expect(400);
    // bayar sisanya: menu terjual → bahan terpotong sesuai resep
    const o2 = (await post(cashier, `/api/pos/tabs/${t1.id}/pay`, { sessionId: cashierSession, payments: [{ method: 'QRIS', amount: '10000' }, { method: 'CASH', amount: '100000' }] }).expect(201)).body;
    expect(Number(o2.subtotal)).toBe(48000);
    expect(await qty(kopi)).toBe(1000 - 2 * 18);
    expect(await qty(susu)).toBe(2000 - 2 * 150);
    expect((await tab(t1.id)).status).toBe('PAID');
    expect(await bal('2-1210')).toBeCloseTo(pb0 + 0.1 * (6000 + 48000), 2);
    await post(cashier, `/api/pos/tabs/${t1.id}/pay`, { sessionId: cashierSession, payments: [{ method: 'CASH', amount: '100000' }] }).expect(400); // sudah lunas
    await post(cashier, `/api/pos/tabs/${t1.id}/cancel`, { reason: 'sudah dibayar semua' }).expect(400);
    // retur tetap lewat kasir (supervisor)
    await post(owner, `/api/pos/orders/${o2.id}/return`, { all: true, reason: 'pelanggan komplain rasa' }).expect(201);
    expect(await qty(kopi)).toBe(1000 - 2 * 18); // bahan tidak kembali
    await bal('1-1400');
    await post(owner, `/api/pos/sessions/${s2}/close`, { countedCash: '0' }).expect(201);
  });

  it('menu yang belum dikirim ke dapur tidak bisa dibayar; meja yang dibayar lunas langsung bebas', async () => {
    const t = await mkTab(T1, [{ productId: menu, qty: '1' }]); // Meja 1 bebas lagi setelah lunas
    await post(cashier, `/api/pos/tabs/${t.id}/pay`, { sessionId: cashierSession, payments: [{ method: 'CASH', amount: '100000' }] }).expect(400);
    await post(cashier, `/api/pos/tabs/${t.id}/cancel`, { reason: 'Pelanggan batal sebelum dikirim' }).expect(201);
    expect((await tab(t.id)).status).toBe('CANCELLED');
    const open = (await get(cashier, '/api/pos/tabs?status=OPEN').expect(200)).body as { number: string }[];
    expect(open.some((o) => o.number === t.number)).toBe(false);
  });

  it('temuan kontrol: pembatalan menu yang sudah dimasak tercatat', async () => {
    const r = (await get(owner, '/api/pos/controls').expect(200)).body as { items: { key: string }[] };
    expect(r.items.map((i) => i.key)).toContain('POS_TAB_VOIDS');
  });
});
