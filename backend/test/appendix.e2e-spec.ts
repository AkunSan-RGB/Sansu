/**
 * Lampiran laporan keuangan (daftar umur piutang/utang, aset tetap, persediaan, neraca saldo)
 * dan tambahan CALK: rincian utang usaha, komitmen & kontinjensi, pihak berelasi, estimasi akuntansi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Section = { key: string; number: string; title: string; paragraphs: string[]; tables: { title?: string; columns: string[]; rows: (string | number | null)[][]; total?: (string | number | null)[] }[] };

describe('Lampiran laporan keuangan & tambahan CALK (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const year = new Date().getFullYear();
  const old = `${year - 1}-06-15`;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  let warehouseId: string;
  let productId: string;
  let categoryId: string;
  const section = (sections: Section[], key: string) => sections.find((s) => s.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'PT Lampiran Uji', name: 'Pemilik', email: `lampiran-${stamp}@uji.id`, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    productId = (await post('/api/products', { sku: 'LMP-1', name: 'Produk Lampiran', sellPrice: '100000', category: 'Makanan & Minuman' }).expect(201)).body.id;
    categoryId = ((await get('/api/assets/categories').expect(200)).body as { id: string; name: string }[]).find((c) => c.name === 'Inventaris Kantor')!.id;

    // stok awal 10 @ 5.000 → jual 2 → sisa 8 (nilai 40.000)
    await post('/api/inventory/adjustments', { warehouseId, reason: 'OPENING', lines: [{ productId, qty: '10', unitCost: '5000' }] }).expect(201);
    const customerId = (await post('/api/customers', { code: 'TK-LMP', name: 'Toko Lampiran', creditLimit: '100000000', paymentTermDays: 30 }).expect(201)).body.id;
    const so = (await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, qty: '2', price: '100000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so.id }).expect(201);

    // utang: satu tagihan lama (>90 hari) dan satu tagihan baru; satu aset; satu PO terkonfirmasi belum ditagih
    const lama = (await post('/api/suppliers', { code: 'SUP-LAMA', name: 'Pemasok Lama' }).expect(201)).body.id;
    const baru = (await post('/api/suppliers', { code: 'SUP-BARU', name: 'Pemasok Baru' }).expect(201)).body.id;
    const exp = ((await get('/api/accounting/accounts')).body as { id: string; code: string }[]).find((a) => a.code === '6-7000')!;
    await post('/api/purchase-invoices/bills', {
      supplierId: lama,
      supplierInvoiceNo: `OLD-${stamp}`,
      date: old,
      dueDate: old,
      lines: [{ type: 'EXPENSE', description: 'Servis lama', accountId: exp.id, price: '1000000' }],
    }).expect(201);
    await post('/api/purchase-invoices/bills', {
      supplierId: baru,
      supplierInvoiceNo: `NEW-${stamp}`,
      lines: [
        { type: 'EXPENSE', description: 'Servis baru', accountId: exp.id, price: '500000' },
        { type: 'ASSET', description: 'Laptop kantor', assetCategoryId: categoryId, price: '12000000' },
      ],
    }).expect(201);
    const po = (await post('/api/purchase-orders', { supplierId: baru, warehouseId, lines: [{ productId, qty: '5', price: '5000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
  });
  afterAll(() => app.close());

  it('butuh login', async () => {
    await http.get(`/api/accounting/appendix/${year}`).expect(401);
  });

  it('lima lampiran tersusun berurutan L1–L5', async () => {
    const ap = (await get(`/api/accounting/appendix/${year}`).expect(200)).body;
    expect(ap.sections.map((s: Section) => [s.number, s.key])).toEqual([
      ['L1', 'receivable-aging'],
      ['L2', 'payable-aging'],
      ['L3', 'fixed-asset-register'],
      ['L4', 'inventory-list'],
      ['L5', 'trial-balance'],
    ]);
    expect(ap.company.name).toBe('PT Lampiran Uji');
    expect(ap.period.to <= `${year}-12-31`).toBe(true);
  });

  it('L1 umur piutang per pelanggan: faktur baru belum jatuh tempo', async () => {
    const s = section((await get(`/api/accounting/appendix/${year}`)).body.sections, 'receivable-aging');
    const t = s.tables[0];
    expect(t.columns).toEqual(['Pelanggan', 'Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', 'Lebih dari 90 hari', 'Jumlah']);
    expect(t.rows).toEqual([['TK-LMP Toko Lampiran', 222000, 0, 0, 0, 0, 222000]]); // 200.000 + PPN 11%
    expect(t.total).toEqual(['Jumlah', 222000, 0, 0, 0, 0, 222000]);
  });

  it('L2 umur utang per pemasok: tagihan lama masuk kelompok >90 hari', async () => {
    const s = section((await get(`/api/accounting/appendix/${year}`)).body.sections, 'payable-aging');
    const rows = s.tables[0].rows;
    const lama = rows.find((r) => String(r[0]).startsWith('SUP-LAMA'))!;
    const baru = rows.find((r) => String(r[0]).startsWith('SUP-BARU'))!;
    expect(lama).toEqual(['SUP-LAMA Pemasok Lama', 0, 0, 0, 0, 1110000, 1110000]); // 1.000.000 + PPN
    expect(baru).toEqual(['SUP-BARU Pemasok Baru', 13875000, 0, 0, 0, 0, 13875000]); // (500.000 + 12.000.000) + PPN
    expect(s.tables[0].total).toEqual(['Jumlah', 13875000, 0, 0, 0, 1110000, 14985000]);
  });

  it('L3 daftar aset tetap dan L4 persediaan per produk', async () => {
    const sections = (await get(`/api/accounting/appendix/${year}`)).body.sections as Section[];
    const fa = section(sections, 'fixed-asset-register').tables[0];
    expect(fa.rows).toHaveLength(1);
    expect(fa.rows[0].slice(1, 3)).toEqual(['Laptop kantor', 'Inventaris Kantor']);
    expect(fa.rows[0].slice(4)).toEqual([12000000, 0, 12000000]);
    const inv = section(sections, 'inventory-list').tables[0];
    expect(inv.rows).toEqual([['LMP-1', 'Produk Lampiran', 'Makanan & Minuman', 8, 40000]]);
    expect(inv.total).toEqual(['Jumlah', '', '', '', 40000]);
  });

  it('L5 neraca saldo: total debit = total kredit', async () => {
    const t = section((await get(`/api/accounting/appendix/${year}`)).body.sections, 'trial-balance').tables[0];
    expect(t.rows.length).toBeGreaterThan(5);
    expect(t.total![1]).toBe(t.total![2]);
    expect(t.total![1] as number).toBeGreaterThan(0);
    const sumDebit = t.rows.reduce((a, r) => a + (r[1] as number), 0);
    expect(Math.round(sumDebit * 100)).toBe(Math.round((t.total![1] as number) * 100));
  });

  it('CALK: rincian utang usaha, komitmen PO, pihak berelasi, dan estimasi akuntansi', async () => {
    const n = (await get(`/api/accounting/notes/${year}`).expect(200)).body;
    const sections = n.sections as Section[];
    const keys = sections.map((s) => s.key);
    expect(keys.indexOf('commitments')).toBeGreaterThan(keys.indexOf('income-tax'));
    expect(keys.indexOf('related-parties')).toBe(keys.indexOf('commitments') + 1);
    expect(keys.indexOf('subsequent')).toBe(keys.indexOf('related-parties') + 1);
    // nomor catatan berurutan tanpa celah
    expect(sections.map((s) => s.number)).toEqual(sections.map((_, i) => String(i + 1)));

    const payables = section(sections, 'payables');
    // tabel pertama = rincian akun (bawaan, tanpa judul), disusul rincian per pemasok & per umur
    expect(payables.tables.map((t) => t.title)).toEqual([undefined, 'Berdasarkan pemasok (10 terbesar)', 'Berdasarkan umur (sejak jatuh tempo)']);
    expect(payables.tables[1].rows[0]).toEqual(['SUP-BARU Pemasok Baru', 13875000]); // terbesar dulu
    expect(payables.tables[2].rows).toEqual([
      ['Belum jatuh tempo', 13875000],
      ['Lebih dari 90 hari', 1110000],
    ]);

    const commit = section(sections, 'commitments');
    expect(commit.paragraphs[0]).toMatch(/1 pesanan pembelian/);
    expect(commit.tables[0].rows).toHaveLength(1);
    expect(commit.tables[0].total![3]).toBe(27750); // 5 × 5.000 + PPN 11%

    const policies = section(sections, 'policies') as Section & { subsections: { title: string }[] };
    expect(policies.subsections.map((s) => s.title.slice(0, 2))).toEqual(['a.', 'b.', 'c.', 'd.', 'e.', 'f.', 'g.', 'h.', 'i.', 'j.', 'k.']);
  });

  it('perusahaan lain mendapat lampiran kosong, tanpa data perusahaan ini', async () => {
    const other = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'CV Tetangga', name: 'Pemilik', email: `tetangga-${stamp}@uji.id`, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    const ap = (await http.get(`/api/accounting/appendix/${year}`).set({ Authorization: `Bearer ${other}` }).expect(200)).body;
    expect(ap.company.name).toBe('CV Tetangga');
    const byKey = (k: string) => ap.sections.find((s: Section) => s.key === k) as Section;
    expect(byKey('receivable-aging').tables).toEqual([]);
    expect(byKey('payable-aging').tables).toEqual([]);
    expect(byKey('fixed-asset-register').tables).toEqual([]);
    expect(byKey('inventory-list').tables).toEqual([]);
    expect(byKey('receivable-aging').paragraphs.join(' ')).toMatch(/Tidak ada piutang usaha terbuka/);
    const tb = byKey('trial-balance').tables[0];
    expect(tb.rows).toEqual([]);
    expect(tb.total).toEqual(['Jumlah', 0, 0]);
  });
});
