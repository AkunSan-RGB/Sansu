/**
 * Form produk per jenis usaha: semua isian pilihan (kategori, satuan) hanya dari daftar; bidang yang tampil mengikuti jenis usaha;
 * kategori baru ditambahkan Admin; data lama (kategori/satuan di luar daftar) tetap bisa dipakai.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Form produk per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tok: Record<string, string> = {};
  const tenant: Record<string, string> = {};
  const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'];
  const post = (m: string, url: string, body: object = {}, t = tok[m]) => http.post(url).set(as(t)).send(body);
  const get = (m: string, url: string) => http.get(url).set(as(tok[m]));
  const opts = async (m: string) => (await get(m, '/api/products/options').expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    for (const m of MODELS) {
      const r = (await http.post('/api/auth/register').send({ companyName: `PT ${m}`, name: 'Pemilik', email: `fp-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body;
      tok[m] = r.accessToken;
      tenant[m] = r.user.tenantId;
    }
  });
  afterAll(() => app.close());

  it('pilihan form berbeda per jenis usaha', async () => {
    const o = Object.fromEntries(await Promise.all(MODELS.map(async (m) => [m, await opts(m)])));
    expect(o.FMCG.form).toMatchObject({ barcode: true, packs: true, menu: false, semi: false, shelfLife: false });
    expect(o.FMCG.categories.map((c: { value: string }) => c.value)).toContain('Mi & Pasta');
    expect(o.FMCG.packUoms.map((u: { value: string }) => u.value)).toEqual(expect.arrayContaining(['DUS', 'KARTON', 'RENTENG']));
    expect(o.JASA.form).toMatchObject({ barcode: false, menu: false, semi: false });
    expect(o.JASA.baseUoms[0].value).toBe('JAM');
    expect(o.FNB.form).toMatchObject({ menu: true, semi: true, shelfLife: true });
    expect(o.FNB.baseUoms[0].value).toBe('PORSI');
    expect(o.MANUFAKTUR.form).toMatchObject({ menu: false, semi: true, shelfLife: true });
    expect(o.DAGANG.form.menu).toBe(false);
    expect(o.RITEL.baseUoms[0].value).toBe('PCS');
  });

  it('FMCG: kategori dan satuan hanya dari daftar; bidang yang bukan untuk FMCG ditolak', async () => {
    const p = (extra: object) => post('FMCG', '/api/products', { sku: `F${Math.random().toString(36).slice(2, 8)}`, name: 'Mi Goreng 85g', sellPrice: '3500', ...extra });
    expect((await p({ category: 'Ketik Sendiri' })).status).toBe(400);
    expect((await p({ baseUom: 'GR' })).status).toBe(400); // bukan kode baku (GRAM)
    expect((await p({ uoms: [{ uom: 'DOS', factor: '40' }] })).status).toBe(400);
    expect((await p({ madeToOrder: true })).status).toBe(400);
    expect((await p({ shelfLifeDays: 30 })).status).toBe(400);
    const ok = await p({ category: 'mi & pasta', baseUom: 'PCS', barcode: '8991234567890', uoms: [{ uom: 'DUS', factor: '40' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.category).toBe('Mi & Pasta'); // ejaan baku dari daftar
    expect(ok.body.uoms[0].uom).toBe('DUS');
  });

  it('JASA tanpa barcode; F&B boleh menu dan umur simpan; bidang menu ditolak di jenis usaha lain', async () => {
    expect((await post('JASA', '/api/products', { sku: 'S1', name: 'Konsultasi', sellPrice: '300000', baseUom: 'JAM', category: 'Konsultasi', barcode: '123' })).status).toBe(400);
    expect((await post('JASA', '/api/products', { sku: 'S1', name: 'Konsultasi', sellPrice: '300000', baseUom: 'JAM', category: 'Konsultasi' })).status).toBe(201);
    expect((await post('FNB', '/api/products', { sku: 'M1', name: 'Kopi Susu', sellPrice: '25000', baseUom: 'GELAS', category: 'Minuman', madeToOrder: true })).status).toBe(201);
    expect((await post('FNB', '/api/products', { sku: 'R1', name: 'Roti', sellPrice: '9000', baseUom: 'PCS', category: 'Roti & kue', shelfLifeDays: 3 })).status).toBe(201);
    for (const m of ['DAGANG', 'RITEL', 'MANUFAKTUR']) {
      expect((await post(m, '/api/products', { sku: 'M2', name: 'Menu', sellPrice: '1000', madeToOrder: true })).status).toBe(400);
    }
  });

  it('kategori baru ditambahkan Admin, bukan lewat form produk; ejaan ganda ditolak; peran lain tidak boleh', async () => {
    expect((await post('FMCG', '/api/products', { sku: 'N1', name: 'Es Krim', sellPrice: '5000', category: 'Es Krim' })).status).toBe(400);
    expect((await post('FMCG', '/api/products/categories', { name: 'es krim' })).status).toBe(201);
    expect((await post('FMCG', '/api/products/categories', { name: 'Es Krim' })).status).toBe(400); // sudah ada
    expect((await post('FMCG', '/api/products/categories', { name: 'mi & pasta' })).status).toBe(400); // sama dengan bawaan
    expect((await opts('FMCG')).categories.find((c: { value: string }) => c.value === 'es krim').source).toBe('CUSTOM');
    expect((await post('FMCG', '/api/products', { sku: 'N1', name: 'Es Krim', sellPrice: '5000', category: 'Es Krim' })).status).toBe(201);
    await post('FMCG', '/api/users', { name: 'Sales', email: `fp-s-${stamp}@uji.id`, password: 'rahasia12345', role: 'SALES' }).expect(201);
    const s = (await http.post('/api/auth/login').send({ email: `fp-s-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    expect((await post('FMCG', '/api/products/categories', { name: 'Lain' }, s)).status).toBe(403);
  });

  it('data lama di luar daftar tetap bisa dipakai dan tidak memblokir edit', async () => {
    await db.execute(sql`INSERT INTO products (tenant_id, sku, name, category, base_uom, sell_price) VALUES (${tenant.DAGANG}, 'LAMA', 'Barang Lama', 'Kategori Lama', 'GR', '1000')`);
    const o = await opts('DAGANG');
    expect(o.categories.find((c: { value: string }) => c.value === 'Kategori Lama').source).toBe('USED');
    expect(o.baseUoms.map((u: { value: string }) => u.value)).toContain('GR');
    const list = (await get('DAGANG', '/api/products').expect(200)).body as { id: string; sku: string }[];
    const lama = list.find((x) => x.sku === 'LAMA')!;
    await http.patch(`/api/products/${lama.id}`).set(as(tok.DAGANG)).send({ sellPrice: '2000', category: 'Kategori Lama', baseUom: 'GR' }).expect(200);
    expect((await http.patch(`/api/products/${lama.id}`).set(as(tok.DAGANG)).send({ category: 'Bebas Ketik' })).status).toBe(400);
  });

  it('mengganti nama / menggabung kategori mendaftarkan nama tujuan ke daftar pilihan', async () => {
    await post('RITEL', '/api/products', { sku: 'K1', name: 'Kopi', sellPrice: '1000', category: 'Minuman' }).expect(201);
    await post('RITEL', '/api/products/categories/merge', { from: ['Minuman'], to: 'Minuman Dingin' }).expect(201);
    expect((await opts('RITEL')).categories.some((c: { value: string }) => c.value === 'Minuman Dingin')).toBe(true);
  });
});
