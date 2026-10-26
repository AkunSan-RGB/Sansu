/**
 * Layanan air: permohonan sambungan baru (survei → biaya → bayar → pasang → aktif) dan mutasi pelanggan (balik nama, ganti tarif, alamat, tutup).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Layanan air: permohonan sambungan & mutasi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string; let fin: string; let adm: string; let sales: string; let field: string;
  let finId: string; let fieldId: string; let tariff: string; let tariff2: string; let custB: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Sambungan', name: 'Pemilik', email: `psb-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `psb-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `psb-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); adm = await mk('ADMIN', 'adm'); sales = await mk('SALES', 'cs'); field = await mk('WAREHOUSE', 'teknisi');
    const staff = (await get('/api/utility/staff', fin).expect(200)).body as { id: string; name: string }[];
    finId = staff.find((s) => s.name === 'fin')!.id; fieldId = staff.find((s) => s.name === 'teknisi')!.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    tariff2 = (await post('/api/utility/tariffs', { name: 'Air Niaga', serviceType: 'AIR', fixedFee: 30000, adminFee: 0, blocks: [{ upTo: null, price: 6000 }] }, fin).expect(201)).body.id;
    custB = (await post('/api/customers', { code: 'PLG-B', name: 'Pemilik Baru', paymentTermDays: 20 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  let appId: string; let invoiceId: string; let connId: string;
  it('permohonan: dicatat Pelayanan pelanggan; survei oleh petugas; tidak layak langsung ditolak', async () => {
    const a = (await post('/api/utility/applications', { applicantName: 'Bambang Susilo', phone: '081234567890', address: 'Jl. Melati 12, Sleman', tariffId: tariff }, sales).expect(201)).body;
    expect(a.number).toMatch(/^PSB\//);
    appId = a.id;
    expect((await post(`/api/utility/applications/${appId}/quote`, {}, sales)).status).toBe(400); // belum disurvei
    expect((await post(`/api/utility/applications/${appId}/survey`, { feasible: true, note: 'Jaringan 15 m dari pipa distribusi' }, sales)).status).toBe(403);
    const s = (await post(`/api/utility/applications/${appId}/survey`, { feasible: true, pipeLength: '15', note: 'Jaringan 15 m dari pipa distribusi' }, field).expect(201)).body;
    expect(s.status).toBe('SURVEI');
    const bad = (await post('/api/utility/applications', { applicantName: 'Pemohon Jauh', address: 'Dusun terpencil 1', tariffId: tariff }, sales).expect(201)).body.id;
    expect((await post(`/api/utility/applications/${bad}/survey`, { feasible: false, note: 'x' }, field)).status).toBe(400);
    const r = (await post(`/api/utility/applications/${bad}/survey`, { feasible: false, note: 'Terlalu jauh dari jaringan (2 km)' }, field).expect(201)).body;
    expect(r.status).toBe('DITOLAK');
  });

  it('biaya sambung: tagihan non-air terbit, pemasangan menunggu lunas, aktivasi bukan oleh pemasang', async () => {
    const q = (await post(`/api/utility/applications/${appId}/quote`, {}, sales).expect(201)).body;
    expect(q.status).toBe('MENUNGGU_BAYAR');
    expect(q.invoice_number).toBeTruthy();
    expect(Number(q.invoice_total)).toBeGreaterThan(0);
    invoiceId = q.cost_invoice_id;
    expect((await post(`/api/utility/applications/${appId}/install`, { installerId: finId, meterSerial: 'MTR-9001' }, sales)).status).toBe(400); // belum lunas
    await post('/api/payments', { invoiceId, amount: q.invoice_total, method: 'TRANSFER' }, fin).expect(201);
    expect((await get(`/api/utility/applications/${appId}`, sales).expect(200)).body.paid).toBe(true);
    await post(`/api/utility/applications/${appId}/install`, { installerId: finId, meterSerial: 'MTR-9001', note: 'Meter 1/2 inci' }, sales).expect(201);
    expect((await post(`/api/utility/applications/${appId}/activate`, { initialReading: '0' }, fin)).status).toBe(403); // pemasang = pengaktif
    const done = (await post(`/api/utility/applications/${appId}/activate`, { initialReading: '0' }, adm).expect(201)).body;
    expect(done.status).toBe('AKTIF');
    expect(done.connection_number).toMatch(/^SBG\//);
    connId = done.connection_id;
    const conns = (await get('/api/utility/connections', fin).expect(200)).body as { id: string; customerName: string; address: string; meterNo: string }[];
    const c = conns.find((x) => x.id === connId)!;
    expect(c.customerName).toBe('Bambang Susilo');
    expect(c.meterNo).toBe('MTR-9001');
    expect((await post(`/api/utility/applications/${appId}/close`, { reason: 'sudah aktif' }, sales)).status).toBe(400);
    const counts = (await get('/api/utility/applications/counts', fin).expect(200)).body;
    expect(counts.AKTIF).toBe(1);
    expect(counts.DITOLAK).toBe(1);
  });

  it('mutasi: ganti golongan diajukan satu orang dan disetujui orang lain; tarif berpindah', async () => {
    const ch = (await post('/api/utility/changes', { connectionId: connId, kind: 'GANTI_TARIF', newTariffId: tariff2, reason: 'Pelanggan membuka usaha warung' }, sales).expect(201)).body;
    expect(ch.status).toBe('DIAJUKAN');
    expect((await post('/api/utility/changes', { connectionId: connId, kind: 'GANTI_TARIF', newTariffId: tariff2, reason: 'ganda' }, sales)).status).toBe(400); // sudah ada yang menunggu
    expect((await post(`/api/utility/changes/${ch.id}/approve`, {}, sales)).status).toBe(403); // peran
    const own = (await post('/api/utility/changes', { connectionId: connId, kind: 'PINDAH_ALAMAT', newAddress: 'Jl. Melati 14, Sleman', reason: 'Penomoran ulang' }, fin).expect(201)).body;
    expect((await post(`/api/utility/changes/${own.id}/approve`, {}, fin)).status).toBe(403); // pengaju sendiri
    await post(`/api/utility/changes/${own.id}/approve`, {}, adm).expect(201);
    const ok = (await post(`/api/utility/changes/${ch.id}/approve`, { note: 'Disetujui' }, fin).expect(201)).body;
    expect(ok.status).toBe('DISETUJUI');
    expect(ok.after.tariff).toBe('Air Niaga');
    const c = ((await get('/api/utility/connections', fin).expect(200)).body as { id: string; tariffName: string; address: string }[]).find((x) => x.id === connId)!;
    expect(c.tariffName).toBe('Air Niaga');
    expect(c.address).toBe('Jl. Melati 14, Sleman');
  });

  it('mutasi: balik nama dan tutup permanen; syarat tunggakan dan penolakan', async () => {
    const bn = (await post('/api/utility/changes', { connectionId: connId, kind: 'BALIK_NAMA', newCustomerId: custB, reason: 'Rumah dijual' }, sales).expect(201)).body;
    const rej = (await post(`/api/utility/changes/${bn.id}/reject`, { note: 'Berkas belum lengkap' }, fin).expect(201)).body;
    expect(rej.status).toBe('DITOLAK');
    const bn2 = (await post('/api/utility/changes', { connectionId: connId, kind: 'BALIK_NAMA', newCustomerId: custB, reason: 'Rumah dijual, akta lengkap' }, sales).expect(201)).body;
    await post(`/api/utility/changes/${bn2.id}/approve`, {}, fin).expect(201);
    expect(((await get('/api/utility/connections', fin).expect(200)).body as { id: string; customerName: string }[]).find((x) => x.id === connId)!.customerName).toBe('Pemilik Baru');
    const tp = (await post('/api/utility/changes', { connectionId: connId, kind: 'TUTUP_PERMANEN', reason: 'Pelanggan pindah kota' }, sales).expect(201)).body;
    await post(`/api/utility/changes/${tp.id}/approve`, {}, fin).expect(201);
    expect(((await get('/api/utility/connections', fin).expect(200)).body as { id: string; status: string }[]).find((x) => x.id === connId)!.status).toBe('DISCONNECTED');
    expect((await post('/api/utility/changes', { connectionId: connId, kind: 'PINDAH_ALAMAT', newAddress: 'Alamat baru 99', reason: 'uji' }, sales)).status).toBe(400); // sudah ditutup
    expect((await get('/api/utility/changes?status=DISETUJUI', fin).expect(200)).body.length).toBeGreaterThanOrEqual(4);
  });
});
