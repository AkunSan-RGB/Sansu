/**
 * Layanan air untuk skala besar: tagih berlatar, impor massal pelanggan, pembayaran virtual account (webhook), antrean pesan otomatis.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Layanan air skala besar (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let mock: Server;
  let mockPort = 0;
  let mockStatus = 200;
  const received: { headers: Record<string, unknown>; body: { to: string; message: string } }[] = [];
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const month = (back: number) => {
    const t = today.slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(t[0], t[1] - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  let owner: string; let fin: string; let sales: string; let acct: string; let cashier: string; let tenantId: string; let tariff: string;
  const conns: string[] = [];
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const put = (url: string, body: object, t: string) => http.put(url).set(as(t)).send(body);
  const num = async (q: ReturnType<typeof sql>) => Number((await db.execute<{ n: string }>(q)).rows[0].n);
  const waitJob = async (id: string) => {
    for (let i = 0; i < 80; i++) {
      const j = (await get(`/api/utility/billing/jobs/${id}`, fin).expect(200)).body;
      if (j.status !== 'BERJALAN') return j;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Pekerjaan penagihan tidak selesai');
  };

  beforeAll(async () => {
    process.env.OUTBOX_ALLOW_PRIVATE = 'true';
    mock = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => { if (mockStatus === 200) received.push({ headers: req.headers, body: JSON.parse(b) }); res.statusCode = mockStatus; res.end('{}'); });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    mockPort = (mock.address() as { port: number }).port;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Skala', name: 'Pemilik', email: `skl-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `skl-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `skl-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); sales = await mk('SALES', 'cs'); acct = await mk('ACCOUNTANT', 'akt'); cashier = await mk('CASHIER', 'kasir');
    tenantId = (await db.execute<{ id: string }>(sql`SELECT tenant_id AS id FROM users WHERE email = ${`skl-${stamp}@uji.id`}`)).rows[0].id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    for (let i = 1; i <= 3; i++) {
      const cust = (await post('/api/customers', { code: `S${i}`, name: `Warga ${i}`, phone: `0812000000${i}`, paymentTermDays: 20 }).expect(201)).body.id;
      conns.push((await post('/api/utility/connections', { customerId: cust, tariffId: tariff, address: `Jl. Skala ${i}0`, meterNo: `SK-${i}`, installedAt: `${month(5)}-05`, initialReading: '0' }, fin).expect(201)).body.id);
    }
    for (const c of conns) await post('/api/utility/readings', { connectionId: c, period: month(2), current: '20' }).expect(201);
    for (const e of (await get(`/api/utility/readings?period=${month(2)}&status=ENTERED`, fin).expect(200)).body as { id: string }[]) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
  });
  afterAll(async () => { await app.close(); await new Promise((r) => mock.close(r)); delete process.env.OUTBOX_ALLOW_PRIVATE; });

  it('tagih berlatar: dijawab segera, kemajuan dibaca, tidak menagih dua kali, peran dijaga', async () => {
    expect((await post('/api/utility/billing/jobs', { period: month(2) }, acct)).status).toBe(403);
    const job = (await post('/api/utility/billing/jobs', { period: month(2) }, fin).expect(201)).body;
    expect(job.status).toBe('BERJALAN');
    const done = await waitJob(job.id);
    expect(done.status).toBe('SELESAI');
    expect(done.done).toBe(3);
    expect(Number(done.billed_total)).toBe(3 * (10000 + 20 * 3000));
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM utility_bills WHERE tenant_id = ${tenantId} AND period = ${month(2)}`)).toBe(3);
    const again = await waitJob((await post('/api/utility/billing/jobs', { period: month(2) }, fin).expect(201)).body.id);
    expect(again.status).toBe('SELESAI');
    expect(again.done).toBe(0);
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM utility_bills WHERE tenant_id = ${tenantId}`)).toBe(3);
    expect((await get('/api/utility/billing/jobs', acct)).status).toBe(403);
    expect(((await get('/api/utility/billing/jobs', fin).expect(200)).body as unknown[]).length).toBe(2);
    await db.execute(sql`UPDATE invoices SET date = ${today}::date - 50, due_date = ${today}::date - 30 WHERE tenant_id = ${tenantId}`);
  });

  it('impor massal: pratinjau tidak menyimpan; impor menyimpan yang lolos; baris salah dilaporkan; diulang aman', async () => {
    const rows = [
      { code: 'IMP-1', name: 'Pelanggan Impor Satu', phone: '081300000001', address: 'Jl. Impor No. 1, Sleman', tariff: 'air rt', meterNo: 'IMP-M1', initialReading: '12', installedAt: '2024-03-01', zone: 'Zona X' },
      { code: 'IMP-2', name: 'Pelanggan Impor Dua', address: 'Jl. Impor No. 2, Sleman', tariff: 'Air RT', meterNo: 'IMP-M2' },
      { code: 'IMP-3', name: 'Tarif Salah', address: 'Jl. Impor No. 3, Sleman', tariff: 'Golongan Tidak Ada', meterNo: 'IMP-M3' },
      { code: 'IMP-4', name: 'Tanpa Meter', address: 'Jl. Impor No. 4, Sleman', tariff: 'Air RT' },
      { code: 'IMP-5', name: 'Meter Kembar', address: 'Jl. Impor No. 5, Sleman', tariff: 'Air RT', meterNo: 'IMP-M1' },
      { code: 'IMP-6', name: 'Rute Belum Ada', address: 'Jl. Impor No. 6, Sleman', tariff: 'Air RT', meterNo: 'IMP-M6', route: 'R-99' },
      { code: 'IMP-7', name: 'Tanggal Masa Depan', address: 'Jl. Impor No. 7, Sleman', tariff: 'Air RT', meterNo: 'IMP-M7', installedAt: '2999-01-01' },
    ];
    expect((await post('/api/utility/import/connections', { rows }, cashier)).status).toBe(403);
    expect((await post('/api/utility/import/connections', { rows: [] }, fin)).status).toBe(400);
    const dry = (await post('/api/utility/import/connections', { rows, dryRun: true }, fin).expect(201)).body;
    expect(dry).toMatchObject({ dryRun: true, total: 7, created: 2, skipped: 1, errors: 4 });
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM customers WHERE tenant_id = ${tenantId} AND code LIKE 'IMP-%'`)).toBe(0);
    const real = (await post('/api/utility/import/connections', { rows }, fin).expect(201)).body;
    expect(real).toMatchObject({ dryRun: false, created: 2, skipped: 1, errors: 4 });
    expect(real.results.find((r: { row: number }) => r.row === 3).message).toContain('Golongan');
    expect(real.results.find((r: { row: number }) => r.row === 4).message).toContain('meter');
    const list = (await get('/api/utility/connections?search=Impor', fin).expect(200)).body as { meterNo: string }[];
    expect(list.map((c) => c.meterNo).sort()).toEqual(['IMP-M1', 'IMP-M2']);
    const first = (await db.execute<{ initial_reading: string; zone: string }>(sql`SELECT initial_reading::text, zone FROM utility_connections WHERE tenant_id = ${tenantId} AND meter_no = 'IMP-M1'`)).rows[0];
    expect(Number(first.initial_reading)).toBe(12);
    expect(first.zone).toBeTruthy();
    const rerun = (await post('/api/utility/import/connections', { rows: rows.slice(0, 2) }, fin).expect(201)).body;
    expect(rerun).toMatchObject({ created: 0, skipped: 2, errors: 0 });
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM customers WHERE tenant_id = ${tenantId} AND code LIKE 'IMP-%'`)).toBe(2);
  });

  it('virtual account: nomor tetap per sambungan, webhook melunasi tagihan tertua, idempoten, kelebihan dan nomor asing ditahan', async () => {
    expect((await put('/api/utility/va/settings', { prefix: 'abc' }, owner)).status).toBe(400);
    await put('/api/utility/va/settings', { prefix: '8808', bankName: 'Bank Uji' }, owner).expect(200);
    const n1 = (await get(`/api/utility/va/connection/${conns[0]}`, fin).expect(200)).body;
    expect(n1.vaNumber).toMatch(/^8808\d{8}$/);
    const n2 = (await get(`/api/utility/va/connection/${conns[1]}`, fin).expect(200)).body;
    expect(n2.vaNumber).not.toBe(n1.vaNumber);
    expect((await get(`/api/utility/va/connection/${conns[0]}`, fin).expect(200)).body.vaNumber).toBe(n1.vaNumber); // tetap
    const apiKey = (await post('/api/utility/ingest-keys', { name: 'Gateway bank uji' }).expect(201)).body.key as string;
    const hook = (b: object, key: string = apiKey) => http.post('/api/ingest/utility/va-payments').set('X-Api-Key', key).send(b);
    expect((await hook({ vaNumber: n1.vaNumber, amount: '70000', reference: 'TRX-0' }, 'kunci-salah-kunci-salah-kunci')).status).toBe(401);
    expect((await hook({ vaNumber: n1.vaNumber, amount: '0', reference: 'TRX-0' })).status).toBe(400);

    const total = 10000 + 20 * 3000; // satu tagihan = 70.000
    const ok = (await hook({ vaNumber: n1.vaNumber, amount: String(total), reference: 'TRX-1', channel: 'BCA' }).expect(201)).body;
    expect(ok).toMatchObject({ duplicate: false, status: 'DITERAPKAN', unapplied: '0.00' });
    expect(ok.payments).toHaveLength(1);
    const inv = (await db.execute<{ status: string }>(sql`SELECT i.status::text FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id WHERE b.connection_id = ${conns[0]}`)).rows[0];
    expect(inv.status).toBe('PAID');
    const dup = (await hook({ vaNumber: n1.vaNumber, amount: String(total), reference: 'TRX-1' }).expect(201)).body;
    expect(dup).toMatchObject({ duplicate: true, status: 'DITERAPKAN' });
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM payments WHERE tenant_id = ${tenantId} AND notes LIKE 'Virtual account TRX-1%'`)).toBe(1);
    const over = (await hook({ vaNumber: n1.vaNumber, amount: '25000', reference: 'TRX-2' }).expect(201)).body;
    expect(over).toMatchObject({ status: 'KELEBIHAN', applied: '0.00', unapplied: '25000.00' });
    const part = (await hook({ vaNumber: n2.vaNumber, amount: '30000', reference: 'TRX-3' }).expect(201)).body;
    expect(part).toMatchObject({ status: 'DITERAPKAN', applied: '30000.00' });
    const i2 = (await db.execute<{ status: string; paid_amount: string }>(sql`SELECT i.status::text, i.paid_amount::text FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id WHERE b.connection_id = ${conns[1]}`)).rows[0];
    expect(i2).toMatchObject({ status: 'PARTIAL', paid_amount: '30000.00' });
    const unk = (await hook({ vaNumber: '880899999999', amount: String(total), reference: 'TRX-4' }).expect(201)).body;
    expect(unk.status).toBe('TAK_COCOK');
    expect((await post(`/api/utility/va/payments/${unk.id}/apply`, {}, fin)).status).toBe(400);
    expect((await post(`/api/utility/va/payments/${unk.id}/apply`, { connectionId: conns[2] }, acct)).status).toBe(403);
    const fixed = (await post(`/api/utility/va/payments/${unk.id}/apply`, { connectionId: conns[2] }, fin).expect(201)).body;
    expect(fixed).toMatchObject({ status: 'DITERAPKAN', unapplied: '0.00' });
    const sum = (await get('/api/utility/va/summary', acct).expect(200)).body;
    expect(sum).toMatchObject({ received: 4, excess: 1, unmatched: 0, excessAmount: 25000 });
    expect(await num(sql`SELECT COUNT(*)::text AS n FROM utility_counter_receipts WHERE tenant_id = ${tenantId} AND channel = 'VA'`)).toBe(3);
    expect(Number((await db.execute<{ d: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS d FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId}`)).rows[0].d)).toBe(0);
    expect((await get('/api/utility/va/payments?status=KELEBIHAN', acct).expect(200)).body).toHaveLength(1);
    expect((await get(`/api/utility/va/connection/${conns[0]}`, cashier)).status).toBe(200);
  });

  it('antrean pesan: pengaturan aman, antre, kirim berlatar dengan percobaan ulang, tidak kirim ganda, riwayat tercatat', async () => {
    expect((await put('/api/utility/outbox/config', { enabled: true, url: 'ftp://x.example/send' }, owner)).status).toBe(400);
    expect((await put('/api/utility/outbox/config', { enabled: true, url: `http://127.0.0.1:${mockPort}/send`, bodyTemplate: '{"to":"{to}"}' }, owner)).status).toBe(400);
    expect((await put('/api/utility/outbox/config', { enabled: true, url: `http://127.0.0.1:${mockPort}/send`, token: 'Bearer rahasia-penyedia' }, fin)).status).toBe(403);
    const cfg = (await put('/api/utility/outbox/config', { enabled: true, url: `http://127.0.0.1:${mockPort}/send`, token: 'Bearer rahasia-penyedia' }, owner).expect(200)).body;
    expect(cfg.hasToken).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('rahasia-penyedia');
    await put('/api/utility/outbox/config', { token: '••••••••' }, owner).expect(200); // token samaran tidak menimpa
    expect((await post('/api/utility/outbox/test', { to: '081200000000' }, owner).expect(201)).body.ok).toBe(true);
    expect(received.pop()?.headers.authorization).toBe('Bearer rahasia-penyedia');

    expect((await post('/api/utility/outbox/enqueue', { kind: 'REKENING', channel: 'WHATSAPP', items: [{ connectionId: conns[0] }] }, cashier)).status).toBe(403);
    expect((await post('/api/utility/outbox/enqueue', { kind: 'REKENING', channel: 'WHATSAPP' }, sales)).status).toBe(400);
    const q = (await post('/api/utility/outbox/enqueue', { kind: 'REKENING', channel: 'WHATSAPP', period: month(2), all: true }, sales).expect(201)).body;
    expect(q.queued).toBe(1); // hanya sambungan 2 yang masih punya sisa tagihan; lainnya lunas
    const again = (await post('/api/utility/outbox/enqueue', { kind: 'REKENING', channel: 'WHATSAPP', period: month(2), all: true }, sales).expect(201)).body;
    expect(again).toMatchObject({ queued: 0, duplicates: 1 });

    mockStatus = 500;
    for (let i = 0; i < 3; i++) {
      await db.execute(sql`UPDATE utility_outbox SET next_try_at = now() - interval '1 minute' WHERE tenant_id = ${tenantId} AND status IN ('ANTRE', 'MENGIRIM')`);
      await post('/api/utility/outbox/process', {}, fin).expect(201);
    }
    const failed = (await get('/api/utility/outbox?status=GAGAL', sales).expect(200)).body as { id: string; attempts: number; last_error: string }[];
    expect(failed).toHaveLength(1);
    expect(failed[0].attempts).toBe(3);
    expect(failed[0].last_error).toContain('500');
    mockStatus = 200;
    await post(`/api/utility/outbox/${failed[0].id}/retry`, {}, fin).expect(201);
    const run = (await post('/api/utility/outbox/process', {}, fin).expect(201)).body;
    expect(run).toMatchObject({ sent: 1, failed: 0 });
    expect(received).toHaveLength(1);
    expect(received[0].body.to).toBe('628120000002');
    expect(received[0].body.message).toContain('Warga 2');
    const hist = (await get('/api/utility/notices/history?kind=REKENING', acct).expect(200)).body as { channel: string }[];
    expect(hist.filter((h) => h.channel === 'WHATSAPP')).toHaveLength(1);
    const third = (await post('/api/utility/outbox/enqueue', { kind: 'REKENING', channel: 'WHATSAPP', period: month(2), all: true }, sales).expect(201)).body;
    expect(third).toMatchObject({ queued: 0, alreadySent: 1 });
    expect((await get('/api/utility/outbox/summary', acct).expect(200)).body.TERKIRIM).toBe(1);
  });
});
