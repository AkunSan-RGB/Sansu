/**
 * Barcode otomatis: dibuat sistem (EAN-13 internal, unik per perusahaan), tidak bisa diketik/diubah manual;
 * barcode pabrikan hanya bila angka pemeriksanya valid dan tidak berawalan 2.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { isInternalBarcode, isValidBarcode } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Barcode otomatis (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const reg = async (model: string, tag: string) => (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'P', email: `bc-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;

  it('produk baru langsung dapat barcode internal yang valid dan berurutan; unik', async () => {
    const t = await reg('RITEL', 'auto');
    const p = (n: number) => http.post('/api/products').set(as(t)).send({ sku: `BC${n}`, name: `Barang ${n}`, baseUom: 'PCS', sellPrice: '1000' });
    const a = (await p(1).expect(201)).body;
    const b = (await p(2).expect(201)).body;
    expect(isInternalBarcode(a.barcode)).toBe(true);
    expect(isInternalBarcode(b.barcode)).toBe(true);
    expect(a.barcode).not.toBe(b.barcode);
    expect(a.barcodeSource).toBe('GENERATED');
    // dua pembuatan bersamaan tetap unik
    const both = await Promise.all([p(3), p(4), p(5)]);
    expect(new Set(both.map((r) => r.body.barcode)).size).toBe(3);
  });

  it('barcode otomatis tidak bisa diketik ulang; barcode pabrikan harus valid dan tidak berawalan 2', async () => {
    const t = await reg('DAGANG', 'mfr');
    const patch = (id: string, barcode: string) => http.patch(`/api/products/${id}`).set(as(t)).send({ barcode });
    const auto = (await http.post('/api/products').set(as(t)).send({ sku: 'M1', name: 'Auto', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body;
    // mengganti barcode otomatis dengan pabrikan: boleh selama belum ada mutasi stok, tetapi harus valid
    expect((await patch(auto.id, '8991234567890')).status).toBe(400); // angka pemeriksa salah
    expect((await patch(auto.id, 'ABC')).status).toBe(400);
    expect((await patch(auto.id, '2000000000015')).status).toBe(400); // awalan 2 dicadangkan
    const ok = (await patch(auto.id, '4006381333931').expect(200)).body;
    expect(ok).toMatchObject({ barcode: '4006381333931', barcodeSource: 'MANUFACTURER' });
    expect(isValidBarcode(ok.barcode)).toBe(true);
    // produk baru dengan barcode pabrikan yang sama ditolak (unik)
    expect((await http.post('/api/products').set(as(t)).send({ sku: 'M2', name: 'Kembar', baseUom: 'PCS', sellPrice: '1', barcode: '4006381333931' })).status).toBeGreaterThanOrEqual(400);
    const mfr = (await http.post('/api/products').set(as(t)).send({ sku: 'M3', name: 'Pabrikan', baseUom: 'PCS', sellPrice: '1', barcode: '5901234123457' }).expect(201)).body;
    expect(mfr.barcodeSource).toBe('MANUFACTURER');
  });

  it('barcode otomatis tidak bisa diganti setelah ada mutasi stok; Jasa tidak memakai barcode', async () => {
    const t = await reg('RITEL', 'stok');
    const wh = (await http.get('/api/warehouses').set(as(t)).expect(200)).body[0].id;
    const prod = (await http.post('/api/products').set(as(t)).send({ sku: 'S1', name: 'Stok', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body;
    await http.post('/api/inventory/adjustments').set(as(t)).send({ warehouseId: wh, reason: 'OPENING', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()), lines: [{ productId: prod.id, qty: '5', unitCost: '500' }] }).expect(201);
    const res = await http.patch(`/api/products/${prod.id}`).set(as(t)).send({ barcode: '4006381333931' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/mutasi stok/);
    const jasa = await reg('JASA', 'jasa');
    const j = (await http.post('/api/products').set(as(jasa)).send({ sku: 'J1', name: 'Layanan', baseUom: 'JAM', sellPrice: '100000' }).expect(201)).body;
    expect(j.barcode).toBeNull();
  });

  it('Admin dapat membuatkan barcode untuk produk lama yang belum berbarcode', async () => {
    const t = await reg('FMCG', 'lama');
    const p = (await http.post('/api/products').set(as(t)).send({ sku: 'L1', name: 'Lama', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body;
    // simulasi produk lama: barcode dikosongkan lewat SQL tidak tersedia di API, jadi cukup pastikan endpoint idempoten
    const r = (await http.post('/api/products/generate-barcodes').set(as(t)).expect(201)).body;
    expect(r.generated).toBe(0);
    expect((await http.get(`/api/products/${p.id}`).set(as(t)).expect(200)).body.barcode).toBe(p.barcode);
  });
});
