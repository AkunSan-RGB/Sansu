/** Rute pengiriman lanjutan: kapasitas muatan, jarak jalan (OSRM), lokasi GPS, bukti foto dan tanda tangan. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { haversineM } from '../src/modules/sales/canvass/canvass.service';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Rute pengiriman lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let osrm: Server;
  let osrmUrl = '';
  const stamp = Date.now();
  const PASS = 'rahasia123';
  let owner = '';
  let wh = '';
  let sales = '';
  let cashier = '';
  let admin = '';
  let other = '';
  let heavy = ''; // produk berbobot 25 kg
  let light = ''; // produk tanpa berat
  let warehouseId = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const get = (t: string, u: string) => http.get(u).set(as(t));

  const addUser = async (tag: string, role: string) => {
    await post(owner, '/api/users', { name: tag, email: `rl-${tag}-${stamp}@uji.id`, password: PASS, role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `rl-${tag}-${stamp}@uji.id`, password: PASS }).expect(200)).body.accessToken as string;
  };
  /** Surat jalan untuk pelanggan baru; lines = [produk, qty] */
  const mkSj = async (tag: string, lines: [string, number][], geo?: { lat: number; lng: number }, tok = owner) => {
    const c = (await post(tok, '/api/customers', { code: `C-${tag}`, name: `Toko ${tag}`, ...(geo ? { geoLat: geo.lat, geoLng: geo.lng } : {}) }).expect(201)).body.id;
    const so = (await post(tok, '/api/sales-orders', { customerId: c, warehouseId, lines: lines.map(([productId, qty]) => ({ productId, qty: String(qty), price: '20000' })) }).expect(201)).body;
    await post(tok, `/api/sales-orders/${so.id}/confirm`).expect(201);
    return (await post(tok, `/api/sales-orders/${so.id}/deliver`).expect(201)).body.id as string;
  };
  const setup = async (name: string, email: string) => {
    const t = (await http.post('/api/auth/register').send({ companyName: name, name: 'Pemilik', email, password: PASS, businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    const w = (await get(t, '/api/warehouses').expect(200)).body[0].id;
    const sup = (await post(t, '/api/suppliers', { code: 'S-RL', name: 'Pemasok' }).expect(201)).body.id;
    const a = (await post(t, '/api/products', { sku: 'RL-H', name: 'Barang Berat', sellPrice: '20000', weightKg: '25' }).expect(201)).body.id;
    const b = (await post(t, '/api/products', { sku: 'RL-L', name: 'Barang Tanpa Berat', sellPrice: '20000' }).expect(201)).body.id;
    const po = (await post(t, '/api/purchase-orders', { supplierId: sup, warehouseId: w, lines: [{ productId: a, qty: '100', price: '10000' }, { productId: b, qty: '100', price: '10000' }] }).expect(201)).body;
    await post(t, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(t, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'RL-1' }).expect(201);
    return { t, w, a, b };
  };

  beforeAll(async () => {
    // Peladen OSRM tiruan: jarak jalan = jarak garis lurus, kecuali pasangan titik dekat Jakarta (A–B) yang dibuat sangat jauh (jalan memutar)
    osrm = createServer((req, res) => {
      const m = /\/table\/v1\/driving\/([^?]+)/.exec(req.url ?? '');
      if (!m) {
        res.writeHead(404).end();
        return;
      }
      const pts = m[1].split(';').map((p) => p.split(',').map(Number) as [number, number]);
      const distances = pts.map((p, i) => pts.map((q, j) => {
        if (i === j) return 0;
        const d = haversineM(p[1], p[0], q[1], q[0]);
        return d < 5000 ? d * 200 : d; // A–B dekat tetapi jalannya memutar
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'Ok', distances }));
    });
    await new Promise<void>((r) => osrm.listen(0, '127.0.0.1', r));
    osrmUrl = `http://127.0.0.1:${(osrm.address() as AddressInfo).port}`;

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const s = await setup('PT Rute Lanjut', `rl-own-${stamp}@uji.id`);
    owner = s.t; warehouseId = s.w; heavy = s.a; light = s.b;
    wh = await addUser('gudang', 'WAREHOUSE');
    sales = await addUser('sales', 'SALES');
    cashier = await addUser('kasir', 'CASHIER');
    admin = await addUser('admin', 'ADMIN');
    other = (await setup('PT Rute Lain', `rl-two-${stamp}@uji.id`)).t;
  }, 180_000);
  afterAll(async () => {
    delete process.env.ROUTING_URL;
    await new Promise((r) => osrm.close(r));
    await app.close();
  });

  describe('kendaraan dan kapasitas muatan', () => {
    let veh: { id: string };
    it('kendaraan: Gudang mengelola, Sales hanya melihat, plat ganda ditolak (tanpa peduli huruf besar/kecil)', async () => {
      await post(sales, '/api/delivery-vehicles', { plate: 'B 1 CAP', capacityKg: '100' }).expect(403);
      await post(cashier, '/api/delivery-vehicles', { plate: 'B 1 CAP' }).expect(403);
      veh = (await post(wh, '/api/delivery-vehicles', { plate: 'B 1 cap', capacityKg: '100', defaultDriver: 'Pak Amir' }).expect(201)).body;
      expect(veh).toMatchObject({ plate: 'B 1 CAP', capacityKg: '100.00' });
      expect((await post(wh, '/api/delivery-vehicles', { plate: 'b 1 CAP' })).status).toBe(400);
      expect(((await get(sales, '/api/delivery-vehicles').expect(200)).body as unknown[]).length).toBe(1);
      expect(((await get(other, '/api/delivery-vehicles').expect(200)).body as unknown[]).length).toBe(0);
    });

    it('muatan dihitung dari berat barang; melebihi kapasitas menahan keberangkatan kecuali Admin/Pemilik dengan alasan', async () => {
      const sj1 = await mkSj('K1', [[heavy, 2]]); // 50 kg
      const sj2 = await mkSj('K2', [[heavy, 2], [light, 3]]); // 50 kg + barang tanpa berat
      const sj3 = await mkSj('K3', [[heavy, 2]]); // 50 kg → total 150 kg > 100 kg
      const t = (await post(wh, '/api/delivery-trips', { vehicleId: veh.id, deliveryIds: [sj1, sj2, sj3] }).expect(201)).body;
      expect(t.vehicle).toBe('B 1 CAP');
      expect(t.driverName).toBe('Pak Amir'); // pengemudi bawaan kendaraan
      const d = (await get(wh, `/api/delivery-trips/${t.id}`).expect(200)).body;
      expect(d).toMatchObject({ loadKg: 150, capacityKg: 100, overCapacity: true, unweightedProducts: 1 });

      const r1 = await post(wh, `/api/delivery-trips/${t.id}/depart`);
      expect(r1.status).toBe(400);
      expect(r1.body.message).toContain('melebihi kapasitas');
      await post(admin, `/api/delivery-trips/${t.id}/depart`).expect(400); // tanpa pernyataan
      await post(admin, `/api/delivery-trips/${t.id}/depart`, { acceptOverCapacity: true }).expect(400); // tanpa alasan
      await post(wh, `/api/delivery-trips/${t.id}/depart`, { acceptOverCapacity: true, reason: 'Muat dua kali jalan' }).expect(400); // Gudang tidak berwenang
      // melepas satu stop → muatan 100 kg = kapasitas → boleh berangkat tanpa pengecualian
      const stops = d.stops as { id: string; deliveryId: string }[];
      await post(wh, `/api/delivery-trips/${t.id}/stops/${stops[2].id}/remove`).expect(201);
      const ok = (await post(wh, `/api/delivery-trips/${t.id}/depart`).expect(201)).body;
      expect(ok).toMatchObject({ status: 'ON_ROUTE', loadKg: 100, overCapacity: false, overCapacityReason: null });
    });

    it('berangkat melebihi kapasitas oleh Admin dengan alasan tercatat di rute', async () => {
      const a = await mkSj('K4', [[heavy, 3]]); // 75 kg
      const b = await mkSj('K5', [[heavy, 2]]); // 50 kg
      const t = (await post(wh, '/api/delivery-trips', { vehicleId: veh.id, deliveryIds: [a, b] }).expect(201)).body;
      const r = (await post(admin, `/api/delivery-trips/${t.id}/depart`, { acceptOverCapacity: true, reason: 'Pelanggan mendesak, kendaraan cadangan tiba siang' }).expect(201)).body;
      expect(r.overCapacityReason).toContain('kendaraan cadangan');
      expect(r.status).toBe('ON_ROUTE');
    });

    it('kendaraan tidak aktif atau milik perusahaan lain tidak bisa dipakai', async () => {
      await post(wh, `/api/delivery-vehicles/${veh.id}`, { plate: 'B 1 CAP', isActive: false }).expect(201);
      expect((await post(wh, '/api/delivery-trips', { vehicleId: veh.id })).status).toBe(400);
      expect((await post(other, '/api/delivery-trips', { vehicleId: veh.id })).status).toBe(400);
      await post(wh, `/api/delivery-vehicles/${veh.id}`, { plate: 'B 1 CAP', isActive: true }).expect(201);
    });
  });

  describe('jarak jalan', () => {
    const A = { lat: -6.2, lng: 106.8 };
    const B = { lat: -6.21, lng: 106.81 };
    const C = { lat: -6.9, lng: 107.6 };
    let ids: string[] = [];
    beforeAll(async () => {
      ids = [await mkSj('RA', [[heavy, 1]], A), await mkSj('RB', [[heavy, 1]], B), await mkSj('RC', [[heavy, 1]], C)];
    });

    it('tanpa ROUTING_URL: garis lurus (A → B → C) dan sumber jarak dicatat', async () => {
      delete process.env.ROUTING_URL;
      const t = (await post(wh, '/api/delivery-trips', { deliveryIds: [ids[0], ids[1], ids[2]] }).expect(201)).body;
      const o = (await post(wh, `/api/delivery-trips/${t.id}/optimize`).expect(201)).body;
      expect(o.stops.map((s: { customerName: string }) => s.customerName)).toEqual(['Toko RA', 'Toko RB', 'Toko RC']);
      expect(o.distanceSource).toBe('LURUS');
      const want = haversineM(A.lat, A.lng, B.lat, B.lng) + haversineM(B.lat, B.lng, C.lat, C.lng);
      expect(Math.abs(o.distanceM - want)).toBeLessThan(5);
      await post(wh, `/api/delivery-trips/${t.id}/cancel`, { reason: 'uji' }).expect(201);
    });

    it('dengan layanan peta: jarak jalan dipakai (A → C → B karena jalan A–B memutar)', async () => {
      process.env.ROUTING_URL = osrmUrl;
      const t = (await post(wh, '/api/delivery-trips', { deliveryIds: [ids[0], ids[1], ids[2]] }).expect(201)).body;
      const o = (await post(wh, `/api/delivery-trips/${t.id}/optimize`).expect(201)).body;
      expect(o.stops.map((s: { customerName: string }) => s.customerName)).toEqual(['Toko RA', 'Toko RC', 'Toko RB']);
      expect(o.distanceSource).toBe('JALAN');
      const want = haversineM(A.lat, A.lng, C.lat, C.lng) + haversineM(C.lat, C.lng, B.lat, B.lng);
      expect(Math.abs(o.distanceM - want)).toBeLessThan(5);
      await post(wh, `/api/delivery-trips/${t.id}/cancel`, { reason: 'uji' }).expect(201);
    });

    it('layanan peta mati atau salah: kembali ke garis lurus tanpa galat', async () => {
      process.env.ROUTING_URL = 'http://127.0.0.1:1';
      const t = (await post(wh, '/api/delivery-trips', { deliveryIds: [ids[0], ids[1], ids[2]] }).expect(201)).body;
      const o = (await post(wh, `/api/delivery-trips/${t.id}/optimize`).expect(201)).body;
      expect(o.distanceSource).toBe('LURUS');
      expect(o.stops.map((s: { customerName: string }) => s.customerName)).toEqual(['Toko RA', 'Toko RB', 'Toko RC']);
      await post(wh, `/api/delivery-trips/${t.id}/cancel`, { reason: 'uji' }).expect(201);
      delete process.env.ROUTING_URL;
    });
  });

  describe('lokasi GPS dan bukti terima', () => {
    let trip: { id: string };
    let stops: { id: string; customerName: string }[] = [];
    const home = { lat: -6.3, lng: 106.9 };
    beforeAll(async () => {
      const ids = [await mkSj('G1', [[heavy, 1]], home), await mkSj('G2', [[heavy, 1]], home), await mkSj('G3', [[heavy, 1]], home)];
      trip = (await post(wh, '/api/delivery-trips', { deliveryIds: ids }).expect(201)).body;
      stops = (await get(wh, `/api/delivery-trips/${trip.id}`).expect(200)).body.stops;
    });

    it('lokasi hanya bisa dibagikan saat rute berjalan; koordinat divalidasi; terlihat di rute; lintas perusahaan ditolak', async () => {
      const r = await post(wh, `/api/delivery-trips/${trip.id}/position`, { lat: -6.3, lng: 106.9 });
      expect(r.status).toBe(400);
      await post(wh, `/api/delivery-trips/${trip.id}/depart`).expect(201);
      await post(wh, `/api/delivery-trips/${trip.id}/position`, { lat: 123, lng: 106.9 }).expect(400);
      await post(sales, `/api/delivery-trips/${trip.id}/position`, { lat: -6.3, lng: 106.9 }).expect(403);
      await post(other, `/api/delivery-trips/${trip.id}/position`, { lat: -6.3, lng: 106.9 }).expect(404);
      await post(wh, `/api/delivery-trips/${trip.id}/position`, { lat: -6.301, lng: 106.901 }).expect(201);
      const d = (await get(sales, `/api/delivery-trips/${trip.id}`).expect(200)).body;
      expect(Number(d.lastLat)).toBeCloseTo(-6.301, 3);
      expect(d.lastPositionAt).toBeTruthy();
    });

    it('terkirim dengan lokasi: jarak dari pelanggan dihitung; jauh (> 300 m) ditandai dan masuk kontrol', async () => {
      await post(wh, `/api/delivery-trips/${trip.id}/stops/${stops[0].id}/result`, { result: 'DELIVERED', receivedBy: 'Budi', lat: -6.3 }).expect(400); // lintang tanpa bujur
      const near = (await post(wh, `/api/delivery-trips/${trip.id}/stops/${stops[0].id}/result`, { result: 'DELIVERED', receivedBy: 'Budi', lat: -6.3002, lng: 106.9002 }).expect(201)).body;
      const s0 = near.stops.find((s: { id: string }) => s.id === stops[0].id);
      expect(s0.resultDistanceM).toBeLessThan(50);
      expect(s0.farFromCustomer).toBe(false);
      const far = (await post(wh, `/api/delivery-trips/${trip.id}/stops/${stops[1].id}/result`, { result: 'DELIVERED', receivedBy: 'Sari', lat: -6.35, lng: 106.95 }).expect(201)).body;
      const s1 = far.stops.find((s: { id: string }) => s.id === stops[1].id);
      expect(s1.resultDistanceM).toBeGreaterThan(300);
      expect(s1.farFromCustomer).toBe(true);
      const c = (await get(wh, '/api/delivery-trips/controls').expect(200)).body;
      expect(c.farDelivered.map((f: { customer: string }) => f.customer)).toEqual(['Toko G2']);
    });

    it('foto dan tanda tangan: format dan ukuran divalidasi, hanya untuk terkirim, dibaca terpisah dengan izin dan isolasi', async () => {
      const url = `/api/delivery-trips/${trip.id}/stops/${stops[2].id}/result`;
      await post(wh, url, { result: 'DELIVERED', receivedBy: 'Dewi', photo: 'data:text/html;base64,PGh0bWw+' }).expect(400);
      await post(wh, url, { result: 'DELIVERED', receivedBy: 'Dewi', signature: 'bukan-gambar' }).expect(400);
      await post(wh, url, { result: 'DELIVERED', receivedBy: 'Dewi', photo: `data:image/png;base64,${'A'.repeat(460_000)}` }).expect(400);
      await post(wh, url, { result: 'FAILED', failReason: 'Tutup', photo: PNG }).expect(400); // foto bukan untuk gagal kirim
      const ok = (await post(wh, url, { result: 'DELIVERED', receivedBy: 'Dewi', photo: PNG, signature: PNG }).expect(201)).body;
      const s2 = ok.stops.find((s: { id: string }) => s.id === stops[2].id);
      expect(s2).toMatchObject({ hasPhoto: true, hasSignature: true });
      expect(JSON.stringify(ok)).not.toContain('base64'); // isi gambar tidak ikut daftar rute
      const proof = (await get(sales, `/api/delivery-trips/${trip.id}/stops/${stops[2].id}/proof`).expect(200)).body;
      expect(proof).toEqual({ photo: PNG, signature: PNG });
      await get(cashier, `/api/delivery-trips/${trip.id}/stops/${stops[2].id}/proof`).expect(403);
      await get(other, `/api/delivery-trips/${trip.id}/stops/${stops[2].id}/proof`).expect(404);
      await post(wh, `/api/delivery-trips/${trip.id}/complete`).expect(201);
    });
  });
});
