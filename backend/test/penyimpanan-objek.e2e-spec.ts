/**
 * Penyimpanan objek untuk foto meter dan bukti kirim: gambar masuk bucket (basis data hanya menyimpan rujukan), keluar lewat
 * endpoint berizin, terisolasi antar perusahaan, ikut terhapus bersama data perusahaan, dan gambar lama dapat dipindahkan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { createPool } from '../src/db/db';
import { moveImagesToStorage } from '../src/db/migrate-storage';
import { StorageService } from '../src/common/storage/storage.service';
import { eraseTenant } from '../src/modules/data-rights/erase';
import { createDb } from '../src/db/db';
import { S3Stub, startS3Stub } from './helpers/s3-stub';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FAKE_PNG = `data:image/png;base64,${Buffer.from('<html>bukan gambar</html>').toString('base64')}`;

describe('Penyimpanan objek (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let s3: S3Stub;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  let owner = ''; let field = ''; let fin = ''; let other = '';
  let ownerTenant = '';
  const conns: string[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const stored = (prefix: string) => [...s3.objects.keys()].filter((k) => k.startsWith(prefix));

  beforeAll(async () => {
    s3 = await startS3Stub('bukti-uji');
    Object.assign(process.env, { STORAGE_ENDPOINT: s3.url, STORAGE_BUCKET: 'bukti-uji', STORAGE_ACCESS_KEY_ID: 'k', STORAGE_SECRET_ACCESS_KEY: 's' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Simpan', name: 'Pemilik', email: `ps-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `ps-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `ps-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    field = await mk('WAREHOUSE', 'lap');
    other = (await http.post('/api/auth/register').send({ companyName: 'PAM Lain', name: 'Lain', email: `ps-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const cu = (await post('/api/customers', { code: 'P1', name: 'Budi', paymentTermDays: 20 }).expect(201)).body.id;
    const tariff = (await post('/api/utility/tariffs', { name: 'Air', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (const n of [1, 2, 3, 4]) conns.push((await post('/api/utility/connections', { customerId: cu, tariffId: tariff, address: `Blok ${n}`, meterNo: `PS-${n}`, installedAt: `${month(4)}-05`, initialReading: '0' }, fin).expect(201)).body.id);
    ownerTenant = (await db.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM utility_connections WHERE id = ${conns[0]}`)).rows[0].tenant_id;
  });
  afterAll(async () => {
    await app.close();
    await s3.close();
    for (const k of ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY']) delete process.env[k];
  });

  const dbPhoto = async (connection: string) => (await db.execute<{ photo: string | null }>(sql`SELECT photo FROM utility_readings WHERE connection_id = ${connection}`)).rows[0].photo;

  it('foto meter masuk bucket; basis data hanya menyimpan rujukan; terbaca lewat endpoint berizin', async () => {
    const r = await post('/api/utility/field/readings', { connectionId: conns[0], period: month(3), current: '10', photo: PNG }, field).expect(201);
    expect(r.body.hasPhoto).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('base64');
    const ref = (await dbPhoto(conns[0]))!;
    expect(ref).toMatch(/^obj:[0-9a-f-]{36}\/meter\/[0-9a-f-]{36}\.png$/);
    expect(ref.length).toBeLessThan(120); // bukan data URL
    expect(stored(`${ownerTenant}/meter/`)).toHaveLength(1);
    expect((await get(`/api/utility/readings/${r.body.id}/photo`, fin).expect(200)).body.photo).toBe(PNG);
    // perusahaan lain tidak bisa membuka foto ini
    await get(`/api/utility/readings/${r.body.id}/photo`, other).expect(404);
    expect(JSON.stringify((await get(`/api/utility/readings?period=${month(3)}`, fin).expect(200)).body)).not.toContain('obj:');
  });

  it('isi berkas divalidasi: berlabel gambar tetapi bukan gambar ditolak, tidak ada berkas yatim', async () => {
    const before = s3.objects.size;
    await post('/api/utility/field/readings', { connectionId: conns[1], period: month(3), current: '5', photo: FAKE_PNG }, field).expect(400);
    expect(s3.objects.size).toBe(before);
  });

  it('pencatatan gagal setelah unggah: berkas dihapus lagi (tidak yatim)', async () => {
    const before = s3.objects.size;
    // angka turun dari catatan sebelumnya → gagal di dalam transaksi, setelah foto terunggah
    await post('/api/utility/field/readings', { connectionId: conns[0], period: month(2), current: '3', photo: PNG }, field).expect(400);
    expect(s3.objects.size).toBe(before);
  });

  it('bucket bermasalah: pencatatan dengan foto gagal bersih (bukan setengah tersimpan)', async () => {
    s3.failPut = true;
    const r = await post('/api/utility/field/readings', { connectionId: conns[1], period: month(3), current: '5', photo: PNG }, field);
    s3.failPut = false;
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect((await db.execute(sql`SELECT 1 FROM utility_readings WHERE connection_id = ${conns[1]}`)).rows).toHaveLength(0);
    // tanpa foto tetap bisa mencatat
    await post('/api/utility/field/readings', { connectionId: conns[1], period: month(3), current: '5' }, field).expect(201);
  });

  it('pemindahan gambar lama: data URL di basis data dipindah ke bucket, dibaca ulang dan dicocokkan; aman diulang', async () => {
    // gambar lama: tulis langsung sebagai data URL (seperti data sebelum fitur ini), satu lagi rusak
    await post('/api/utility/field/readings', { connectionId: conns[2], period: month(3), current: '7' }, field).expect(201);
    await post('/api/utility/field/readings', { connectionId: conns[3], period: month(3), current: '9' }, field).expect(201);
    await db.execute(sql`UPDATE utility_readings SET photo = ${PNG} WHERE connection_id = ${conns[2]}`);
    await db.execute(sql`UPDATE utility_readings SET photo = ${FAKE_PNG} WHERE connection_id = ${conns[3]}`);
    const pool = createPool();
    try {
      const storage = app.get(StorageService);
      const dry = await moveImagesToStorage(pool, storage, { dryRun: true });
      expect(dry.pending).toBeGreaterThanOrEqual(2);
      const r = await moveImagesToStorage(pool, storage);
      expect(r.moved).toBeGreaterThanOrEqual(1);
      expect(r.skipped.map((s) => s.table)).toContain('utility_readings'); // yang rusak dilewati dan dilaporkan
      expect(await dbPhoto(conns[2])).toMatch(/^obj:/);
      expect(await dbPhoto(conns[3])).toBe(FAKE_PNG); // tidak diubah
      const again = await moveImagesToStorage(pool, storage);
      expect(again.moved).toBe(0);
    } finally {
      await pool.end();
    }
    const id = (await db.execute<{ id: string }>(sql`SELECT id FROM utility_readings WHERE connection_id = ${conns[2]}`)).rows[0].id;
    expect((await get(`/api/utility/readings/${id}/photo`, fin).expect(200)).body.photo).toBe(PNG);
  });

  it('bukti kirim: foto dan tanda tangan masuk bucket, terbaca lewat endpoint berizin, terisolasi antar perusahaan', async () => {
    const t = (await http.post('/api/auth/register').send({ companyName: 'Dagang Simpan', name: 'Pemilik', email: `ps-d-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    const w = (await get('/api/warehouses', t).expect(200)).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S-PS', name: 'Pemasok' }, t).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'PS-1', name: 'Barang', sellPrice: '20000' }, t).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: w, lines: [{ productId: prod, qty: '50', price: '10000' }] }, t).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`, {}, t).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'PS-1' }, t).expect(201);
    const c = (await post('/api/customers', { code: 'C-PS', name: 'Toko PS' }, t).expect(201)).body.id;
    const so = (await post('/api/sales-orders', { customerId: c, warehouseId: w, lines: [{ productId: prod, qty: '2', price: '20000' }] }, t).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`, {}, t).expect(201);
    const sj = (await post(`/api/sales-orders/${so.id}/deliver`, {}, t).expect(201)).body.id;
    const trip = (await post('/api/delivery-trips', { deliveryIds: [sj] }, t).expect(201)).body;
    await post(`/api/delivery-trips/${trip.id}/depart`, {}, t).expect(201);
    const stop = (await get(`/api/delivery-trips/${trip.id}`, t).expect(200)).body.stops[0];
    const tenant = (await db.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM delivery_trips WHERE id = ${trip.id}`)).rows[0].tenant_id;
    const url = `/api/delivery-trips/${trip.id}/stops/${stop.id}`;
    await post(`${url}/result`, { result: 'DELIVERED', receivedBy: 'Dewi', photo: FAKE_PNG }, t).expect(400);
    expect(stored(`${tenant}/`)).toHaveLength(0);
    await post(`${url}/result`, { result: 'DELIVERED', receivedBy: 'Dewi', photo: PNG, signature: PNG }, t).expect(201);
    const row = (await db.execute<{ proof_photo: string; proof_signature: string }>(sql`SELECT proof_photo, proof_signature FROM delivery_trip_stops WHERE id = ${stop.id}`)).rows[0];
    expect(row.proof_photo).toMatch(/^obj:.*\/bukti-kirim\//);
    expect(row.proof_signature).toMatch(/^obj:.*\/tanda-tangan\//);
    expect(stored(`${tenant}/`)).toHaveLength(2);
    expect((await get(`${url}/proof`, t).expect(200)).body).toEqual({ photo: PNG, signature: PNG });
    await get(`${url}/proof`, other).expect(404);
  });

  it('penghapusan data perusahaan ikut menghapus berkas di bucket; perusahaan lain tidak tersentuh', async () => {
    const otherCu = (await post('/api/customers', { code: 'X1', name: 'Siti' }, other).expect(201)).body.id;
    const t2 = (await post('/api/utility/tariffs', { name: 'Air2', serviceType: 'AIR', fixedFee: 1000, adminFee: 0, blocks: [{ upTo: null, price: 1000 }] }, other).expect(201)).body.id;
    const c2r = await post('/api/utility/connections', { customerId: otherCu, tariffId: t2, address: 'Jalan Y No. 1', meterNo: 'Z1', installedAt: `${month(4)}-05`, initialReading: '0' }, other);
    if (c2r.status !== 201) throw new Error(JSON.stringify(c2r.body));
    const c2 = c2r.body.id;
    await post('/api/utility/field/readings', { connectionId: c2, period: month(3), current: '4', photo: PNG }, other).expect(201);
    const otherTenant = (await db.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM utility_connections WHERE id = ${c2}`)).rows[0].tenant_id;
    expect(stored(`${otherTenant}/`)).toHaveLength(1);
    expect(stored(`${ownerTenant}/`).length).toBeGreaterThanOrEqual(2);
    // penghapusan basis data lewat jalur sah, lalu penghapusan berkas (urutan sama dengan layanan penghapusan)
    const pool = createPool();
    try {
      await eraseTenant(createDb(pool), otherTenant);
    } finally {
      await pool.end();
    }
    expect(await app.get(StorageService).deleteTenant(otherTenant)).toBe(1);
    expect(stored(`${otherTenant}/`)).toHaveLength(0);
    expect(stored(`${ownerTenant}/`).length).toBeGreaterThanOrEqual(2);
  });
});
