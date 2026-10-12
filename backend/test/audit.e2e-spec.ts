/** Jejak audit (e2e): perubahan data tercatat otomatis, tanpa ganda, rahasia disembunyikan, hanya admin yang bisa melihat */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Row = { ref?: string; link?: string; label: string; category: string; userName: string; data: Record<string, unknown>; entityId: string; action: string; entity: string };

describe('Jejak audit (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const logs = async (q = '') => {
    await new Promise((r) => setTimeout(r, 150)); // pencatatan otomatis berjalan setelah respons
    return (await http.get(`/api/audit-logs${q}`).set(auth()).expect(200)).body.rows as Row[];
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const email = `audit-${Date.now()}@uji.id`;
    await http.post('/api/auth/register').send({ companyName: 'PT Audit', name: 'Bu Pemilik', email, password: 'rahasia123' }).expect(201);
    token = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body.accessToken;
  });
  afterAll(() => app.close());

  it('mencatat siapa mengubah apa: produk, harga, jurnal & pembalikan, login, pengguna', async () => {
    const p = (await http.post('/api/products').set(auth()).send({ sku: 'AUD-1', name: 'Barang Audit', sellPrice: '1000' }).expect(201)).body;
    await http.patch(`/api/products/${p.id}`).set(auth()).send({ sellPrice: '1250' }).expect(200);
    const acc = (await http.get('/api/accounting/accounts').set(auth())).body as { id: string; code: string }[];
    const j = (
      await http
        .post('/api/accounting/journals')
        .set(auth())
        .send({ date: '2026-02-01', description: 'Setoran modal', lines: [{ accountId: acc.find((a) => a.code === '1-1100')!.id, debit: '500' }, { accountId: acc.find((a) => a.code === '3-1000')!.id, credit: '500' }] })
        .expect(201)
    ).body;
    await http.post(`/api/accounting/journals/${j.id}/reverse`).set(auth()).expect(201);
    await http.post('/api/users').set(auth()).send({ name: 'Kasir', email: `aud-k-${Date.now()}@uji.id`, password: 'kasir1234', role: 'CASHIER' }).expect(201);
    // gagal → tidak dicatat
    await http.patch(`/api/products/${p.id}`).set(auth()).send({ sellPrice: 'abc' }).expect(400);

    const rows = await logs();
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Membuat produk', 'Mengubah produk', 'Membuat jurnal umum', 'Membalik jurnal umum', 'Membuat pengguna', 'Masuk ke aplikasi']),
    );
    expect(labels.filter((l) => l === 'Mengubah produk')).toHaveLength(1);
    const price = rows.find((r) => r.label === 'Mengubah produk')!;
    expect(price).toMatchObject({ userName: 'Bu Pemilik', entityId: p.id, category: 'master' });
    expect((price.data.body as Record<string, unknown>).sellPrice).toBe('1250');
    expect(Number((price.data.before as Record<string, unknown>).sellPrice)).toBe(1000);
    // rahasia tidak tersimpan
    const user = rows.find((r) => r.label === 'Membuat pengguna')!;
    expect((user.data.body as Record<string, unknown>).password).toBe('***');
    expect(JSON.stringify(rows)).not.toContain('kasir1234');
  });

  it('proses yang sudah punya catatan rinci tidak dicatat ganda; filter & cari', async () => {
    const wh = (await http.get('/api/warehouses').set(auth())).body[0].id;
    const c = (await http.post('/api/customers').set(auth()).send({ code: 'C-AUD', name: 'Toko Audit' }).expect(201)).body;
    const p = (await http.get('/api/products?q=AUD-1').set(auth())).body[0];
    await http.post('/api/inventory/adjustments').set(auth()).send({ warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: p.id, qty: '10', unitCost: '500' }] }).expect(201);
    const so = (await http.post('/api/sales-orders').set(auth()).send({ customerId: c.id, warehouseId: wh, date: '2026-02-02', lines: [{ productId: p.id, qty: '1' }] }).expect(201)).body;
    await http.post(`/api/sales-orders/${so.id}/confirm`).set(auth()).expect(201);

    const rows = await logs(`?q=${encodeURIComponent(so.number)}`);
    const confirms = rows.filter((r) => /Mengonfirmasi sales order/.test(r.label));
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ entity: 'SalesOrder', ref: so.number, link: `/sales-orders/${so.id}` });
    // pencarian nama produk menemukan perubahan harga
    const byName = await logs('?q=Barang%20Audit');
    expect(byName.some((r) => r.label === 'Mengubah produk' && (r as Row & { ref: string }).ref === 'AUD-1 · Barang Audit')).toBe(true);
    const sales = await logs('?category=sales');
    expect(sales.every((r) => r.category === 'sales')).toBe(true);
    const sec = await logs('?category=security');
    expect(sec.map((r) => r.label)).toContain('Masuk ke aplikasi');
  });

  it('hanya admin/pemilik yang boleh melihat jejak audit', async () => {
    const email = `aud-s-${Date.now()}@uji.id`;
    await http.post('/api/users').set(auth()).send({ name: 'Sales', email, password: 'sales1234', role: 'SALES' }).expect(201);
    const t = (await http.post('/api/auth/login').send({ email, password: 'sales1234' }).expect(200)).body.accessToken;
    await http.get('/api/audit-logs').set({ Authorization: `Bearer ${t}` }).expect(403);
  });
});
