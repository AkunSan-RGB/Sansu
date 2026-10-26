/**
 * Layanan air: pengaduan, perintah kerja, dan aset jaringan — alur status, pemisahan fungsi, hak peran.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Layanan air: pengaduan, perintah kerja, aset jaringan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string; let fin: string; let sales: string; let field: string; let field2: string; let acct: string; let cashier: string;
  let fieldId: string; let customer: string; let connId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const put = (url: string, body: object = {}, t = owner) => http.put(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Pengaduan', name: 'Pemilik', email: `pgd-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `pgd-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `pgd-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); sales = await mk('SALES', 'cs'); field = await mk('WAREHOUSE', 'teknisi'); field2 = await mk('WAREHOUSE', 'teknisi2'); acct = await mk('ACCOUNTANT', 'akt'); cashier = await mk('CASHIER', 'kasir');
    const staff = (await get('/api/utility/staff', fin).expect(200)).body as { id: string; name: string }[];
    fieldId = staff.find((s) => s.name === 'teknisi')!.id;
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Siti', paymentTermDays: 20 }).expect(201)).body.id;
    const tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    connId = (await post('/api/utility/connections', { customerId: customer, tariffId: tariff, address: 'Blok 1', meterNo: 'MP-1', installedAt: '2026-01-05', initialReading: '0' }, fin).expect(201)).body.id;
  });
  afterAll(() => app.close());

  let cid: string; let wid: string; let aid: string;
  it('pengaduan: dicatat Pelayanan pelanggan, nomor + batas waktu otomatis, prioritas tinggi untuk air mati', async () => {
    expect((await post('/api/utility/complaints', { category: 'AIR_MATI', description: 'Air tidak mengalir sejak pagi' }, sales)).status).toBe(400); // tanpa pelapor/sambungan
    const r = (await post('/api/utility/complaints', { connectionId: connId, category: 'AIR_MATI', description: 'Air tidak mengalir sejak pagi', channel: 'TELEPON' }, sales).expect(201)).body;
    expect(r.number).toMatch(/^PGD\//);
    cid = r.id;
    const c = (await get(`/api/utility/complaints/${cid}`, fin).expect(200)).body;
    expect(c.status).toBe('BARU');
    expect(c.priority).toBe('TINGGI');
    expect(c.customer_name).toBe('Siti');
    expect(new Date(c.due_at).getTime()).toBeGreaterThan(Date.now());
    expect(c.events).toHaveLength(1);
    expect((await get('/api/utility/complaints/summary', fin).expect(200)).body.baru).toBe(1);
  });

  it('hak peran: Akuntan hanya melihat; Kasir tidak melihat; Petugas lapangan tidak menugaskan', async () => {
    expect((await get('/api/utility/complaints', acct).expect(200)).body).toHaveLength(1);
    expect((await post('/api/utility/complaints', { connectionId: connId, category: 'LAINNYA', description: 'uji akuntan' }, acct)).status).toBe(403);
    expect((await get('/api/utility/complaints', cashier)).status).toBe(403);
    expect((await post(`/api/utility/complaints/${cid}/assign`, { assigneeId: fieldId }, field)).status).toBe(403);
  });

  it('penugasan dan status: berurutan, petugas lain tak bisa mengerjakan, selesai wajib hasil, penutupan oleh orang lain', async () => {
    expect((await post(`/api/utility/complaints/${cid}/status`, { status: 'DIKERJAKAN' }, fin)).status).toBe(400); // belum ditugaskan
    expect((await post(`/api/utility/complaints/${cid}/assign`, { assigneeId: '00000000-0000-4000-8000-000000000000' }, sales)).status).toBe(400);
    await post(`/api/utility/complaints/${cid}/assign`, { assigneeId: fieldId, note: 'cek meter induk' }, sales).expect(201);
    expect((await post(`/api/utility/complaints/${cid}/status`, { status: 'DIKERJAKAN' }, field2)).status).toBe(403); // bukan tugasnya
    await post(`/api/utility/complaints/${cid}/status`, { status: 'DIKERJAKAN' }, field).expect(201);
    expect((await post(`/api/utility/complaints/${cid}/status`, { status: 'SELESAI' }, field)).status).toBe(400); // hasil wajib
    await post(`/api/utility/complaints/${cid}/note`, { note: 'Katup distribusi tertutup' }, field).expect(201);
    await post(`/api/utility/complaints/${cid}/status`, { status: 'SELESAI', resolution: 'Katup dibuka, aliran normal' }, field).expect(201);
    expect((await post(`/api/utility/complaints/${cid}/status`, { status: 'DITUTUP' }, field)).status).toBe(403); // pelaksana tak boleh menutup
    const done = (await post(`/api/utility/complaints/${cid}/status`, { status: 'DITUTUP' }, fin).expect(201)).body;
    expect(done.status).toBe('DITUTUP');
    expect(done.events.length).toBeGreaterThanOrEqual(5);
    expect((await post(`/api/utility/complaints/${cid}/status`, { status: 'DIKERJAKAN' }, fin)).status).toBe(400); // sudah ditutup
  });

  it('aset jaringan dan perintah kerja: terhubung ke pengaduan, status otomatis, kondisi aset ikut diperbarui', async () => {
    aid = (await post('/api/utility/network-assets', { code: 'rsv-01', name: 'Reservoir Gamping', type: 'RESERVOIR', zone: 'Zona A', condition: 'PERLU_PERAWATAN' }).expect(201)).body.id;
    expect((await post('/api/utility/network-assets', { code: 'RSV-01', name: 'Dobel', type: 'POMPA' })).status).toBe(400);
    expect((await post('/api/utility/network-assets', { code: 'X', name: 'Salah peran', type: 'POMPA' }, sales)).status).toBe(403);
    const c2 = (await post('/api/utility/complaints', { connectionId: connId, category: 'PIPA_BOCOR', description: 'Pipa bocor di depan rumah' }, sales).expect(201)).body.id;
    const wo = (await post('/api/utility/work-orders', { assetId: aid, complaintId: c2, type: 'PERBAIKAN', title: 'Tambal pipa bocor', assigneeId: fieldId }, fin).expect(201)).body;
    expect(wo.number).toMatch(/^PKJ\//);
    wid = wo.id;
    expect((await get(`/api/utility/complaints/${c2}`, fin).expect(200)).body.status).toBe('DITUGASKAN');
    expect((await post(`/api/utility/work-orders/${wid}/status`, { status: 'SELESAI', result: 'x' }, field)).status).toBe(400); // dari DIBUAT tak bisa langsung selesai
    expect((await post(`/api/utility/work-orders/${wid}/status`, { status: 'DIKERJAKAN' }, field2)).status).toBe(403);
    await post(`/api/utility/work-orders/${wid}/status`, { status: 'DIKERJAKAN' }, field).expect(201);
    expect((await get(`/api/utility/complaints/${c2}`, fin).expect(200)).body.status).toBe('DIKERJAKAN');
    expect((await post(`/api/utility/work-orders/${wid}/status`, { status: 'SELESAI' }, field)).status).toBe(400); // hasil wajib
    await post(`/api/utility/work-orders/${wid}/status`, { status: 'SELESAI', result: 'Pipa diganti sepanjang 2 meter', laborCost: '150000', materialCost: '85000', assetCondition: 'BAIK' }, field).expect(201);
    expect((await get(`/api/utility/complaints/${c2}`, fin).expect(200)).body.status).toBe('SELESAI');
    const assets = (await get('/api/utility/network-assets', fin).expect(200)).body as { code: string; condition: string; open_orders: number; last_done: string | null }[];
    const a = assets.find((x) => x.code === 'RSV-01')!;
    expect(a.condition).toBe('BAIK');
    expect(a.open_orders).toBe(0);
    expect(a.last_done).toBeTruthy();
    const s = (await get('/api/utility/work-orders/summary', fin).expect(200)).body;
    expect(s.done30d).toBe(1);
    expect(s.cost30d).toBe(235000);
    expect((await put(`/api/utility/network-assets/${aid}`, { code: 'RSV-01', name: 'Reservoir Gamping', type: 'RESERVOIR', condition: 'BAIK', isActive: false }).expect(200)).body.id).toBe(aid);
  });
});
