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
