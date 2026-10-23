/**
 * Impor data awal dari Excel (e2e): pratinjau tanpa menyimpan, semua-atau-tidak-sama-sekali,
 * tambah/perbarui master data, stok awal, piutang & utang awal per faktur, saldo awal akun —
 * lalu memastikan buku besar = buku pembantu dan faktur saldo awal bisa dibayar seperti biasa.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Impor data awal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(auth());
  const post = (url: string, body: object = {}) => http.post(url).set(auth()).send(body);
  const imp = (kind: string, rows: object[], extra: object = {}) => post('/api/imports', { kind, rows, ...extra });
  const balance = async (code: string) => {
    const tb = (await get('/api/accounting/statements/trial-balance?from=2025-01-01&to=2026-12-31').expect(200)).body;
    const r = tb.rows.find((x: { code: string }) => x.code === code);
    return r ? Number(r.closing.debit) - Number(r.closing.credit) : 0;
  };
  const OPEN = '2025-12-31';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'PT Pindahan', name: 'Pemilik', email: `imp-${Date.now()}@uji.id`, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    await http.put('/api/cash/settings').set({ Authorization: `Bearer ${token}` }).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
  });
  afterAll(() => app.close());

  it('produk: pratinjau menandai baris salah, simpan ditolak utuh bila ada error', async () => {
    const rows = [
      { sku: 'mie-01', nama: 'Mie Goreng', satuan: 'pcs', harga_jual: '3.500', satuan2: 'dus', isi2: 40, barcode: '4006381333931' },
      { sku: 'MIE-01', nama: 'Dobel', harga_jual: 1 },
      { sku: 'KOPI', harga_jual: 'murah' },
      { sku: 'GULA', nama: 'Gula 1kg', harga_jual: 15000, satuan2: 'PCS', isi2: 10 },
    ];
    const pre = (await imp('products', rows).expect(200)).body;
    expect(pre.dryRun).toBe(true);
    expect(pre.summary).toMatchObject({ total: 4, create: 1, errors: 3 });
    const errs = pre.results.map((r: { row: number; errors: string[] }) => [r.row, r.errors.join('; ')]);
    expect(errs[1][1]).toMatch(/lebih dari sekali/);
    expect(errs[2][1]).toMatch(/Nama wajib.*bukan angka/);
    expect(errs[3][1]).toMatch(/sama dengan satuan dasar/);
    const fail = await imp('products', rows, { dryRun: false }).expect(400);
    expect(fail.body.message).toMatch(/3 baris/);
    expect((await get('/api/products')).body).toHaveLength(0);
  });

  it('produk, pelanggan, supplier: tambah lalu perbarui lewat kode yang sama', async () => {
    const r1 = await imp(
      'products',
      [
        { sku: 'mie-01', nama: 'Mie Goreng 85g', kategori: 'Makanan', satuan: 'pcs', harga_jual: '3.500', satuan2: 'dus', isi2: 40, barcode: '4006381333931' },
        { sku: 'KOPI-01', nama: 'Kopi Sachet', harga_jual: 'Rp 1.250' },
      ],
      { dryRun: false },
    ).expect(200);
    expect(r1.body.summary).toMatchObject({ create: 2, update: 0, errors: 0 });
    const r2 = await imp('products', [{ sku: 'MIE-01', harga_jual: 3700 }], { dryRun: false }).expect(200);
    expect(r2.body.summary).toMatchObject({ create: 0, update: 1 });
    const mie = (await get('/api/products?q=MIE-01')).body[0];
    expect(mie).toMatchObject({ name: 'Mie Goreng 85g', sellPrice: '3700.00', baseUom: 'PCS', barcode: '4006381333931' });
    expect(mie.uoms.map((u: { uom: string; factor: string }) => [u.uom, Number(u.factor)])).toEqual([['DUS', 40]]);

    await imp(
      'customers',
      [
        { kode: 'TK-001', nama: 'Toko Sumber', telepon: '0811', limit_kredit: '10.000.000', termin_hari: 30, npwp: '01.234.567.8-901.000' },
        { kode: 'TK-002', nama: 'Toko Makmur', termin_hari: 14 },
      ],
      { dryRun: false },
    ).expect(200);
    const upd = await imp('customers', [{ kode: 'tk-001', alamat: 'Jl. Pasar 1' }], { dryRun: false }).expect(200);
    expect(upd.body.summary.update).toBe(1);
    const c = (await get('/api/customers')).body.find((x: { code: string }) => x.code === 'TK-001');
    expect(c).toMatchObject({ name: 'Toko Sumber', address: 'Jl. Pasar 1', creditLimit: '10000000.00', paymentTermDays: 30 });

    await imp('suppliers', [{ kode: 'SUP-01', nama: 'PT Pangan', termin_hari: 45 }], { dryRun: false }).expect(200);
  });

  it('stok awal: kartu stok & akun persediaan terisi, berlawanan dengan ekuitas saldo awal', async () => {
    await imp('stock', [{ sku: 'MIE-01', qty: 10 }], {}).expect(400); // tanggal wajib
    const pre = (await imp('stock', [{ sku: 'TIDAKADA', qty: 1, harga_pokok: 1 }], { date: OPEN }).expect(200)).body;
    expect(pre.results[0].errors[0]).toMatch(/belum ada/);
    await imp(
      'stock',
      [
        { sku: 'MIE-01', qty: '1.000', harga_pokok: '2.800' },
        { sku: 'KOPI-01', qty: 500, harga_pokok: 900 },
      ],
      { date: OPEN, dryRun: false },
    ).expect(200);
    expect(await balance('1-1400')).toBe(1000 * 2800 + 500 * 900);
    const st = (await get('/api/inventory/balances')).body as { sku: string; qty: string; avgCost: string }[];
    const mie = st.find((x) => x.sku === 'MIE-01')!;
    expect([Number(mie.qty), Number(mie.avgCost)]).toEqual([1000, 2800]);
  });

  it('piutang & utang awal per faktur: umur piutang tercatat, tanpa PPN, bisa dibayar', async () => {
    const pre = (
      await imp(
        'receivables',
        [
          { kode_pelanggan: 'TK-001', no_faktur: 'LAMA-001', tanggal: '15/11/2025', sisa_piutang: '2.500.000' },
          { kode_pelanggan: 'TK-002', no_faktur: 'LAMA-002', tanggal: 46012, jatuh_tempo: '2026-01-05', sisa_piutang: 1500000 },
          { kode_pelanggan: 'TK-999', no_faktur: 'LAMA-003', tanggal: '2026-01-10', sisa_piutang: 0 },
        ],
        { date: OPEN },
      ).expect(200)
    ).body;
    expect(pre.results[2].errors.join(' ')).toMatch(/belum ada.*setelah tanggal saldo awal.*lebih dari 0/);
    expect(pre.results[0].warnings.join(' ')).toMatch(/lewat jatuh tempo/); // 15/11 + 30 hari < 31/12

    await imp(
      'receivables',
      [
        { kode_pelanggan: 'TK-001', no_faktur: 'LAMA-001', tanggal: '15/11/2025', sisa_piutang: '2.500.000' },
        { kode_pelanggan: 'TK-002', no_faktur: 'LAMA-002', tanggal: 46012, jatuh_tempo: '2026-01-05', sisa_piutang: 1500000 },
      ],
      { date: OPEN, dryRun: false },
    ).expect(200);
    // nomor yang sama tidak bisa diimpor dua kali
    const dup = (await imp('receivables', [{ kode_pelanggan: 'TK-001', no_faktur: 'lama-001', tanggal: '2025-11-15', sisa_piutang: 1 }], { date: OPEN }).expect(200)).body;
    expect(dup.results[0].errors[0]).toMatch(/sudah dipakai/);

    await imp('payables', [{ kode_supplier: 'SUP-01', no_faktur: 'PNG/123', tanggal: '2025-12-20', sisa_utang: '4.000.000' }], { date: OPEN, dryRun: false }).expect(200);

    expect(await balance('1-1300')).toBe(4_000_000);
    const inv = (await get('/api/invoices')).body as { id: string; number: string; dueDate: string; total: string; isOpening: boolean }[];
    const lama1 = inv.find((x) => x.number === 'LAMA-001')!;
    expect(lama1).toMatchObject({ dueDate: '2025-12-15', total: '2500000.00', isOpening: true });
    expect(inv.find((x) => x.number === 'LAMA-002')!.dueDate).toBe('2026-01-05');

    // dibayar seperti faktur biasa
    await post('/api/payments', { invoiceId: lama1.id, amount: '1000000', date: '2026-01-10', method: 'TRANSFER' }).expect(201);
    expect(await balance('1-1300')).toBe(3_000_000);
    const pi = (await get('/api/purchase-invoices')).body as { id: string; supplierInvoiceNo: string; kind: string }[];
    const old = pi.find((x) => x.supplierInvoiceNo === 'PNG/123')!;
    expect(old.kind).toBe('OPENING');
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: old.id, amount: '4000000', date: '2026-01-15' }).expect(201);

    // bukan penjualan/pembelian periode berjalan: tidak muncul di rekap PPN
    const vat = (await get('/api/accounting/reports/vat?from=2025-01-01&to=2026-12-31').expect(200)).body;
    expect(vat.documents.filter((d: { number: string }) => /LAMA|SA\//.test(d.number))).toHaveLength(0);
  });

  it('saldo awal akun: akun kontrol ditolak, sisanya seimbang ke ekuitas saldo awal; buku pembantu cocok', async () => {
    const pre = (
      await imp(
        'accounts',
        [
          { kode_akun: '1-1200', debit: '50.000.000' },
          { kode_akun: '1-1300', debit: 100 },
          { kode_akun: '9-9999', debit: 1 },
          { kode_akun: '2-1600', kredit: 750000 },
        ],
        { date: OPEN },
      ).expect(200)
    ).body;
    expect(pre.summary.errors).toBe(2);
    expect(pre.results[1].errors[0]).toMatch(/Piutang awal per faktur/);
    expect(pre.results.at(-1).warnings[0]).toMatch(/Ekuitas Saldo Awal/);

    await imp(
      'accounts',
      [
        { kode_akun: '1-1200', debit: '50.000.000' },
        { kode_akun: '2-1600', kredit: 750000 },
      ],
      { date: OPEN, dryRun: false },
    ).expect(200);
    // bank: 50 jt + 1 jt pelunasan − 4 jt bayar supplier
    expect(await balance('1-1200')).toBe(47_000_000);

    const health = (await get('/api/accounting/health').expect(200)).body;
    const checks = health.checks as { key: string; status: string; message: string }[];
    const recon = checks.filter((c) => ['ar', 'ap', 'inventory', 'trial-balance', 'equation'].includes(c.key));
    expect(recon.map((c) => c.key).sort()).toEqual(['ap', 'ar', 'equation', 'inventory', 'trial-balance']);
    expect(recon.filter((c) => c.status !== 'OK')).toEqual([]);
  });
});
