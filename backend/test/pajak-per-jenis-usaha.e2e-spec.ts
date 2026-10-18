/**
 * Daftar periksa pajak sesuai jenis usaha: butir yang diperiksa berbeda per jenis usaha dan memakai data nyata perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BUSINESS_MODEL_KEYS, TAX_FOCUS } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pajak per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const reg = async (model: string, tag: string) => (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'P', email: `pjk-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
  const focus = async (t: string) => (await http.get('/api/tax/focus').set(as(t)).expect(200)).body as { model: string; focus: { points: string[] }; checks: { key: string; status: string; detail: string }[] };

  it('tiap jenis usaha punya fokus pajak sendiri', async () => {
    expect(new Set(BUSINESS_MODEL_KEYS.map((m) => TAX_FOCUS[m].title)).size).toBe(BUSINESS_MODEL_KEYS.length);
    for (const m of BUSINESS_MODEL_KEYS) {
      const t = await reg(m, `fokus-${m.toLowerCase()}`);
      const f = await focus(t);
      expect(f.model).toBe(m);
      expect(f.focus.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('F&B: PB1 menyala bawaan (OK); dimatikan tanpa penjualan → INFO', async () => {
    const t = await reg('FNB', 'pb1');
    expect((await focus(t)).checks.find((c) => c.key === 'PB1_BELUM_AKTIF')!.status).toBe('OK');
    await http.patch('/api/settings/company').set(as(t)).send({ localTaxEnabled: false }).expect(200);
    expect((await focus(t)).checks.find((c) => c.key === 'PB1_BELUM_AKTIF')!.status).toBe('INFO');
    expect((await focus(t)).checks.map((c) => c.key)).toContain('HARGA_KASIR_PPN');
  });

  it('Dagang: PPN masukan dari pemasok tanpa NPWP ditandai; setelah NPWP dilengkapi menjadi OK', async () => {
    const t = await reg('DAGANG', 'ppnin');
    const wh = (await http.get('/api/warehouses').set(as(t)).expect(200)).body[0].id;
    const prod = (await http.post('/api/products').set(as(t)).send({ sku: 'D1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const sup = (await http.post('/api/suppliers').set(as(t)).send({ code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    const po = (await http.post('/api/purchase-orders').set(as(t)).send({ supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '10', price: '5000' }] }).expect(201)).body;
    await http.post(`/api/purchase-orders/${po.id}/confirm`).set(as(t)).expect(201);
    await http.post('/api/purchase-invoices').set(as(t)).send({ purchaseOrderId: po.id, supplierInvoiceNo: 'X-1' }).expect(201);
    const before = (await focus(t)).checks.find((c) => c.key === 'PPN_MASUKAN_TANPA_NPWP')!;
    expect(before.status).toBe('PERLU');
    expect(before.detail).toMatch(/1 faktur/);
    await http.patch(`/api/suppliers/${sup}`).set(as(t)).send({ npwp: '01.234.567.8-901.000' }).expect(200);
    expect((await focus(t)).checks.find((c) => c.key === 'PPN_MASUKAN_TANPA_NPWP')!.status).toBe('OK');
  });

  it('butir pajak khusus: Jasa tidak melihat butir barang; Manufaktur melihat maklon', async () => {
    const jasa = await focus(await reg('JASA', 'jasa-chk'));
    expect(jasa.checks.map((c) => c.key)).toContain('JASA_TANPA_POTONGAN');
    expect(jasa.checks.map((c) => c.key)).not.toContain('PPN_MASUKAN_TANPA_NPWP');
    const mfg = await focus(await reg('MANUFAKTUR', 'mfg-chk'));
    expect(mfg.checks.map((c) => c.key)).toEqual(expect.arrayContaining(['MAKLON_POTONGAN', 'PPN_MASUKAN_TANPA_NPWP']));
    // peran tanpa akses pajak ditolak
    const owner = await reg('DAGANG', 'peran');
    await http.post('/api/users').set(as(owner)).send({ name: 'hr', email: `pjk-hr-${stamp}@uji.id`, password: 'rahasia12345', role: 'HR' }).expect(201);
    const hr = (await http.post('/api/auth/login').send({ email: `pjk-hr-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    expect((await http.get('/api/tax/focus').set(as(hr))).status).toBe(403);
    void today;
  });
});
