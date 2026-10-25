/** Rute pengiriman: rencana, urutan terdekat, berangkat, bukti terima, selesai, aturan, peran, dan isolasi antar perusahaan. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { createPool } from '../src/db/db';
import { nearestOrder } from '../src/modules/sales/deliveries/delivery-trips.service';

describe('nearestOrder (unit)', () => {
  it('mengurutkan dari titik terdekat; stop tanpa koordinat di belakang dengan urutan semula', () => {
    const r = nearestOrder([
      { id: 'A', lat: -6.2, lng: 106.8 },
      { id: 'X', lat: null, lng: null },
      { id: 'C', lat: -6.9, lng: 107.6 }, // jauh (Bandung)
      { id: 'B', lat: -6.21, lng: 106.81 }, // dekat A
    ]);
    expect(r.map((s) => s.id)).toEqual(['A', 'B', 'C', 'X']);
    const one = [{ id: 'A', lat: 1, lng: 1 }];
    expect(nearestOrder(one)).toEqual(one);
  });
});

describe('Rute pengiriman (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const PASS = 'rahasia123';
  let owner = '';
  let wh = '';
  let sales = '';
  let cashier = '';
  let other = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const sj: string[] = []; // id surat jalan: A (Jakarta), B (dekat A), C (Bandung), D (tanpa koordinat)
  let sjOther = '';

  const mkSj = async (tok: string, tag: string, geo?: { lat: number; lng: number }) => {
    const warehouseId = (await get(tok, '/api/warehouses').expect(200)).body[0].id;
    const productId = (await get(tok, '/api/products').expect(200)).body[0].id;
    const c = (await post(tok, '/api/customers', { code: `C-${tag}`, name: `Toko ${tag}`, address: `Jl. ${tag}`, ...(geo ? { geoLat: geo.lat, geoLng: geo.lng } : {}) }).expect(201)).body.id;
    const so = (await post(tok, '/api/sales-orders', { customerId: c, warehouseId, lines: [{ productId, qty: '1', price: '20000' }] }).expect(201)).body;
    await post(tok, `/api/sales-orders/${so.id}/confirm`).expect(201);
    return (await post(tok, `/api/sales-orders/${so.id}/deliver`).expect(201)).body.id as string;
  };
  const setup = async (companyName: string, email: string) => {
    const t = (await http.post('/api/auth/register').send({ companyName, name: 'Pemilik', email, password: PASS, businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    const warehouseId = (await get(t, '/api/warehouses').expect(200)).body[0].id;
    const productId = (await post(t, '/api/products', { sku: 'RT-1', name: 'Barang Rute', sellPrice: '20000' }).expect(201)).body.id;
    const sup = (await post(t, '/api/suppliers', { code: 'S-RT', name: 'Pemasok' }).expect(201)).body.id;
    const po = (await post(t, '/api/purchase-orders', { supplierId: sup, warehouseId, lines: [{ productId, qty: '100', price: '10000' }] }).expect(201)).body;
    await post(t, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(t, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'RT-1' }).expect(201);
    return t;
  };
  const addUser = async (tag: string, role: string) => {
    await post(owner, '/api/users', { name: tag, email: `rt-${tag}-${stamp}@uji.id`, password: PASS, role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `rt-${tag}-${stamp}@uji.id`, password: PASS }).expect(200)).body.accessToken as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = await setup('PT Rute Satu', `rt-own-${stamp}@uji.id`);
    wh = await addUser('gudang', 'WAREHOUSE');
    sales = await addUser('sales', 'SALES');
    cashier = await addUser('kasir', 'CASHIER');
    sj.push(await mkSj(owner, 'A', { lat: -6.2, lng: 106.8 }));
    sj.push(await mkSj(owner, 'B', { lat: -6.21, lng: 106.81 }));
    sj.push(await mkSj(owner, 'C', { lat: -6.9, lng: 107.6 }));
    sj.push(await mkSj(owner, 'D'));
    other = await setup('PT Rute Dua', `rt-two-${stamp}@uji.id`);
    sjOther = await mkSj(other, 'Z');
  }, 120_000);
  afterAll(() => app.close());

  let trip: { id: string; number: string };

  it('peran: Gudang membuat rute; Sales hanya melihat; Kasir ditolak', async () => {
    await post(sales, '/api/delivery-trips', { vehicle: 'B 1' }).expect(403);
    await post(cashier, '/api/delivery-trips', { vehicle: 'B 1' }).expect(403);
    await get(cashier, '/api/delivery-trips').expect(403);
    await get(sales, '/api/delivery-trips').expect(200);
    trip = (await post(wh, '/api/delivery-trips', { vehicle: 'B 1234 XY', driverName: 'Pak Slamet', deliveryIds: [sj[0], sj[2], sj[3], sj[1]] }).expect(201)).body;
    expect(trip.number).toMatch(/^RTE\//);
  });

  it('surat jalan yang sudah masuk rute tidak muncul di daftar belum dijadwalkan dan tidak bisa dipakai dua kali', async () => {
    const un = (await get(wh, '/api/delivery-trips/unscheduled').expect(200)).body as { id: string }[];
    expect(un.some((d) => sj.includes(d.id))).toBe(false);
    const r = await post(wh, '/api/delivery-trips', { deliveryIds: [sj[0]] });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Sudah ada di rute lain');
  });

  it('surat jalan perusahaan lain tidak bisa dimasukkan dan rute tidak terlihat lintas perusahaan', async () => {
    const r = await post(wh, '/api/delivery-trips', { deliveryIds: [sjOther] });
    expect(r.status).toBe(400);
    await get(other, `/api/delivery-trips/${trip.id}`).expect(404);
    await post(other, `/api/delivery-trips/${trip.id}/depart`).expect(404);
    expect(((await get(other, '/api/delivery-trips').expect(200)).body as unknown[]).length).toBe(0);
  });

  it('urutkan terdekat: A → B → C, stop tanpa koordinat (D) di belakang', async () => {
    const t = (await post(wh, `/api/delivery-trips/${trip.id}/optimize`).expect(201)).body;
    expect(t.stops.map((s: { customerName: string }) => s.customerName)).toEqual(['Toko A', 'Toko B', 'Toko C', 'Toko D']);
    expect(t.stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('urutan manual harus memuat semua stop tepat sekali', async () => {
    const t = (await get(wh, `/api/delivery-trips/${trip.id}`).expect(200)).body;
    const ids = t.stops.map((s: { id: string }) => s.id) as string[];
    await post(wh, `/api/delivery-trips/${trip.id}/reorder`, { stopIds: ids.slice(1) }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/reorder`, { stopIds: [ids[0], ids[0], ids[2], ids[3]] }).expect(400);
    const r = (await post(wh, `/api/delivery-trips/${trip.id}/reorder`, { stopIds: [...ids].reverse() }).expect(201)).body;
    expect(r.stops[0].customerName).toBe('Toko D');
  });

  it('hasil stop belum bisa dicatat sebelum berangkat; berangkat mengunci susunan stop', async () => {
    const t = (await get(wh, `/api/delivery-trips/${trip.id}`).expect(200)).body;
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${t.stops[0].id}/result`, { result: 'DELIVERED', receivedBy: 'Budi' }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/depart`).expect(201);
    await post(wh, `/api/delivery-trips/${trip.id}/depart`).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/stops`, { deliveryIds: [sj[0]] }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/reorder`, { stopIds: t.stops.map((s: { id: string }) => s.id) }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/cancel`, { reason: 'batal' }).expect(400);
  });

  it('terkirim wajib nama penerima, gagal wajib alasan; selesai hanya bila semua stop diputuskan', async () => {
    const t = (await get(wh, `/api/delivery-trips/${trip.id}`).expect(200)).body;
    const [s1, s2, s3, s4] = t.stops as { id: string }[]; // urutan sekarang: D, C, B, A (hasil dibalik)
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s1.id}/result`, { result: 'DELIVERED' }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s1.id}/result`, { result: 'FAILED' }).expect(400);
    await post(wh, `/api/delivery-trips/${trip.id}/complete`).expect(400); // masih ada stop yang belum diputuskan
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s1.id}/result`, { result: 'DELIVERED', receivedBy: 'Budi' }).expect(201);
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s1.id}/result`, { result: 'DELIVERED', receivedBy: 'Lain' }).expect(400); // tidak bisa diubah
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s2.id}/result`, { result: 'DELIVERED', receivedBy: 'Sari' }).expect(201);
    await post(wh, `/api/delivery-trips/${trip.id}/stops/${s3.id}/result`, { result: 'FAILED', failReason: 'Toko tutup' }).expect(201);
    const done = await post(wh, `/api/delivery-trips/${trip.id}/stops/${s4.id}/result`, { result: 'DELIVERED', receivedBy: 'Dewi', note: 'Titip satpam' }).expect(201);
    expect(done.body.stops.filter((s: { status: string }) => s.status === 'DELIVERED')).toHaveLength(3);
    const fin = (await post(wh, `/api/delivery-trips/${trip.id}/complete`).expect(201)).body;
    expect(fin.status).toBe('COMPLETED');
    expect(fin.completedAt).toBeTruthy();
  });

  it('stop gagal ditandai di kontrol sampai dijadwalkan ulang; sesudahnya boleh masuk rute baru', async () => {
    let c = (await get(wh, '/api/delivery-trips/controls').expect(200)).body;
    expect(c.failedNotRescheduled.map((f: { number: string }) => f.number)).toHaveLength(1);
    const t2 = (await post(wh, '/api/delivery-trips', { deliveryIds: [sj[1]] }).expect(201)).body; // sj B yang gagal tadi
    c = (await get(wh, '/api/delivery-trips/controls').expect(200)).body;
    expect(c.failedNotRescheduled).toHaveLength(0);
    // rute baru yang belum berangkat bisa dibatalkan: stop dilepas dan surat jalan kembali tersedia
    await post(wh, `/api/delivery-trips/${t2.id}/cancel`, { reason: 'Kendaraan rusak' }).expect(201);
    const un = (await get(wh, '/api/delivery-trips/unscheduled').expect(200)).body as { id: string }[];
    expect(un.some((d) => d.id === sj[1])).toBe(true);
    expect(((await get(wh, `/api/delivery-trips/${t2.id}`).expect(200)).body as { status: string }).status).toBe('CANCELLED');
  });

  it('rute kosong tidak bisa berangkat; daftar dan ringkasan jumlah stop benar; jejak audit tercatat', async () => {
    const empty = (await post(wh, '/api/delivery-trips', {}).expect(201)).body;
    await post(wh, `/api/delivery-trips/${empty.id}/depart`).expect(400);
    const list = (await get(wh, '/api/delivery-trips').expect(200)).body as { id: string; stops: number; delivered: number; failed: number }[];
    const row = list.find((x) => x.id === trip.id)!;
    expect(row).toMatchObject({ stops: 4, delivered: 3, failed: 1 });
    const pool = createPool();
    try {
      const rows = (await pool.query<{ action: string }>('SELECT action FROM audit_logs WHERE entity_id = $1', [trip.id])).rows.map((r) => r.action);
      expect(rows).toEqual(expect.arrayContaining(['CREATE', 'REORDER', 'DEPART', 'STOP_DELIVERED', 'STOP_FAILED', 'COMPLETE']));
    } finally {
      await pool.end();
    }
  });
});
