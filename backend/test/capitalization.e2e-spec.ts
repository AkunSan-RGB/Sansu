/**
 * Batas kapitalisasi aset tetap: pembelian per unit di bawah batas langsung dibebankan (6-6100),
 * di atas/sama dengan batas didaftarkan sebagai aset. Tanah tidak pernah kena batas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Batas kapitalisasi aset (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let supplierId: string;
  const cat: Record<string, string> = {};
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const patch = (url: string, body: object = {}) => http.patch(url).set(as()).send(body);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const assetCount = async () => (await get('/api/assets').expect(200)).body.length as number;
  const setThreshold = (v: number) => patch('/api/settings/reporting', { capitalizationThreshold: v });
  let n = 0;
  const bill = (lines: object[]) => post('/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `CAP-${stamp}-${++n}`, lines });
  const assetLine = (description: string, category: string, price: string, qty?: string) => ({
    type: 'ASSET',
    description,
    assetCategoryId: cat[category],
    price,
    ...(qty ? { qty } : {}),
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'CV Batas Aset', name: 'Pemilik', email: `cap-${stamp}@uji.id`, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    supplierId = (await post('/api/suppliers', { code: 'SUP-CAP', name: 'Toko Elektronik' }).expect(201)).body.id;
    for (const c of (await get('/api/assets/categories').expect(200)).body as { id: string; name: string }[]) cat[c.name] = c.id;
  });
  afterAll(() => app.close());

  it('bawaan: batas 0 → semua pembelian aset dikapitalisasi (perilaku lama tidak berubah)', async () => {
    expect((await get('/api/settings/company').expect(200)).body.reporting.capitalizationThreshold).toBe(0);
    const before = await assetCount();
    const b = (await bill([assetLine('Printer faktur', 'Inventaris Kantor', '3200000')]).expect(201)).body;
    expect(b.expensedLines).toBe(0);
    expect(b.lines[0].assetId).toBeTruthy();
    expect(await assetCount()).toBe(before + 1);
    expect(await bal('1-2300')).toBe(3200000);
    expect(await bal('6-6100')).toBe(0);
  });

  it('batas tidak boleh negatif', async () => {
    await setThreshold(-1).expect(400);
    await setThreshold(1.5).expect(400);
  });

  it('di bawah batas → beban; di atas → aset; jurnal tetap seimbang', async () => {
    const res = await setThreshold(5000000).expect(200);
    expect(res.body.reporting.capitalizationThreshold).toBe(5000000);
    const assets0 = await assetCount();
    const asset0 = await bal('1-2300');
    const b = (
      await bill([
        assetLine('Printer label', 'Inventaris Kantor', '3200000'),
        assetLine('Laptop 14"', 'Inventaris Kantor', '11500000', '2'),
        assetLine('Kursi kerja', 'Inventaris Kantor', '400000', '10'),
      ]).expect(201)
    ).body;
    expect(b.expensedLines).toBe(2);
    expect(await assetCount()).toBe(assets0 + 2); // hanya 2 laptop
    expect((await bal('1-2300')) - asset0).toBe(23000000);
    expect(await bal('6-6100')).toBe(3200000 + 4000000);
    const [printer, laptop, chair] = b.lines;
    expect(printer.assetId).toBeNull();
    expect(printer.accountId).toBeTruthy();
    expect(laptop.assetId).toBeTruthy();
    expect(chair.assetId).toBeNull();
    expect(b.subtotal).toBe('30200000.00');
    expect(b.total).toBe('33522000.00'); // PKP: + PPN 11%, PPN Masukan tidak ikut harga perolehan
  });

  it('harga per unit persis sama dengan batas → dikapitalisasi (batas bersifat "di bawah")', async () => {
    await setThreshold(3200000).expect(200);
    const assets0 = await assetCount();
    const expense0 = await bal('6-6100');
    const b = (await bill([assetLine('Scanner', 'Inventaris Kantor', '3200000')]).expect(201)).body;
    expect(b.expensedLines).toBe(0);
    expect(await assetCount()).toBe(assets0 + 1);
    expect(await bal('6-6100')).toBe(expense0);
    const b2 = (await bill([assetLine('Scanner murah', 'Inventaris Kantor', '3199999')]).expect(201)).body;
    expect(b2.expensedLines).toBe(1);
    expect(await bal('6-6100')).toBe(expense0 + 3199999);
  });

  it('tanah tidak pernah kena batas kapitalisasi', async () => {
    await setThreshold(5000000).expect(200);
    const land0 = await bal('1-2050');
    const b = (await bill([assetLine('Tanah kavling kecil', 'Tanah', '1000000')]).expect(201)).body;
    expect(b.expensedLines).toBe(0);
    expect(b.lines[0].assetId).toBeTruthy();
    expect((await bal('1-2050')) - land0).toBe(1000000);
  });

  it('non-PKP: PPN yang tidak dapat dikreditkan ikut harga perolehan saat menguji batas', async () => {
    await setThreshold(3300000).expect(200);
    await patch('/api/settings/company', { pkp: false }).expect(200);
    const expense0 = await bal('6-6100');
    const assets0 = await assetCount();
    // 3.000.000 + PPN 11% = 3.330.000 ≥ 3.300.000 → aset
    const a = (await bill([assetLine('Mesin kopi', 'Inventaris Kantor', '3000000')]).expect(201)).body;
    expect(a.expensedLines).toBe(0);
    expect(await assetCount()).toBe(assets0 + 1);
    // 2.900.000 + PPN 11% = 3.219.000 < 3.300.000 → beban sebesar 3.219.000 (termasuk PPN)
    const e = (await bill([assetLine('Dispenser', 'Inventaris Kantor', '2900000')]).expect(201)).body;
    expect(e.expensedLines).toBe(1);
    expect(await bal('6-6100')).toBe(expense0 + 3219000);
    await patch('/api/settings/company', { pkp: true }).expect(200);
  });

  it('pendaftaran aset langsung: baru di bawah batas ditolak, kecuali dipaksa; aset lama selalu boleh', async () => {
    await setThreshold(5000000).expect(200);
    const body = { name: 'Rak besi', categoryId: cat['Inventaris Kantor'], acquisitionDate: '2026-01-15', cost: '2000000', funding: 'CASH' };
    const rejected = await post('/api/assets', body).expect(400);
    expect(rejected.body.message).toMatch(/batas kapitalisasi/i);

    await post('/api/assets', { ...body, ignoreCapitalizationThreshold: true }).expect(201);
    await post('/api/assets', { ...body, name: 'Meja lama', funding: 'EXISTING' }).expect(201);
    // tanah di bawah batas tetap boleh
    await post('/api/assets', { ...body, name: 'Tanah kecil', categoryId: cat['Tanah'], cost: '1000000' }).expect(201);
    // di atas batas tidak terpengaruh
    await post('/api/assets', { ...body, name: 'Rak besar', cost: '6000000' }).expect(201);
  });

  it('kebijakan kapitalisasi diungkapkan di CALK hanya saat batas aktif', async () => {
    const fixedAssetPolicy = async () => {
      const n = (await get('/api/accounting/notes/2026').expect(200)).body;
      const policies = n.sections.find((s: { key: string }) => s.key === 'policies');
      return policies.subsections.find((s: { title: string }) => s.title.startsWith('f.')).paragraphs.join(' ') as string;
    };
    await setThreshold(5000000).expect(200);
    expect(await fixedAssetPolicy()).toMatch(/batas kapitalisasi/i);
    expect(await fixedAssetPolicy()).toContain('5.000.000');
    await setThreshold(0).expect(200);
    expect(await fixedAssetPolicy()).not.toMatch(/batas kapitalisasi/i);
  });

  it('batas 0 mematikan fitur kembali', async () => {
    await setThreshold(0).expect(200);
    const assets0 = await assetCount();
    const b = (await bill([assetLine('Pulpen mahal', 'Inventaris Kantor', '10000')]).expect(201)).body;
    expect(b.expensedLines).toBe(0);
    expect(await assetCount()).toBe(assets0 + 1);
  });
});
