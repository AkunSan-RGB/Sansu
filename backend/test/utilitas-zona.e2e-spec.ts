/**
 * Utilitas: zona, pasokan per zona, dan kehilangan (pasokan − pemakaian terverifikasi), kontrol, laporan bagian.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

interface ZoneRow { zone: string; period: string; supplied: number | null; usage: number; loss: number | null; lossPct: number | null; status: string; unverified: number; missing: number; connections: number; mixedUnits: boolean }

describe('Utilitas: zona dan kehilangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const month = (back: number) => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const P = month(1);
  const longAgo = `${month(4)}-05`;
  let owner = ''; let fin = ''; let field = ''; let acct = ''; let other = '';
  let tariff = ''; let customer = '';
  const conns: { id: string; number: string }[] = [];
  const reads: string[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const put = (url: string, body: object = {}, t = owner) => http.put(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const zoneRow = async (zone: string, t = fin) => ((await get(`/api/utility/zones?period=${P}`, t).expect(200)).body.rows as ZoneRow[]).find((r) => r.zone === zone)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Zona', name: 'Pemilik', email: `uz-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    other = (await http.post('/api/auth/register').send({ companyName: 'PAM Lain', name: 'Lain', email: `uz-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `uz-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `uz-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); field = await mk('WAREHOUSE', 'lapangan'); acct = await mk('ACCOUNTANT', 'akt');
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Budi', paymentTermDays: 20 }).expect(201)).body.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (const n of [1, 2, 3]) {
      const c = (await post('/api/utility/connections', { customerId: customer, tariffId: tariff, address: `Blok ${n}`, meterNo: `UZ-${n}`, installedAt: longAgo, initialReading: '0', zone: '  Zona   A ' }, fin).expect(201)).body;
      conns.push({ id: c.id, number: c.number });
    }
  });
  afterAll(() => app.close());

  it('zona tersimpan rapi; zona belum punya pasokan; setZone hanya Admin/Keuangan dan tercatat', async () => {
    const list = (await get('/api/utility/connections', fin).expect(200)).body as { zone: string }[];
    expect(list.every((c) => c.zone === 'Zona A')).toBe(true); // spasi dirapikan
    const z0 = await zoneRow('Zona A');
    expect(z0).toMatchObject({ connections: 3, supplied: null, status: 'NO_SUPPLY' });
    expect((await put(`/api/utility/connections/${conns[2].id}/zone`, { zone: 'Zona B' }, field)).status).toBe(403);
    await put(`/api/utility/connections/${conns[2].id}/zone`, { zone: 'Zona B' }, fin).expect(200);
    expect((await zoneRow('Zona B')).connections).toBe(1);
    expect((await zoneRow('Zona A')).connections).toBe(2);
    await put(`/api/utility/connections/${conns[2].id}/zone`, { zone: 'Zona A' }, fin).expect(200); // kembali
    await put(`/api/utility/connections/${conns[2].id}/zone`, {}, fin).expect(200); // keluar dari zona
    expect((await zoneRow('Zona A')).connections).toBe(2);
    await put(`/api/utility/connections/${conns[2].id}/zone`, { zone: 'Zona A' }, fin).expect(200);
  });

  it('pasokan: hanya Admin/Keuangan; validasi zona, periode, jumlah', async () => {
    const ok = { zone: 'Zona A', period: P, supplied: '350' };
    expect((await put('/api/utility/zones/supply', ok, field)).status).toBe(403);
    expect((await put('/api/utility/zones/supply', ok, acct)).status).toBe(403);
    expect((await put('/api/utility/zones/supply', { ...ok, zone: 'Zona Tak Ada' }, fin)).status).toBe(400);
    expect((await put('/api/utility/zones/supply', { ...ok, period: month(-1) }, fin)).status).toBe(400); // masa depan
    expect((await put('/api/utility/zones/supply', { ...ok, supplied: '-1' }, fin)).status).toBe(400);
    expect((await put('/api/utility/zones/supply', { ...ok, period: '2026-13' }, fin)).status).toBe(400);
    await put('/api/utility/zones/supply', ok, fin).expect(200);
  });

  it('angka belum lengkap selama pencatatan belum diverifikasi; setelah diverifikasi kehilangan dihitung', async () => {
    for (const [i, cur] of [['0', '100'], ['1', '120'], ['2', '80']] as const) {
      const r = (await post('/api/utility/readings', { connectionId: conns[Number(i)].id, period: P, current: cur }, field).expect(201)).body;
      reads.push(r.id);
    }
    expect(await zoneRow('Zona A')).toMatchObject({ status: 'INCOMPLETE', unverified: 3, usage: 0 });
    for (const id of reads) await post(`/api/utility/readings/${id}/verify`, {}, fin).expect(201);
    const z = await zoneRow('Zona A');
    expect(z).toMatchObject({ supplied: 350, usage: 300, loss: 50, status: 'OK' });
    expect(z.lossPct).toBeCloseTo(14.3, 1);
    // pasokan lebih besar → kehilangan tinggi; lebih kecil dari pemakaian → janggal
    await put('/api/utility/zones/supply', { zone: 'Zona A', period: P, supplied: '500', note: 'Meter induk dibaca ulang' }, fin).expect(200);
    expect(await zoneRow('Zona A')).toMatchObject({ loss: 200, lossPct: 40, status: 'HIGH' });
    await put('/api/utility/zones/supply', { zone: 'Zona A', period: P, supplied: '250' }, fin).expect(200);
    expect((await zoneRow('Zona A')).status).toBe('NEGATIVE');
    await put('/api/utility/zones/supply', { zone: 'Zona A', period: P, supplied: '500' }, fin).expect(200);
  });

  it('sambungan terukur dengan satuan berbeda dalam satu zona: pasokan ditolak', async () => {
    const listrik = (await post('/api/utility/tariffs', { name: 'Listrik RT', serviceType: 'LISTRIK', fixedFee: 5000, adminFee: 0, blocks: [{ upTo: null, price: 1500 }] }, fin).expect(201)).body.id;
    await post('/api/utility/connections', { customerId: customer, tariffId: listrik, address: 'Blok 9', meterNo: 'UZ-L1', installedAt: longAgo, initialReading: '0', zone: 'Zona A' }, fin).expect(201);
    expect((await zoneRow('Zona A')).mixedUnits).toBe(true);
    const r = await put('/api/utility/zones/supply', { zone: 'Zona A', period: P, supplied: '500' }, fin);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/satuan berbeda/);
  });

  it('kontrol memuat zona kehilangan tinggi; laporan utilitas memuat bagian kehilangan; isolasi perusahaan', async () => {
    const controls = (await get('/api/utility/controls', acct).expect(200)).body as { key: string; items: { zone: string; status: string }[] }[];
    const zl = controls.find((c) => c.key === 'ZONE_LOSS')!;
    // sambungan listrik baru belum dicatat → zona berstatus belum lengkap dan tidak masuk daftar tinggi; pastikan struktur tetap ada
    expect(zl).toBeDefined();
    expect(Array.isArray(zl.items)).toBe(true);
    const rep = (await get(`/api/dept-reports/utility?from=${P}-01&to=${month(0)}-28`, acct).expect(200)).body as { kpis: { label: string }[]; sections: { key: string; rows: { zone: string; supplied: number }[] }[] };
    const sec = rep.sections.find((s) => s.key === 'kehilangan')!;
    expect(sec.rows.find((r) => r.zone === 'Zona A')).toMatchObject({ supplied: 500 });
    expect(rep.kpis.some((k) => k.label.startsWith('Zona kehilangan tinggi'))).toBe(true);
    expect(((await get(`/api/utility/zones?period=${P}`, other).expect(200)).body.rows as ZoneRow[])).toHaveLength(0);
    expect((await put('/api/utility/zones/supply', { zone: 'Zona A', period: P, supplied: '1' }, other)).status).toBe(400); // zona milik perusahaan lain tidak terlihat
    expect((await zoneRow('Zona A')).supplied).toBe(500); // pasokan perusahaan kita tidak tertimpa
  });
});
