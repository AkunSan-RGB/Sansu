/**
 * Alur kerja operasional per jenis usaha (semua 6 jenis): definisi tahap valid, tiap perusahaan hanya memakai alur jenis usahanya,
 * transisi ditegakkan server (urutan, peran, dokumen terkait nyata, catatan, pemisahan fungsi), otomatisasi dari status dokumen,
 * kasus selesai terkunci, dan terpisah antar perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { BUSINESS_MODEL_KEYS, ROLES, WORKFLOW_LINK_TYPES, WORKFLOW_PIPELINES, pipelinesFor } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Definisi alur kerja (semua jenis usaha)', () => {
  it('tiap jenis usaha punya alur; tiap alur konsisten dan bisa diselesaikan', () => {
    for (const m of BUSINESS_MODEL_KEYS) expect({ m, n: pipelinesFor(m).length }).toEqual({ m, n: expect.any(Number) });
    for (const m of BUSINESS_MODEL_KEYS) expect(pipelinesFor(m).length).toBeGreaterThanOrEqual(1);
    const keys = new Set<string>();
    for (const p of WORKFLOW_PIPELINES) {
      expect(keys.has(p.key)).toBe(false);
      keys.add(p.key);
      const stages = new Map(p.stages.map((s) => [s.key, s]));
      expect(stages.has(p.start)).toBe(true);
      expect(stages.has('BATAL')).toBe(true);
      for (const s of p.stages) {
        for (const n of s.next) expect({ p: p.key, s: s.key, n, ok: stages.has(n) }).toEqual({ p: p.key, s: s.key, n, ok: true });
        for (const r of s.roles) expect(ROLES).toContain(r);
        for (const l of s.requireLink ?? []) { expect(WORKFLOW_LINK_TYPES).toContain(l); expect(p.links).toContain(l); }
        for (const a of s.auto ?? []) { expect(WORKFLOW_LINK_TYPES).toContain(a.link); expect(p.links).toContain(a.link); }
        if (s.terminal) expect(s.next).toEqual([]);
        // tahap yang butuh catatan tidak boleh otomatis (keputusan manusia tidak dilompati)
        if (s.requireNote) expect(s.auto ?? []).toEqual([]);
      }
      // semua tahap non-terminal bisa mencapai tahap akhir tanpa BATAL
      const reach = (k: string, seen = new Set<string>()): boolean => {
        const s = stages.get(k)!;
        if (s.terminal && k !== 'BATAL') return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return s.next.filter((n) => n !== 'BATAL').some((n) => reach(n, seen));
      };
      for (const s of p.stages.filter((x) => !x.terminal)) expect({ p: p.key, s: s.key, ok: reach(s.key) }).toEqual({ p: p.key, s: s.key, ok: true });
    }
  });
});

describe('Alur kerja operasional (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
  });
  afterAll(() => app.close());

  const reg = async (model: string, tag: string) => {
    const r = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `wf-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body;
    return { owner: r.accessToken as string, tenantId: r.user.tenantId as string };
  };
  let seq = 0;
  const user = async (owner: string, role: string, name: string) => {
    const tag = `${name}${++seq}`;
    await http.post('/api/users').set(as(owner)).send({ name, email: `wf-${tag}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `wf-${tag}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const call = (t: string) => ({
    get: (url: string) => http.get(url).set(as(t)),
    post: (url: string, body: object = {}) => http.post(url).set(as(t)).send(body),
  });

  describe.each(BUSINESS_MODEL_KEYS)('%s', (model) => {
    it('hanya melihat dan memakai alur jenis usahanya sendiri', async () => {
      const { owner } = await reg(model, `m-${model.toLowerCase()}`);
      const c = call(owner);
      const mine = (await c.get('/api/workflow/pipelines').expect(200)).body as { key: string; model: string }[];
      expect(mine.map((p) => p.key).sort()).toEqual(pipelinesFor(model).map((p) => p.key).sort());
      const other = WORKFLOW_PIPELINES.find((p) => p.model !== model)!;
      expect((await c.post('/api/workflow/cases', { pipeline: other.key, title: 'Alur jenis lain' })).status).toBe(400);
      const own = pipelinesFor(model)[0];
      const made = await c.post('/api/workflow/cases', { pipeline: own.key, title: 'Kasus uji' }).expect(201);
      expect(made.body.stage).toBe(own.start);
      expect(made.body.number).toMatch(/^WF\//);
    });
  });

  it('DAGANG penjualan: dokumen nyata, urutan, peran, otomatisasi, kunci setelah selesai', async () => {
    const { owner } = await reg('DAGANG', 'dagang');
    const sales = await user(owner, 'SALES', 'sales');
    const fin = await user(owner, 'FINANCE', 'fin');
    const acct = await user(owner, 'ACCOUNTANT', 'acct');
    const hr = await user(owner, 'HR', 'hr');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'P1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const cust = (await call(owner).post('/api/customers', { code: 'C1', name: 'Pelanggan' }).expect(201)).body.id;
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '100', unitCost: '5000' }] }).expect(201);

    // peran: HR tidak bisa membaca; Akuntan hanya membaca
    expect((await call(hr).get('/api/workflow/pipelines')).status).toBe(403);
    expect((await call(acct).get('/api/workflow/pipelines')).status).toBe(200);
    expect((await call(acct).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'x' })).status).toBe(403);

    const kase = (await call(sales).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'Order Toko Maju', customerId: cust, amount: '20000' }).expect(201)).body;
    // tidak bisa loncat, tidak bisa maju tanpa dokumen
    expect((await call(sales).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'LUNAS' })).status).toBe(400);
    const noDoc = await call(sales).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DISETUJUI' });
    expect(noDoc.status).toBe(400);
    expect(JSON.stringify(noDoc.body)).toMatch(/Tautkan dulu/);

    // dokumen nyata → tautkan; pesanan dikonfirmasi → kasus maju otomatis ke Disetujui
    const so = (await call(sales).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '2' }] }).expect(201)).body;
    await call(sales).post(`/api/workflow/cases/${kase.id}/links`, { type: 'SALES_ORDER', docId: so.id }).expect(201);
    expect(((await call(sales).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('PESANAN'); // masih draft: belum ada bukti
    await call(sales).post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const after = (await call(sales).get('/api/workflow/cases').expect(200)).body as { id: string; stage: string }[];
    expect(after.find((x) => x.id === kase.id)!.stage).toBe('DISETUJUI');

    // satu dokumen hanya untuk satu kasus
    const other = (await call(sales).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'Kasus kedua' }).expect(201)).body;
    expect((await call(sales).post(`/api/workflow/cases/${other.id}/links`, { type: 'SALES_ORDER', docId: so.id })).status).toBe(400);
    // jenis dokumen yang tidak dipakai alur ini ditolak
    expect((await call(sales).post(`/api/workflow/cases/${other.id}/links`, { type: 'PROJECT', docId: so.id })).status).toBe(400);

    // faktur → ditagih (otomatis) → bayar → lunas (otomatis) dan selesai
    const inv = (await call(owner).post('/api/invoices', { salesOrderId: so.id, date: today }).expect(201)).body;
    await call(fin).post(`/api/workflow/cases/${kase.id}/links`, { type: 'INVOICE', docId: inv.id }).expect(201);
    expect(((await call(fin).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DITAGIH');
    const total = (await call(owner).get(`/api/invoices/${inv.id}`).expect(200)).body.total;
    await call(owner).post('/api/payments', { invoiceId: inv.id, amount: total, method: 'TRANSFER' }).expect(201);
    await call(fin).get('/api/workflow/cases').expect(200); // memicu pengecekan otomatis
    const done = (await call(fin).get(`/api/workflow/cases/${kase.id}`).expect(200)).body;
    expect(done).toMatchObject({ stage: 'LUNAS', status: 'DONE' });
    expect(done.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['CREATE', 'LINK', 'AUTO']));
    // kasus selesai terkunci
    expect((await call(owner).post(`/api/workflow/cases/${kase.id}/cancel`, { note: 'Salah catat' })).status).toBe(400);
    expect((await call(fin).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DITAGIH' })).status).toBe(400);

    // batalkan: wajib alasan dan hanya Admin/Pemilik
    expect((await call(sales).post(`/api/workflow/cases/${other.id}/cancel`, { note: 'Pelanggan batal' })).status).toBe(403);
    expect((await call(owner).post(`/api/workflow/cases/${other.id}/cancel`, { note: 'x' })).status).toBe(400);
    expect(((await call(owner).post(`/api/workflow/cases/${other.id}/cancel`, { note: 'Pelanggan batal pesan' }).expect(201)).body)).toMatchObject({ status: 'CANCELLED' });
  });

  it('pengadaan: pemisahan fungsi, tagihan, pembayaran, dan peringatan dokumen dibatalkan', async () => {
    const { owner } = await reg('FNB', 'fnb');
    const buyer = await user(owner, 'PURCHASING', 'buyer');
    const wh1 = await user(owner, 'WAREHOUSE', 'gudang');
    const fin = await user(owner, 'FINANCE', 'fin');
    const whId = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'B1', name: 'Tepung', baseUom: 'KG', sellPrice: '0' }).expect(201)).body.id;
    const sup = (await call(owner).post('/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    const kase = (await call(buyer).post('/api/workflow/cases', { pipeline: 'FNB_BAHAN', title: 'Tepung bulan ini', supplierId: sup }).expect(201)).body;
    const po = (await call(buyer).post('/api/purchase-orders', { supplierId: sup, warehouseId: whId, lines: [{ productId: prod, qty: '10', price: '9000' }] }).expect(201)).body;
    await call(buyer).post(`/api/workflow/cases/${kase.id}/links`, { type: 'PURCHASE_ORDER', docId: po.id }).expect(201);
    await call(buyer).post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await call(buyer).get('/api/workflow/cases').expect(200);
    expect(((await call(buyer).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DIPESAN');
    // Pembelian tidak boleh memindahkan ke Diterima (peran gudang)
    expect((await call(buyer).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DITERIMA' })).status).toBe(400);
    const gr = (await call(wh1).post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201)).body;
    await call(wh1).post(`/api/workflow/cases/${kase.id}/links`, { type: 'GOODS_RECEIPT', docId: gr.id }).expect(201);
    expect(((await call(wh1).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DITERIMA');
    // tagihan masuk → dibayar
    const pi = (await call(owner).post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'T-1' }).expect(201)).body;
    await call(fin).post(`/api/workflow/cases/${kase.id}/links`, { type: 'PURCHASE_INVOICE', docId: pi.id }).expect(201);
    expect(((await call(fin).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DITAGIH');
    const bill = (await call(owner).get(`/api/purchase-invoices/${pi.id}`).expect(200)).body;
    await call(owner).post('/api/purchase-invoices/payments', { purchaseInvoiceId: pi.id, amount: String(bill.total) }).expect(201);
    await call(fin).get('/api/workflow/cases').expect(200);
    expect(((await call(fin).get(`/api/workflow/cases/${kase.id}`).expect(200)).body)).toMatchObject({ stage: 'DIBAYAR', status: 'DONE' });
  });

  it('dokumen terkait yang dibatalkan memunculkan peringatan; kasus tidak maju dari dokumen batal', async () => {
    const { owner, tenantId } = await reg('DAGANG', 'batal');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(owner).post('/api/products', { sku: 'P1', name: 'B', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    const cust = (await call(owner).post('/api/customers', { code: 'C1', name: 'P' }).expect(201)).body.id;
    await call(owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '10', unitCost: '500' }] }).expect(201);
    const kase = (await call(owner).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'Uji batal' }).expect(201)).body;
    const so = (await call(owner).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '1' }] }).expect(201)).body;
    await call(owner).post(`/api/workflow/cases/${kase.id}/links`, { type: 'SALES_ORDER', docId: so.id }).expect(201);
    await db.execute(sql`UPDATE sales_orders SET status = 'CANCELLED' WHERE id = ${so.id} AND tenant_id = ${tenantId}`);
    const alerts = (await call(owner).get('/api/workflow/alerts').expect(200)).body as { kind: string }[];
    expect(alerts.some((a) => a.kind === 'DOKUMEN_BATAL')).toBe(true);
    // dokumen batal tidak bisa dijadikan syarat maju
    expect((await call(owner).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DISETUJUI' })).status).toBe(400);
  });

  it('shift kasir (Ritel): kasir menutup, uang diperiksa orang lain dengan catatan, lalu disetor', async () => {
    const { owner } = await reg('RITEL', 'ritel');
    const cashier = await user(owner, 'CASHIER', 'kasir');
    const fin = await user(owner, 'FINANCE', 'fin');
    const wh = (await call(owner).get('/api/warehouses').expect(200)).body[0].id;
    const kase = (await call(cashier).post('/api/workflow/cases', { pipeline: 'RITEL_SHIFT', title: 'Shift pagi' }).expect(201)).body;
    const sess = (await call(cashier).post('/api/pos/sessions', { warehouseId: wh, openingCash: '100000' }).expect(201)).body;
    await call(cashier).post(`/api/workflow/cases/${kase.id}/links`, { type: 'POS_SESSION', docId: sess.id }).expect(201);
    await call(cashier).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DITUTUP' }).catch(() => undefined);
    // sesi belum ditutup → kasir tidak bisa mengklaim tutup lewat alur
    expect(((await call(cashier).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DIBUKA');
    await call(cashier).post(`/api/pos/sessions/${sess.id}/close`, { countedCash: '100000' }).expect(201);
    await call(cashier).get('/api/workflow/cases').expect(200);
    expect(((await call(cashier).get(`/api/workflow/cases/${kase.id}`).expect(200)).body).stage).toBe('DITUTUP');
    // kasir tidak boleh memeriksa uangnya sendiri; pemeriksa wajib catatan
    expect((await call(cashier).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DIPERIKSA', note: 'hitung ulang' })).status).toBe(400);
    expect((await call(fin).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DIPERIKSA' })).status).toBe(400); // tanpa catatan
    await call(fin).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DIPERIKSA', note: 'Uang dihitung ulang, cocok Rp100.000' }).expect(201);
    expect((await call(fin).post(`/api/workflow/cases/${kase.id}/advance`, { to: 'DISETOR', note: 'Disetor ke BCA, slip 123' }).expect(201)).body).toMatchObject({ status: 'DONE', stage: 'DISETOR' });
  });

  it('terpisah antar perusahaan: id kasus, daftar, dan dokumen perusahaan lain tidak terlihat', async () => {
    const a = await reg('DAGANG', 'iso-a');
    const b = await reg('DAGANG', 'iso-b');
    const wh = (await call(b.owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await call(b.owner).post('/api/products', { sku: 'P1', name: 'B', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    const cust = (await call(b.owner).post('/api/customers', { code: 'C1', name: 'P' }).expect(201)).body.id;
    await call(b.owner).post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '10', unitCost: '500' }] }).expect(201);
    const soB = (await call(b.owner).post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '1' }] }).expect(201)).body;
    const caseB = (await call(b.owner).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'Milik B' }).expect(201)).body;
    const caseA = (await call(a.owner).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'Milik A' }).expect(201)).body;
    expect((await call(a.owner).get(`/api/workflow/cases/${caseB.id}`)).status).toBe(404);
    expect((await call(a.owner).post(`/api/workflow/cases/${caseB.id}/advance`, { to: 'DISETUJUI' })).status).toBe(404);
    expect(((await call(a.owner).get('/api/workflow/cases').expect(200)).body as { id: string }[]).map((x) => x.id)).toEqual([caseA.id]);
    // menautkan dokumen milik perusahaan lain ditolak
    expect((await call(a.owner).post(`/api/workflow/cases/${caseA.id}/links`, { type: 'SALES_ORDER', docId: soB.id })).status).toBe(400);
    // pelanggan perusahaan lain tidak bisa dijadikan subjek kasus
    expect((await call(a.owner).post('/api/workflow/cases', { pipeline: 'DAGANG_PENJUALAN', title: 'x', customerId: cust })).status).toBe(400);
    const cand = (await call(a.owner).get('/api/workflow/candidates?type=SALES_ORDER').expect(200)).body as { id: string }[];
    expect(cand.map((x) => x.id)).not.toContain(soB.id);
  });
});

describe('Alur kerja Jasa: proyek dari survei sampai selesai (e2e)', () => {
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

  it('urutan, catatan wajib, pemisahan fungsi (dua Admin), dan otomatisasi dari penawaran/faktur', async () => {
    const owner = (await http.post('/api/auth/register').send({ companyName: 'PT Jasa Alur', name: 'Pemilik', email: `wfj-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken as string;
    const mk = async (role: string, n: string) => {
      await http.post('/api/users').set(as(owner)).send({ name: n, email: `wfj-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `wfj-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    const admin1 = await mk('ADMIN', 'adm1');
    const admin2 = await mk('ADMIN', 'adm2');
    const fin = await mk('FINANCE', 'fin');
    const c = (t: string) => ({ get: (u: string) => http.get(u).set(as(t)), post: (u: string, b: object = {}) => http.post(u).set(as(t)).send(b) });
    await c(owner).post('/api/apps/crm/install').expect(201);
    const cust = (await c(owner).post('/api/customers', { code: 'K1', name: 'Klien Alur' }).expect(201)).body.id;
    const wh = (await c(owner).get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await c(owner).post('/api/products', { sku: 'J1', name: 'Konsultasi', baseUom: 'JAM', sellPrice: '500000' }).expect(201)).body.id;

    const kase = (await c(admin1).post('/api/workflow/cases', { pipeline: 'JASA_PROYEK', title: 'Audit sistem klien', customerId: cust, amount: '5000000' }).expect(201)).body;
    const adv = (t: string, to: string, note?: string) => c(t).post(`/api/workflow/cases/${kase.id}/advance`, { to, ...(note ? { note } : {}) });
    const stage = async () => ((await c(owner).get(`/api/workflow/cases/${kase.id}`).expect(200)).body.stage as string);

    expect((await adv(admin1, 'KONTRAK')).status).toBe(400); // loncat
    expect((await adv(admin1, 'PENAWARAN')).status).toBe(400); // belum ada penawaran
    const q = (await c(owner).post('/api/crm/quotations', { customerId: cust, warehouseId: wh, lines: [{ productId: prod, qty: '10', price: '500000' }] }).expect(201)).body;
    await c(admin1).post(`/api/workflow/cases/${kase.id}/links`, { type: 'QUOTATION', docId: q.id }).expect(201);
    expect((await adv(admin1, 'PENAWARAN')).status).toBe(400); // penawaran masih draft: belum ada bukti terkirim
    await c(owner).post(`/api/crm/quotations/${q.id}/send`).expect(201);
    await c(owner).get('/api/workflow/cases').expect(200);
    expect(await stage()).toBe('PENAWARAN'); // otomatis dari status penawaran
    // kontrak: wajib catatan; pemisahan fungsi antar-Admin (yang memindahkan ke Penawaran = sistem, jadi Admin mana pun sah di sini)
    expect((await adv(admin1, 'KONTRAK')).status).toBe(400); // tanpa catatan
    await adv(admin1, 'KONTRAK', 'SPK 014/2026 ditandatangani klien').expect(201);
    // pengerjaan butuh proyek nyata
    expect((await adv(admin2, 'PENGERJAAN')).status).toBe(400);
    const prj = (await c(owner).post('/api/services/projects', { name: 'Audit sistem klien', customerId: cust, contractValue: '5000000' }).expect(201)).body;
    await c(admin2).post(`/api/workflow/cases/${kase.id}/links`, { type: 'PROJECT', docId: prj.id }).expect(201);
    await adv(admin2, 'PENGERJAAN').expect(201);
    // serah terima: wajib catatan; Admin yang memindahkan ke Pengerjaan (admin2) tidak boleh sendiri menyerahterimakan
    expect((await adv(admin2, 'SERAH_TERIMA', 'BA-07 ditandatangani')).status).toBe(400);
    await adv(admin1, 'SERAH_TERIMA', 'BA-07 ditandatangani klien tanggal hari ini').expect(201);
    // tagihan: faktur jasa nyata → otomatis Ditagih
    const inv = (await c(owner).post('/api/services/invoices', { customerId: cust, projectId: prj.id, date: today, lines: [{ description: 'Audit sistem', price: '5000000' }] }).expect(201)).body;
    await c(fin).post(`/api/workflow/cases/${kase.id}/links`, { type: 'INVOICE', docId: inv.id }).expect(201);
    expect(await stage()).toBe('DITAGIH');
    // retensi dan selesai: catatan wajib; selesai oleh orang lain dari yang memindahkan ke Retensi
    expect((await adv(fin, 'RETENSI')).status).toBe(400);
    await adv(fin, 'RETENSI', 'Retensi 5% ditahan 90 hari').expect(201);
    expect((await adv(fin, 'SELESAI', 'Retensi dilepas')).status).toBe(400); // pemisahan fungsi
    const fin2 = await mk('FINANCE', 'fin2');
    const done = await adv(fin2, 'SELESAI', 'Retensi dilepas, kas diterima');
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ stage: 'SELESAI', status: 'DONE' });
    expect(done.body.events.length).toBeGreaterThanOrEqual(8);
  });
});
