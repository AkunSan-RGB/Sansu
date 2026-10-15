/** Kategori produk (e2e): dirapikan dan disamakan ejaannya per perusahaan (tambah, ubah, kosongkan, impor), terpisah antar perusahaan */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Kategori produk (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  const stamp = Date.now();
  const as = (tok = t) => ({ Authorization: `Bearer ${tok}` });
  const mk = (sku: string, category?: string, tok = t) => http.post('/api/products').set(as(tok)).send({ sku, name: sku, sellPrice: '1000', ...(category === undefined ? {} : { category }) });
  const cats = async (tok = t) => ((await http.get('/api/products').set(as(tok)).expect(200)).body as { sku: string; category: string | null }[]).reduce<Record<string, string | null>>((a, p) => ({ ...a, [p.sku]: p.category }), {});

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    t = (await http.post('/api/auth/register').send({ companyName: 'PT Kategori', name: 'Pemilik', email: `kt-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  it('kategori dirapikan dan disamakan dengan ejaan yang sudah ada (huruf besar/kecil, spasi)', async () => {
    await mk('A1', 'Minuman').expect(201);
    await mk('A2', '  minuman  ').expect(201);
    await mk('A3', 'MINUMAN').expect(201);
    await mk('A4', 'Makanan   Ringan').expect(201);
    await mk('A5', 'makanan ringan').expect(201);
    await mk('A6').expect(201);
    await mk('A7', '   ').expect(201);
    const c = await cats();
    expect(c).toMatchObject({ A1: 'Minuman', A2: 'Minuman', A3: 'Minuman', A4: 'Makanan Ringan', A5: 'Makanan Ringan', A6: null, A7: null });
  });

  it('ubah: kategori baru dipakai apa adanya, kosong mengosongkan, tidak diisi tidak mengubah', async () => {
    const id = (await http.get('/api/products').set(as()).expect(200)).body.find((p: { sku: string }) => p.sku === 'A1').id;
    await http.patch(`/api/products/${id}`).set(as()).send({ category: 'Camilan' }).expect(200);
    expect((await cats()).A1).toBe('Camilan');
    await http.patch(`/api/products/${id}`).set(as()).send({ name: 'Baru' }).expect(200);
    expect((await cats()).A1).toBe('Camilan');
    await http.patch(`/api/products/${id}`).set(as()).send({ category: 'camilan' }).expect(200);
    expect((await cats()).A1).toBe('Camilan');
    await http.patch(`/api/products/${id}`).set(as()).send({ category: '' }).expect(200);
    expect((await cats()).A1).toBeNull();
  });

  it('terlalu panjang ditolak', async () => {
    await mk('A8', 'x'.repeat(61)).expect(400);
  });

  it('impor Excel: kategori disamakan dengan yang ada dan antar baris file', async () => {
    const rows = [
      { sku: 'I1', nama: 'Impor 1', harga_jual: 1000, kategori: 'minuman' },
      { sku: 'I2', nama: 'Impor 2', harga_jual: 1000, kategori: 'Frozen Food' },
      { sku: 'I3', nama: 'Impor 3', harga_jual: 1000, kategori: 'frozen  food' },
      { sku: 'I4', nama: 'Impor 4', harga_jual: 1000 },
    ];
    const r = await http.post('/api/imports').set(as()).send({ kind: 'products', rows, dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body.applied ?? r.body.results?.length).toBeTruthy();
    const c = await cats();
    expect(c).toMatchObject({ I1: 'Minuman', I2: 'Frozen Food', I3: 'Frozen Food', I4: null });
  });

  it('antar perusahaan terpisah: ejaan satu perusahaan tidak memengaruhi yang lain', async () => {
    const t2 = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'Pemilik', email: `kt2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await mk('B1', 'minuman', t2).expect(201);
    expect((await cats(t2)).B1).toBe('minuman');
  });
});

