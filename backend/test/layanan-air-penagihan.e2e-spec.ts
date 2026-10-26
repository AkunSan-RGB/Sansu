/**
 * Layanan air: penagihan lapangan (kolektor), cetak/kirim massal + surat peringatan, portal pelanggan,
 * produksi + NRW, kualitas air, dan laporan kinerja.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Layanan air: penagihan, surat, portal, produksi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const month = (back: number) => {
    const t = today.slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const dayShift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let owner: string; let fin: string; let field: string; let field2: string; let sales: string; let acct: string; let cashier: string;
  let fieldId: string; let tenantId: string; let tariff: string;
  const conns: string[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Tagih', name: 'Pemilik', email: `tgh-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `tgh-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `tgh-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); field = await mk('WAREHOUSE', 'kolektor'); field2 = await mk('WAREHOUSE', 'kolektor2'); sales = await mk('SALES', 'cs'); acct = await mk('ACCOUNTANT', 'akt'); cashier = await mk('CASHIER', 'kasir');
    tenantId = (await db.execute<{ id: string }>(sql`SELECT tenant_id AS id FROM users WHERE email = ${`tgh-${stamp}@uji.id`}`)).rows[0].id;
    fieldId = ((await get('/api/utility/staff', fin).expect(200)).body as { id: string; name: string }[]).find((s) => s.name === 'kolektor')!.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (let i = 1; i <= 3; i++) {
      const cust = (await post('/api/customers', { code: `T${i}`, name: `Warga ${i}`, phone: `08123456780${i}`, paymentTermDays: 20 }).expect(201)).body.id;
      conns.push((await post('/api/utility/connections', { customerId: cust, tariffId: tariff, address: `Jl. Tagih ${i}`, meterNo: `TG-${i}`, installedAt: `${month(5)}-05`, initialReading: '0' }, fin).expect(201)).body.id);
    }
    // tagihan bulan lalu-2, dibuat menunggak 45 hari (sambungan 1 dan 2); sambungan 3 tidak dibaca
    for (const c of conns.slice(0, 2)) await post('/api/utility/readings', { connectionId: c, period: month(2), current: '20' }, field).expect(201);
    for (const e of (await get(`/api/utility/readings?period=${month(2)}&status=ENTERED`, fin).expect(200)).body as { id: string }[]) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/utility/billing/run', { period: month(2) }, fin).expect(201);
    await db.execute(sql`UPDATE invoices SET date = ${dayShift(-60)}::date, due_date = ${dayShift(-45)}::date WHERE tenant_id = ${tenantId}`);
    const rt = (await post('/api/utility/routes', { code: 'K-1', name: 'Rute Kolektor', readerId: fieldId, collectorId: fieldId }, fin).expect(201)).body.id;
    await post('/api/utility/routes/assign', { routeId: rt, connectionIds: [conns[0]] }, fin).expect(201);
  });
  afterAll(() => app.close());

  it('penagihan lapangan: kolektor hanya melihat rutenya, mencatat kunjungan dan janji bayar dengan aturan tanggal', async () => {
    const mine = (await get('/api/utility/collection/worklist', field).expect(200)).body as { connection_id: string; days_late: number; promise: string | null }[];
    expect(mine).toHaveLength(1);
    expect(mine[0].connection_id).toBe(conns[0]);
    expect(mine[0].days_late).toBe(45);
    expect(((await get('/api/utility/collection/worklist', fin).expect(200)).body as unknown[]).length).toBe(2);
    expect(((await get('/api/utility/collection/worklist', field2).expect(200)).body as unknown[]).length).toBe(0);
    expect((await post('/api/utility/collection/visits', { connectionId: conns[1], outcome: 'TIDAK_ADA' }, field)).status).toBe(403); // bukan rutenya
    expect((await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'JANJI_BAYAR' }, field)).status).toBe(400); // tanpa tanggal
    expect((await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'JANJI_BAYAR', promisedOn: dayShift(-1) }, field)).status).toBe(400);
    expect((await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'JANJI_BAYAR', promisedOn: dayShift(40) }, field)).status).toBe(400);
    expect((await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'LAINNYA' }, field)).status).toBe(400);
    await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'JANJI_BAYAR', promisedOn: dayShift(3), promisedAmount: 50000, note: 'Gajian tanggal tiga' }, field).expect(201);
    expect((await post('/api/utility/collection/visits', { connectionId: conns[0], outcome: 'TIDAK_ADA' }, acct)).status).toBe(403);
    const after = (await get('/api/utility/collection/worklist', field).expect(200)).body as { promise: string; last_outcome: string; whatsapp: string }[];
    expect(after[0].promise).toBe('MENUNGGU');
    expect(after[0].whatsapp).toContain('https://wa.me/62812345678');
    const sum = (await get('/api/utility/collection/summary', field).expect(200)).body;
    expect(sum.visitsToday).toBe(1);
    expect(sum.overdueConnections).toBe(1);
    // janji yang sudah lewat tanpa pelunasan = ingkar
    await db.execute(sql`UPDATE utility_collection_visits SET promised_on = ${dayShift(-2)}::date WHERE tenant_id = ${tenantId}`);
    expect(((await get('/api/utility/collection/worklist', field).expect(200)).body as { promise: string }[])[0].promise).toBe('INGKAR');
    expect((await get('/api/utility/collection/summary', field).expect(200)).body.broken).toBe(1);
  });

  it('cetak & kirim massal: tingkat SP menurut keterlambatan, tautan WhatsApp, pencatatan pengiriman, peran', async () => {
    const rek = (await get(`/api/utility/notices/candidates?kind=REKENING&period=${month(2)}`, sales).expect(200)).body;
    expect(rek.rows).toHaveLength(2);
    expect(rek.rows[0].message).toContain('PAM Tagih');
    expect((await get('/api/utility/notices/candidates?kind=SP1', sales).expect(200)).body.rows).toHaveLength(0); // 45 hari = SP3
    const sp3 = (await get('/api/utility/notices/candidates?kind=SP3', sales).expect(200)).body;
    expect(sp3.rows).toHaveLength(2);
    expect(sp3.rows[0].whatsapp).toMatch(/^https:\/\/wa\.me\/62/);
    expect(sp3.rows[0].sentBefore).toBe(false);
    expect((await get('/api/utility/notices/candidates?kind=NGAWUR', sales)).status).toBe(400);
    expect((await get('/api/utility/notices/candidates?kind=SP3', cashier)).status).toBe(403);
    expect((await post('/api/utility/notices/log', { kind: 'SP3', channel: 'WHATSAPP', items: [{ connectionId: conns[0] }] }, acct)).status).toBe(403);
    expect((await post('/api/utility/notices/log', { kind: 'SP3', channel: 'WHATSAPP', items: [{ connectionId: '00000000-0000-4000-8000-000000000000' }] }, sales)).status).toBe(400);
    await post('/api/utility/notices/log', { kind: 'SP3', channel: 'WHATSAPP', items: sp3.rows.map((r: { connection_id: string; invoice_id: string }) => ({ connectionId: r.connection_id, invoiceId: r.invoice_id })) }, sales).expect(201);
    const again = (await get('/api/utility/notices/candidates?kind=SP3', sales).expect(200)).body;
    expect(again.rows.every((r: { sentBefore: boolean; alreadyToday: boolean }) => r.sentBefore && r.alreadyToday)).toBe(true);
    expect((await get('/api/utility/notices/history', acct).expect(200)).body).toHaveLength(2);
    expect((await get('/api/utility/notices/summary', acct).expect(200)).body.last30d).toEqual([{ kind: 'SP3', channel: 'WHATSAPP', n: 2 }]);
  });

  it('portal pelanggan: tautan per sambungan, halaman publik tanpa login, pengaduan terbatas, pencabutan', async () => {
    expect((await post(`/api/utility/portal/${conns[0]}`, {}, cashier)).status).toBe(403);
    const link = (await post(`/api/utility/portal/${conns[0]}`, {}, sales).expect(201)).body;
    expect(link.token).toHaveLength(24);
    const view = (await http.get(`/api/portal/utility/${link.token}`).expect(200)).body;
    expect(view.connection.number).toBeTruthy();
    expect(view.connection.customer).toBe('Warga 1');
    expect(view.bills).toHaveLength(1);
    expect(view.outstanding).toBeGreaterThan(0);
    expect(view.usage).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('Warga 2');
    expect((await http.get('/api/portal/utility/tidak-ada-token-sama-sekali').expect(404)).status).toBe(404);
    for (let i = 0; i < 3; i++) await http.post(`/api/portal/utility/${link.token}/complaints`).send({ category: 'PIPA_BOCOR', description: `Pipa bocor depan rumah ${i}` }).expect(201);
    expect((await http.post(`/api/portal/utility/${link.token}/complaints`).send({ category: 'PIPA_BOCOR', description: 'Bocor lagi di sini' })).status).toBe(400);
    const tickets = (await get('/api/utility/complaints', sales).expect(200)).body as { channel: string; priority: string }[];
    expect(tickets.filter((t) => t.channel === 'PORTAL')).toHaveLength(3);
    expect(tickets[0].priority).toBe('TINGGI');
    const newLink = (await post(`/api/utility/portal/${conns[0]}`, {}, sales).expect(201)).body; // putar ulang token
    expect(newLink.token).not.toBe(link.token);
    await http.get(`/api/portal/utility/${link.token}`).expect(404);
    await post(`/api/utility/portal/${conns[0]}/revoke`, {}, sales).expect(201);
    await http.get(`/api/portal/utility/${newLink.token}`).expect(404);
  });

  it('produksi & NRW: validasi, upsert harian, neraca air bulanan; kualitas air terhadap baku mutu', async () => {
    const ps = (b: object, t = field) => post('/api/utility/production', { date: today, source: 'IPA Utama', produced: 1000, distributed: 900, ...b }, t);
    expect((await ps({ distributed: 1100 })).status).toBe(400);
    expect((await ps({ date: dayShift(2) })).status).toBe(400);
    expect((await ps({}, sales)).status).toBe(403);
    expect((await ps({}, acct)).status).toBe(403);
    expect((await ps({}, field).then((r) => r.body)).updated).toBe(false);
    expect((await ps({ distributed: 950 }, field).then((r) => r.body)).updated).toBe(true);
    await ps({ source: 'Sumur Bor 2', produced: 400, distributed: 380, energyKwh: 120 }, field).expect(201);
    const s = (await get(`/api/utility/production/summary?period=${today.slice(0, 7)}`, acct).expect(200)).body;
    expect(s.produced).toBe(1400);
    expect(s.distributed).toBe(1330);
    expect(s.perSource).toHaveLength(2);
    expect(s.trend).toHaveLength(6);
    expect(s.billed).toBe(0); // belum ada tagihan periode ini
    const old = (await get(`/api/utility/production/summary?period=${month(2)}`, acct).expect(200)).body;
    expect(old.billed).toBe(40); // 2 sambungan × 20 m³
    expect(old.nrwPct).toBeNull(); // belum ada data produksi bulan itu
    expect((await get('/api/utility/production/sources', fin).expect(200)).body).toEqual(['IPA Utama', 'Sumur Bor 2']);

    const q = (b: object, t = field) => post('/api/utility/water-quality', { sampledOn: today, point: 'Reservoir', ...b }, t);
    expect((await q({})).status).toBe(400); // tanpa hasil uji
    const ok = (await q({ ph: 7.2, turbidity: 1.5, chlorine: 0.5, coliform: 0, tds: 200 }).then((r) => r.body));
    expect(ok.ok).toBe(true);
    const bad = (await q({ point: 'Ujung jaringan', ph: 5.9, coliform: 3, chlorine: 0.05 }).then((r) => r.body));
    expect(bad.ok).toBe(false);
    expect(bad.failed.sort()).toEqual(['chlorine', 'coliform', 'ph']);
    expect((await q({ ph: 7 }, sales)).status).toBe(403);
    const sm = (await get('/api/utility/water-quality/summary', acct).expect(200)).body;
    expect(sm.samples).toBe(2);
    expect(sm.failing).toBe(1);
    expect(sm.okPct).toBe(50);
    expect((await get('/api/utility/water-quality', fin).expect(200)).body).toHaveLength(2);
  });

  it('laporan kinerja: efisiensi, umur piutang per golongan, rute, pengaduan, NRW, kualitas — cocok dengan dokumen', async () => {
    const from = dayShift(-120);
    const rep = (await get(`/api/dept-reports/utility-kinerja?from=${from}&to=${today}`, acct).expect(200)).body;
    const kpi = (l: string) => rep.kpis.find((k: { label: string }) => k.label === l).value;
    expect(kpi('Tagihan air periode ini')).toBe(140000); // 2 × (10.000 + 20 × 3.000 + 0)
    expect(kpi('Piutang air (akhir periode)')).toBe(140000);
    expect(kpi('Penerimaan air periode ini')).toBe(0);
    const sec = (k: string) => rep.sections.find((s: { key: string }) => s.key === k).rows as Record<string, unknown>[];
    expect(Number(sec('umur')[0].b2)).toBe(140000); // 45 hari = 31–60
    expect(sec('golongan')[0].tariff).toBe('Air RT');
    expect(sec('rute')[0].visits).toBe(1);
    expect(sec('pengaduan').reduce((a, r) => a + Number(r.total), 0)).toBe(3);
    expect(sec('kualitas')).toHaveLength(2);
    expect((await get(`/api/dept-reports/utility-kinerja?from=${from}&to=${today}`, cashier)).status).toBe(403);
  });
});
