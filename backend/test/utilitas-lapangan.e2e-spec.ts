/**
 * Utilitas lapangan: impor meter, kunci API alat meter, pencatatan lapangan (lokasi + foto), loket dan setoran harian.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Utilitas lapangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const longAgo = `${month(4)}-05`;
  let owner: string; let fin: string; let fin2: string; let field: string; let acct: string;
  let tariff: string; let customer: string;
  const conns: { id: string; number: string }[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Lapangan', name: 'Pemilik', email: `utl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `utl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `utl-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    fin2 = await mk('FINANCE', 'fin2');
    field = await mk('WAREHOUSE', 'lapangan');
    acct = await mk('ACCOUNTANT', 'akuntan');
    // pelanggan dengan koordinat (Jakarta)
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Budi', paymentTermDays: 20, geoLat: -6.2, geoLng: 106.816666 }).expect(201)).body.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (const n of [1, 2, 3]) {
      const c = (await post('/api/utility/connections', { customerId: customer, tariffId: tariff, address: `Blok ${n}`, meterNo: `ML-${n}`, installedAt: longAgo, initialReading: '0' }, fin).expect(201)).body;
      conns.push({ id: c.id, number: c.number });
    }
  });
  afterAll(() => app.close());

  it('impor: tiap baris diperiksa aturan yang sama; baris gagal tidak menggagalkan yang lain; hanya petugas/Admin', async () => {
    const rows = [
      { connectionNumber: conns[0].number, period: month(3), current: '10' },
      { connectionNumber: conns[1].number, period: month(3), current: '12' },
      { connectionNumber: 'TIDAK-ADA', period: month(3), current: '5' },
      { connectionNumber: conns[0].number, period: month(3), current: '11' }, // periode kembar
      { connectionNumber: conns[2].number, period: month(3), current: '-4' }, // angka tidak valid
    ];
    expect((await post('/api/utility/readings/import', { rows }, fin)).status).toBe(403);
    expect((await post('/api/utility/readings/import', { rows: [] }, field)).status).toBe(400);
    const r = (await post('/api/utility/readings/import', { rows }, field).expect(201)).body;
    expect(r).toMatchObject({ total: 5, accepted: 2, rejected: 3 });
    expect(r.results[2].error).toMatch(/tidak ditemukan/);
    expect(r.results[3].error).toMatch(/sudah dicatat/);
    const list = (await get(`/api/utility/readings?period=${month(3)}`, fin).expect(200)).body as { status: string; source: string }[];
    expect(list).toHaveLength(2);
    expect(list.every((x) => x.status === 'ENTERED')).toBe(true); // tidak ada yang langsung terverifikasi/tertagih
    const src = await db.execute<{ source: string }>(sql`SELECT DISTINCT source FROM utility_readings WHERE period = ${month(3)} AND tenant_id = (SELECT tenant_id FROM utility_connections WHERE id = ${conns[0].id})`);
    expect(src.rows.map((x) => x.source)).toEqual(['IMPORT']);
  });

  it('kunci API: Admin/Pemilik membuat, hanya hash tersimpan; alat meter mengirim angka (menunggu verifikasi); dicabut = ditolak', async () => {
    expect((await post('/api/utility/ingest-keys', { name: 'Gateway A' }, fin)).status).toBe(403);
    const k = (await post('/api/utility/ingest-keys', { name: 'Gateway Blok A' }).expect(201)).body;
    expect(k.key).toMatch(/^sum_/);
    const stored = await db.execute<{ key_hash: string }>(sql`SELECT key_hash FROM utility_ingest_keys WHERE id = ${k.id}`);
    expect(stored.rows[0].key_hash).not.toContain(k.key);
    expect((await get('/api/utility/ingest-keys').expect(200)).body[0]).not.toHaveProperty('keyHash');
    const send = (rows: object[], key = k.key) => http.post('/api/ingest/utility/readings').set('X-Api-Key', key).send({ rows });
    expect((await send([], 'bukan-kunci-yang-benar-sama-sekali')).status).toBe(401);
    expect((await http.post('/api/ingest/utility/readings').send({ rows: [] })).status).toBe(401);
    const ok = await send([{ connectionNumber: conns[2].number, period: month(3), current: '7' }]);
    expect(ok.status).toBe(201);
    expect(ok.body.accepted).toBe(1);
    const row = await db.execute<{ source: string; status: string }>(sql`SELECT source, status FROM utility_readings WHERE connection_id = ${conns[2].id} AND period = ${month(3)}`);
    expect(row.rows[0]).toMatchObject({ source: 'API', status: 'ENTERED' });
    // kunci sistem tidak mengakses data lain selain mengirim angka
    expect((await http.get('/api/utility/readings').set('X-Api-Key', k.key)).status).toBe(401);
    await post(`/api/utility/ingest-keys/${k.id}/revoke`).expect(201);
    expect((await send([{ connectionNumber: conns[2].number, period: month(2), current: '9' }])).status).toBe(401);
  });

  it('lapangan: lokasi + foto disimpan; jauh dari lokasi pelanggan ditandai wajib dicek; foto hanya lewat endpoint khusus', async () => {
    const route = (await get(`/api/utility/field/route?period=${month(2)}`, field).expect(200)).body as { id: string }[];
    expect(route.map((x) => x.id)).toEqual(expect.arrayContaining(conns.map((c) => c.id)));
    expect((await get(`/api/utility/field/route?period=${month(2)}`, fin)).status).toBe(403);
    const near = await post('/api/utility/field/readings', { connectionId: conns[0].id, period: month(2), current: '20', lat: -6.2001, lng: 106.8167, photo: PIXEL }, field);
    expect(near.status).toBe(201);
    expect(near.body.flags).not.toContain('JAUH_DARI_LOKASI');
    const far = await post('/api/utility/field/readings', { connectionId: conns[1].id, period: month(2), current: '25', lat: -6.3, lng: 106.9, photo: PIXEL }, field);
    expect(far.status).toBe(201);
    expect(far.body.flags).toContain('JAUH_DARI_LOKASI');
    expect((await post(`/api/utility/readings/${far.body.id}/verify`, {}, fin)).status).toBe(400); // ditandai → wajib catatan
    await post(`/api/utility/readings/${far.body.id}/verify`, { note: 'Dicek ulang, petugas salah titik' }, fin).expect(201);
    expect((await post('/api/utility/field/readings', { connectionId: conns[2].id, period: month(2), current: '9', lat: -6.2 }, field)).status).toBe(400); // lintang tanpa bujur
    expect((await post('/api/utility/field/readings', { connectionId: conns[2].id, period: month(2), current: '9', photo: 'data:text/html;base64,AAAA' }, field)).status).toBe(400); // bukan gambar
    const list = JSON.stringify((await get(`/api/utility/readings?period=${month(2)}`, fin).expect(200)).body);
    expect(list).not.toContain('base64'); // daftar tidak membawa isi foto
    const ph = (await get(`/api/utility/readings/${near.body.id}/photo`, fin).expect(200)).body;
    expect(ph.photo).toBe(PIXEL);
  });

  let invoiceId: string; let invoiceId2: string;
  it('loket: hanya tagihan utilitas; pelunasan memakai alur faktur; penerimaan dicatat atas nama petugas', async () => {
    // verifikasi dua catatan lalu tagih periode 3 bulan lalu
    const ents = (await get(`/api/utility/readings?period=${month(3)}&status=ENTERED`, fin).expect(200)).body as { id: string }[];
    for (const e of ents) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/utility/billing/run', { period: month(3) }, fin).expect(201);
    const found = (await get('/api/utility/counter/search?q=Budi', fin).expect(200)).body as { invoiceId: string; outstanding: string }[];
    expect(found.length).toBeGreaterThanOrEqual(2);
    invoiceId = found[0].invoiceId;
    invoiceId2 = found[1].invoiceId;
    expect((await get('/api/utility/counter/search?q=Budi', field)).status).toBe(403);
    // faktur non-utilitas ditolak
    const so = await post('/api/utility/counter/pay', { invoiceId: '00000000-0000-4000-8000-000000000000', amount: '1000' }, fin);
    expect(so.status).toBe(400);
    const full = Number(found[0].outstanding);
    expect((await post('/api/utility/counter/pay', { invoiceId, amount: String(full + 1) }, fin)).status).toBe(400); // melebihi sisa
    const p1 = (await post('/api/utility/counter/pay', { invoiceId, amount: String(full) }, fin).expect(201)).body;
    expect(p1.paymentNumber).toBeTruthy();
    const p2 = (await post('/api/utility/counter/pay', { invoiceId: invoiceId2, amount: '10000' }, fin).expect(201)).body;
    expect(p2.receiptId).toBeTruthy();
    const open = (await get('/api/utility/counter/open', fin).expect(200)).body;
    expect(open.items).toHaveLength(2);
    expect(Number(open.expected)).toBe(full + 10000);
    // penerimaan petugas lain tidak ikut
    expect((await get('/api/utility/counter/open', fin2).expect(200)).body.items).toHaveLength(0);
    const inv = (await get(`/api/invoices/${invoiceId}`).expect(200)).body;
    expect(inv.status).toBe('PAID');
  });

  it('setoran harian: selisih wajib dijelaskan; dikonfirmasi orang lain; tidak bisa disetor dua kali', async () => {
    const open = (await get('/api/utility/counter/open', fin).expect(200)).body;
    const exp = Number(open.expected);
    expect((await post('/api/utility/counter/remit', { counted: String(exp - 5000) }, fin)).status).toBe(400); // selisih tanpa penjelasan
    expect((await post('/api/utility/counter/remit', { counted: String(exp) }, fin2)).status).toBe(400); // fin2 tidak punya penerimaan
    const rem = (await post('/api/utility/counter/remit', { counted: String(exp - 5000), note: 'Uang kembalian kurang Rp5.000' }, fin).expect(201)).body;
    expect(rem.number).toMatch(/^STL\//);
    expect(Number(rem.difference)).toBe(-5000);
    expect((await get('/api/utility/counter/open', fin).expect(200)).body.items).toHaveLength(0); // tidak bisa disetor dua kali
    expect((await post('/api/utility/counter/remit', { counted: '0' }, fin)).status).toBe(400);
    // penyetor sendiri tidak boleh mengonfirmasi; Akuntan tidak berhak; selisih wajib catatan keputusan
    expect((await post(`/api/utility/counter/remittances/${rem.id}/decide`, { note: 'oke saja ya' }, fin)).status).toBe(403);
    expect((await post(`/api/utility/counter/remittances/${rem.id}/decide`, {}, acct)).status).toBe(403);
    expect((await post(`/api/utility/counter/remittances/${rem.id}/decide`, {}, fin2)).status).toBe(400);
    await post(`/api/utility/counter/remittances/${rem.id}/decide`, { note: 'Selisih diterima, dipotong dari gaji' }, fin2).expect(201);
    expect((await post(`/api/utility/counter/remittances/${rem.id}/decide`, { note: 'lagi lagi' }, fin2)).status).toBe(400); // sudah diputuskan
    const c = (await get('/api/utility/counter/controls', acct).expect(200)).body;
    expect(c.remittancesWithDifference.map((x: { number: string }) => x.number)).toContain(rem.number);
    const audited = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity IN ('UtilityRemittance','UtilityCounterReceipt')`);
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it('kontrol: pembayaran loket tanpa catatan penerimaan terdeteksi', async () => {
    // pembayaran bertanda Loket yang dibuat tanpa jalur loket (mis. gagal menyimpan penerimaan) harus muncul di kontrol
    const found = (await get('/api/utility/counter/search?q=Budi', fin).expect(200)).body as { invoiceId: string }[];
    expect(found.length).toBeGreaterThanOrEqual(1);
    await post('/api/payments', { invoiceId: found[0].invoiceId, amount: '1000', method: 'CASH', notes: 'Loket - manual' }, fin).expect(201);
    const c = (await get('/api/utility/counter/controls', acct).expect(200)).body;
    expect(c.receiptsWithoutRecord.length).toBeGreaterThanOrEqual(1);
  });

  it('isolasi: perusahaan lain tidak melihat kunci, penerimaan, atau setoran', async () => {
    const other = (await http.post('/api/auth/register').send({ companyName: 'PAM Lain', name: 'Lain', email: `utl-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    expect((await get('/api/utility/ingest-keys', other).expect(200)).body).toHaveLength(0);
    expect((await get('/api/utility/counter/remittances', other).expect(200)).body).toHaveLength(0);
    expect((await get('/api/utility/counter/search?q=Budi', other).expect(200)).body).toHaveLength(0);
  });
});