describe('Kelola kategori produk (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  let cashier: string;
  const stamp = Date.now();
  const as = (tok = t) => ({ Authorization: `Bearer ${tok}` });
  const cats = async () => ((await http.get('/api/products').set(as()).expect(200)).body as { sku: string; category: string | null }[]).reduce<Record<string, string | null>>((a, p) => ({ ...a, [p.sku]: p.category }), {});
  const sql = (q: string, p: unknown[] = []) => pool.query(q, p);
  let pool: import('pg').Pool;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    t = (await http.post('/api/auth/register').send({ companyName: 'PT Gabung Kategori', name: 'Pemilik', email: `gk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await http.post('/api/users').set(as()).send({ name: 'Kasir', email: `gk-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `gk-k-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
    // data lama yang terlanjur terpecah (ditulis langsung ke database)
    const tid = (await http.get('/api/auth/me').set(as())).body.tenantId;
    for (const [sku, c] of [['G1', 'Minuman'], ['G2', 'minuman'], ['G3', 'MINUMAN'], ['G4', 'Minuman'], ['G5', 'Snack'], ['G6', ' snack ']]) {
      await sql(`INSERT INTO products (tenant_id, sku, name, category, base_uom, sell_price) VALUES ($1, $2, $2, $3, 'PCS', 1000)`, [tid, sku, c]);
    }
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('daftar kategori dan usulan penyatuan ejaan ganda', async () => {
    const r = (await http.get('/api/products/categories').set(as()).expect(200)).body as { items: { name: string; count: number }[]; duplicates: { suggested: string; variants: { name: string; count: number }[] }[] };
    expect(r.items.find((i) => i.name === 'Minuman')?.count).toBe(2);
    const min = r.duplicates.find((d) => d.suggested === 'Minuman')!;
    expect(min.variants.map((v) => v.name).sort()).toEqual(['MINUMAN', 'Minuman', 'minuman']);
    expect(r.duplicates.find((d) => d.suggested === 'Snack')).toBeTruthy(); // 'Snack' dan ' snack ' satu kelompok; ejaan campuran didahulukan
  });

  it('hanya Admin/Pemilik yang menggabungkan; kasir ditolak', async () => {
    await http.post('/api/products/categories/merge').set(as(cashier)).send({ from: ['minuman'], to: 'Minuman' }).expect(403);
    await http.get('/api/products/categories').set(as(cashier)).expect(200);
  });

  it('pratinjau tidak mengubah data; penyatuan memindahkan semua varian', async () => {
    const pre = (await http.post('/api/products/categories/merge').set(as()).send({ from: ['minuman', 'MINUMAN'], to: 'Minuman', dryRun: true }).expect(201)).body;
    expect(pre).toMatchObject({ updated: 2, dryRun: true });
    expect((await cats()).G2).toBe('minuman');
    const done = (await http.post('/api/products/categories/merge').set(as()).send({ from: ['minuman', 'MINUMAN'], to: 'Minuman' }).expect(201)).body;
    expect(done).toMatchObject({ updated: 2, to: 'Minuman' });
    expect(await cats()).toMatchObject({ G1: 'Minuman', G2: 'Minuman', G3: 'Minuman', G4: 'Minuman' });
  });

  it('ganti nama: tujuan baru dipakai; tujuan yang sama dengan kategori lain memakai ejaan yang ada; kosong = hapus kategori', async () => {
    await http.post('/api/products/categories/merge').set(as()).send({ from: ['Snack', ' snack '], to: 'Camilan' }).expect(201);
    expect(await cats()).toMatchObject({ G5: 'Camilan', G6: 'Camilan' });
    await http.post('/api/products/categories/merge').set(as()).send({ from: ['Camilan'], to: 'minuman' }).expect(201); // sudah ada "Minuman"
    expect(await cats()).toMatchObject({ G5: 'Minuman', G6: 'Minuman' });
    await http.post('/api/products/categories/merge').set(as()).send({ from: ['Minuman'], to: null }).expect(201);
    expect(Object.values(await cats()).every((c) => c === null)).toBe(true);
    await http.post('/api/products/categories/merge').set(as()).send({ from: [] }).expect(400);
  });

  it('tidak menyentuh perusahaan lain', async () => {
    const t2 = (await http.post('/api/auth/register').send({ companyName: 'PT Lain Kat', name: 'Pemilik', email: `gk2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await http.post('/api/products').set(as(t2)).send({ sku: 'Z1', name: 'Z1', sellPrice: '1000', category: 'Minuman' }).expect(201);
    await http.post('/api/products/categories/merge').set(as()).send({ from: ['Minuman'], to: 'Lain' }).expect(201);
    const z = (await http.get('/api/products').set(as(t2)).expect(200)).body.find((p: { sku: string }) => p.sku === 'Z1');
    expect(z.category).toBe('Minuman');
  });
});
