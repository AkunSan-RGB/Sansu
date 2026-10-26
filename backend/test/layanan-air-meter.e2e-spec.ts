/**
 * Layanan air: rute baca, inventaris meter + tera ulang + ganti meter, dan tagihan taksiran dengan koreksi otomatis.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Layanan air: rute, meter, taksiran (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  let owner: string; let fin: string; let field: string; let sales: string; let fieldId: string; let tariff: string;
  const conns: string[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const readings = async (connId: string) => (await get(`/api/utility/readings?connectionId=${connId}`, fin).expect(200)).body as { period: string; usage: string; current: string; flags: string[]; status: string; id: string; source: string }[];
  const verifyAll = async (period: string) => {
    const ents = (await get(`/api/utility/readings?period=${period}&status=ENTERED`, fin).expect(200)).body as { id: string }[];
    for (const e of ents) await post(`/api/utility/readings/${e.id}/verify`, { note: 'Sesuai catatan, sudah dicek' }, fin).expect(201);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Meter', name: 'Pemilik', email: `mtr-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `mtr-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `mtr-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); field = await mk('WAREHOUSE', 'baca'); sales = await mk('SALES', 'cs');
    fieldId = ((await get('/api/utility/staff', fin).expect(200)).body as { id: string; name: string }[]).find((s) => s.name === 'baca')!.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (let i = 1; i <= 4; i++) {
      const cust = (await post('/api/customers', { code: `P${i}`, name: `Pelanggan ${i}`, paymentTermDays: 20 }).expect(201)).body.id;
      conns.push((await post('/api/utility/connections', { customerId: cust, tariffId: tariff, address: `Jl. Uji No. ${i}0`, meterNo: `OLD-${i}`, installedAt: `${month(8)}-05`, initialReading: '0' }, fin).expect(201)).body.id);
    }
  });
  afterAll(() => app.close());

  it('rute baca: dibuat Admin/Keuangan, sambungan dimasukkan berurutan, progres per periode, daftar baca petugas', async () => {
    const rt = (await post('/api/utility/routes', { code: 'r-01', name: 'Rute Uji', readerId: fieldId, collectorId: fieldId, zone: 'Zona A' }, fin).expect(201)).body.id;
    expect((await post('/api/utility/routes', { code: 'R-01', name: 'Dobel' }, fin)).status).toBe(400);
    expect((await post('/api/utility/routes', { code: 'R-X', name: 'Salah peran' }, field)).status).toBe(403);
    expect((await get('/api/utility/routes/unassigned', fin).expect(200)).body).toHaveLength(4);
    await post('/api/utility/routes/assign', { routeId: rt, connectionIds: conns.slice(0, 3) }, fin).expect(201);
    expect((await get('/api/utility/routes/unassigned', fin).expect(200)).body).toHaveLength(1);
    await post('/api/utility/readings', { connectionId: conns[0], period: month(7), current: '10' }, field).expect(201);
    const list = (await get(`/api/utility/routes?period=${month(7)}`, field).expect(200)).body;
    const r = list.routes[0];
    expect(r.code).toBe('R-01');
    expect(r.connections).toBe(3);
    expect(r.metered).toBe(3);
    expect(r.read).toBe(1);
    expect(r.pct).toBe(33);
    const stops = (await get(`/api/utility/routes/${rt}/stops?period=${month(7)}`, field).expect(200)).body.stops as { number: string; status: string | null; route_seq: number }[];
    expect(stops.map((s) => s.route_seq)).toEqual([1, 2, 3]);
    expect(stops.filter((s) => s.status).length).toBe(1);
    const mine = (await get(`/api/utility/field/route?period=${month(6)}&routeId=${rt}`, field).expect(200)).body as unknown[];
    expect(mine).toHaveLength(3);
    await post('/api/utility/routes/assign', { connectionIds: [conns[2]] }, fin).expect(201); // keluarkan dari rute
    expect((await get('/api/utility/routes/unassigned', fin).expect(200)).body).toHaveLength(2);
  });

  let meterA: string; let meterB: string;
  it('meter: impor dari sambungan, daftar baru, tera ulang, ganti meter melepas yang lama dan memasang yang baru', async () => {
    expect((await post('/api/utility/meters/sync', {}, fin)).status).toBe(403);
    expect((await post('/api/utility/meters/sync', {}, field).expect(201)).body.imported).toBe(4);
    expect((await post('/api/utility/meters/sync', {}, field).expect(201)).body.imported).toBe(0);
    meterA = (await post('/api/utility/meters', { serial: 'NEW-100', brand: 'Itron', size: '1/2"', lastCalibratedOn: '2020-01-10' }, field).expect(201)).body.id;
    meterB = (await post('/api/utility/meters', { serial: 'NEW-101', brand: 'Itron', size: '1/2"' }, field).expect(201)).body.id;
    expect((await post('/api/utility/meters', { serial: 'NEW-100' }, field)).status).toBe(400);
    const sum = (await get('/api/utility/meters/summary', fin).expect(200)).body;
    expect(sum.by.TERPASANG).toBe(4);
    expect(sum.by.STOK).toBe(2);
    // meter dengan tera lama jatuh tempo bila dipasang (stok tidak dihitung)
    const rp = (await post('/api/utility/meters/replace', { connectionId: conns[3], newMeterId: meterA, oldStatus: 'RUSAK', reason: 'Meter lama macet, tidak berputar' }, field).expect(201)).body;
    expect(rp.oldSerial).toBe('OLD-4');
    expect(rp.newSerial).toBe('NEW-100');
    expect((await post('/api/utility/meters/replace', { connectionId: conns[3], newMeterId: meterA, oldStatus: 'RUSAK', reason: 'Meter sudah terpasang' }, field)).status).toBe(400); // bukan stok lagi
    const m = (await get(`/api/utility/meters/${meterA}`, fin).expect(200)).body;
    expect(m.status).toBe('TERPASANG');
    expect(m.events.map((e: { kind: string }) => e.kind)).toEqual(['REGISTRASI', 'PASANG']);
    expect(m.days_to_calibration).toBeLessThan(0); // tera 2020 + 5 tahun sudah lewat
    const due = (await get('/api/utility/meters?due=true', fin).expect(200)).body as { serial: string }[];
    expect(due.map((x) => x.serial)).toContain('NEW-100');
    const old = ((await get('/api/utility/meters?status=RUSAK', fin).expect(200)).body as { serial: string; connection_id: string | null }[])[0];
    expect(old.serial).toBe('OLD-4');
    expect(old.connection_id).toBeNull();
    const cal = (await post(`/api/utility/meters/${meterA}/calibrate`, { note: 'Ditera ulang oleh UPT Metrologi' }, field).expect(201)).body;
    expect(cal.days_to_calibration).toBeGreaterThan(1500);
    expect((await get('/api/utility/meters?due=true', fin).expect(200)).body as unknown[]).toHaveLength(0);
    expect((await post(`/api/utility/meters/${meterB}/status`, { status: 'RUSAK', note: 'Rusak sejak dari pabrik' }, field).expect(201)).body.status).toBe('RUSAK');
    expect((await post(`/api/utility/meters/${meterA}/status`, { status: 'RUSAK', note: 'masih terpasang' }, field)).status).toBe(400);
    const cn = ((await get('/api/utility/connections', fin).expect(200)).body as { id: string; meterNo: string }[]).find((x) => x.id === conns[3])!;
    expect(cn.meterNo).toBe('NEW-100');
  });

  it('taksiran: rata-rata pemakaian nyata, perlu verifikasi, dikoreksi otomatis pada pembacaan nyata berikutnya', async () => {
    const c = conns[1];
    await post('/api/utility/readings', { connectionId: c, period: month(7), current: '20' }, field).expect(201);
    await verifyAll(month(7));
    await post('/api/utility/readings', { connectionId: c, period: month(6), current: '40' }, field).expect(201);
    await verifyAll(month(6));
    expect((await post('/api/utility/readings/estimate', { connectionId: c, period: month(5) }, sales)).status).toBe(403);
    const est = (await post('/api/utility/readings/estimate', { connectionId: c, period: month(5), note: 'Meter tertutup pagar terkunci' }, field).expect(201)).body;
    expect(Number(est.usage)).toBe(20);
    expect(est.source).toBe('TAKSIRAN');
    expect(est.flags).toContain('TAKSIRAN');
    await verifyAll(month(5));
    // pembacaan nyata: 75 → pemakaian nyata sejak 40 = 35, dikurangi taksiran 20 = 15
    await post('/api/utility/readings', { connectionId: c, period: month(4), current: '75' }, field).expect(201);
    const rs = await readings(c);
    const next = rs.find((r) => r.period === month(4))!;
    expect(Number(next.usage)).toBe(15);
    expect(next.flags).not.toContain('TAKSIRAN_LEBIH');
    // jangan meter turun di bawah angka nyata terakhir
    const c2 = conns[2];
    await post('/api/utility/readings', { connectionId: c2, period: month(7), current: '20' }, field).expect(201);
    await verifyAll(month(7));
    await post('/api/utility/readings', { connectionId: c2, period: month(6), current: '40' }, field).expect(201);
    await verifyAll(month(6));
    await post('/api/utility/readings/estimate', { connectionId: c2, period: month(5) }, field).expect(201); // +20 → 60
    await verifyAll(month(5));
    expect((await post('/api/utility/readings', { connectionId: c2, period: month(4), current: '39' }, field)).status).toBe(400); // di bawah angka nyata terakhir (40)
    await post('/api/utility/readings', { connectionId: c2, period: month(4), current: '50' }, field).expect(201); // nyata sejak 40 = 10 < taksiran 20
    const over = (await readings(c2)).find((r) => r.period === month(4))!;
    expect(Number(over.usage)).toBe(0);
    expect(over.flags).toContain('TAKSIRAN_LEBIH');
  });

  it('taksiran: butuh riwayat dan paling lama dua periode berturut-turut', async () => {
    expect((await post('/api/utility/readings/estimate', { connectionId: conns[3], period: month(6) }, field)).status).toBe(400); // belum punya riwayat nyata terverifikasi
    const c = conns[0];
    const e1 = await post('/api/utility/readings/estimate', { connectionId: c, period: month(6) }, field);
    expect(e1.status).toBe(201);
    await verifyAll(month(6));
    expect((await post('/api/utility/readings/estimate', { connectionId: c, period: month(5) }, field)).status).toBe(201);
    await verifyAll(month(5));
    expect((await post('/api/utility/readings/estimate', { connectionId: c, period: month(4) }, field)).status).toBe(400); // tiga kali berturut-turut
  });
});
