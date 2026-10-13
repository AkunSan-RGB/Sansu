/**
 * Evaluasi impor data (e2e): kasus tepi yang dulu lolos pratinjau tetapi gagal/berbahaya saat disimpan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Impor data — kasus tepi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(auth());
  const post = (url: string, body: object = {}) => http.post(url).set(auth()).send(body);
  const imp = (kind: string, rows: object[], extra: object = {}) => post('/api/imports', { kind, rows, ...extra });
  const OPEN = '2025-12-31';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http.post('/api/auth/register').send({ companyName: 'PT Tepi', name: 'Pemilik', email: `tepi-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)
    ).body.accessToken;
  });
  afterAll(() => app.close());

  it('utang awal: nomor faktur yang sama dari DUA supplier berbeda boleh (pratinjau dan simpan konsisten)', async () => {
    await imp('suppliers', [{ kode: 'SUP-A', nama: 'Supplier A' }, { kode: 'SUP-B', nama: 'Supplier B' }], { dryRun: false }).expect(200);
    const rows = [
      { kode_supplier: 'SUP-A', no_faktur: '001', tanggal: '2025-11-01', sisa_utang: 1000000 },
      { kode_supplier: 'SUP-B', no_faktur: '001', tanggal: '2025-11-02', sisa_utang: 2000000 },
    ];
    const pre = (await imp('payables', rows, { date: OPEN }).expect(200)).body;
    expect(pre.summary).toMatchObject({ total: 2, errors: 0 });
    const res = await imp('payables', rows, { date: OPEN, dryRun: false });
    expect(res.status).toBe(200);
    const list = (await get('/api/purchase-invoices').expect(200)).body as { total?: string; supplierInvoiceNo?: string }[] | { rows: { supplierInvoiceNo: string }[] };
    const arr = Array.isArray(list) ? list : list.rows;
    expect(arr.filter((x) => x.supplierInvoiceNo === '001')).toHaveLength(2);
  });

  it('saldo awal akun: mengimpor ulang akun yang sudah punya saldo awal diberi peringatan jelas (bukan diam-diam menggandakan)', async () => {
    const rows = [{ kode_akun: '1-1100', debit: 5000000 }, { kode_akun: '3-1000', kredit: 5000000 }];
    await imp('accounts', rows, { date: OPEN, dryRun: false }).expect(200);
    const again = (await imp('accounts', rows, { date: OPEN }).expect(200)).body;
    const warns = again.results.flatMap((r: { warnings: string[] }) => r.warnings).join(' | ');
    expect(warns).toMatch(/sudah punya saldo awal/i);
  });

  it('produk: satuan dasar produk yang sudah punya stok tidak boleh diubah lewat impor', async () => {
    await imp('products', [{ sku: 'BRG-1', nama: 'Barang Satu', satuan: 'PCS', harga_jual: 1000 }], { dryRun: false }).expect(200);
    await imp('stock', [{ sku: 'BRG-1', qty: 10, harga_pokok: 500 }], { date: OPEN, dryRun: false }).expect(200);
    const pre = (await imp('products', [{ sku: 'BRG-1', satuan: 'KG', harga_jual: 1000 }]).expect(200)).body;
    expect(pre.summary.errors).toBe(1);
    expect(pre.results[0].errors.join(' ')).toMatch(/satuan dasar/i);
    // tanpa mengubah satuan, pembaruan harga tetap boleh
    const ok = (await imp('products', [{ sku: 'BRG-1', satuan: 'pcs', harga_jual: 1500 }]).expect(200)).body;
    expect(ok.summary).toMatchObject({ errors: 0, update: 1 });
  });
});
