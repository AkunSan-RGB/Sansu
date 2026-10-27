/**
 * Layanan air: koreksi tagihan (nota kredit), jaminan sambungan, dan angsuran tunggakan — persetujuan orang lain dan keseimbangan piutang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Layanan air: koreksi, jaminan, angsuran (e2e)', () => {
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
  let owner: string; let fin: string; let fin2: string; let adm: string; let sales: string; let acct: string;
  let tenantId: string; let customer: string; let tariff: string; let connId: string; let billInvoice: string; let tenantRow: { id: string };
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  /** Keseimbangan: saldo Piutang Usaha di buku besar = jumlah sisa semua faktur */
  const arBalanced = async () => {
    const r = await db.execute<{ gl: string; docs: string }>(sql`
      SELECT (SELECT COALESCE(SUM(l.debit - l.credit), 0)::text FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.tenant_id = ${tenantId} AND a.system_key = 'AR') AS gl,
             (SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0)::text FROM invoices WHERE tenant_id = ${tenantId}) AS docs`);
    expect(Number(r.rows[0].gl)).toBeCloseTo(Number(r.rows[0].docs), 2);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PAM Koreksi', name: 'Pemilik', email: `krk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `krk-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `krk-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin'); fin2 = await mk('FINANCE', 'fin2'); adm = await mk('ADMIN', 'adm'); sales = await mk('SALES', 'cs'); acct = await mk('ACCOUNTANT', 'akt');
    tenantRow = (await db.execute<{ id: string }>(sql`SELECT tenant_id AS id FROM users WHERE email = ${`krk-${stamp}@uji.id`}`)).rows[0];
    tenantId = tenantRow.id;
    customer = (await post('/api/customers', { code: 'PLG1', name: 'Siti', paymentTermDays: 20 }).expect(201)).body.id;
    tariff = (await post('/api/utility/tariffs', { name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 0, blocks: [{ upTo: null, price: 3000 }] }, fin).expect(201)).body.id;
    connId = (await post('/api/utility/connections', { customerId: customer, tariffId: tariff, address: 'Blok 1', meterNo: 'MK-1', installedAt: `${month(5)}-05`, initialReading: '0' }, fin).expect(201)).body.id;
    await post('/api/utility/readings', { connectionId: connId, period: month(3), current: '20' }).expect(201);
    const ents = (await get(`/api/utility/readings?period=${month(3)}&status=ENTERED`, fin).expect(200)).body as { id: string }[];
    for (const e of ents) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/utility/billing/run', { period: month(3) }, fin).expect(201);
    billInvoice = (await db.execute<{ id: string }>(sql`SELECT invoice_id AS id FROM utility_bills WHERE tenant_id = ${tenantId} LIMIT 1`)).rows[0].id;
    await db.execute(sql`UPDATE invoices SET date = current_date - 60, due_date = current_date - 45 WHERE id = ${billInvoice}`);
  });
  afterAll(() => app.close());

  let adjId: string;
  it('koreksi pemakaian: diajukan Pelayanan pelanggan, disetujui orang lain, nota kredit + jurnal, piutang tetap seimbang', async () => {
    const before = (await get(`/api/utility/adjustments/invoices?q=Siti`, fin).expect(200)).body as { id: string; open: string }[];
    const open0 = Number(before.find((x) => x.id === billInvoice)!.open);
    expect((await post('/api/utility/adjustments', { invoiceId: billInvoice, kind: 'KOREKSI_PEMAKAIAN', amount: '5000', reason: 'pendek' }, sales)).status).toBe(400); // alasan minimal 10 huruf
    expect((await post('/api/utility/adjustments', { invoiceId: billInvoice, kind: 'PEMUTIHAN_DENDA', amount: '1000', reason: 'Tidak ada denda di tagihan ini' }, sales)).status).toBe(400);
    expect((await post('/api/utility/adjustments', { invoiceId: billInvoice, kind: 'KOREKSI_PEMAKAIAN', amount: String(open0 + 1), reason: 'Melebihi sisa tagihan' }, sales)).status).toBe(400);
    const a = (await post('/api/utility/adjustments', { invoiceId: billInvoice, kind: 'KOREKSI_PEMAKAIAN', amount: '5000', reason: 'Meter terbaca terlalu tinggi, sudah dicek ulang' }, sales).expect(201)).body;
    adjId = a.id;
    expect(a.number).toMatch(/^KRK\//);
    expect(a.status).toBe('DIAJUKAN');
    expect((await post(`/api/utility/adjustments/${adjId}/approve`, {}, sales)).status).toBe(403); // peran
    expect((await post(`/api/utility/adjustments/${adjId}/approve`, {}, acct)).status).toBe(403);
    const ok = (await post(`/api/utility/adjustments/${adjId}/approve`, { note: 'Sesuai foto meter' }, fin).expect(201)).body;
    expect(ok.status).toBe('DISETUJUI');
    expect(ok.creditNote).toMatch(/^RJ\//);
    const after = (await get(`/api/utility/adjustments/invoices?q=Siti`, fin).expect(200)).body as { id: string; open: string }[];
    expect(Number(after.find((x) => x.id === billInvoice)!.open)).toBeCloseTo(open0 - 5000, 2);
    await arBalanced();
    expect((await post(`/api/utility/adjustments/${adjId}/approve`, {}, fin)).status).toBe(400); // sudah diputuskan
  });

  it('pengaju tidak menyetujui sendiri; nilai besar harus Admin/Pemilik; pembatalan penuh; penolakan', async () => {
    const charges = (await get('/api/utility/charges', fin).expect(200)).body as { id: string; revenueKey: string }[];
    const sambung = charges.find((c) => c.revenueKey === 'UTILITY_CONNECTION_REVENUE')!;
    const big = (await post('/api/utility/charges/issue', { chargeId: sambung.id, customerId: customer, price: '800000' }, fin).expect(201)).body;
    const r1 = (await post('/api/utility/adjustments', { invoiceId: big.invoiceId, kind: 'KOREKSI_PEMAKAIAN', amount: '600000', reason: 'Harga salah input, seharusnya Rp200.000' }, fin).expect(201)).body;
    expect((await post(`/api/utility/adjustments/${r1.id}/approve`, {}, fin)).status).toBe(403); // pengaju sendiri
    const r2 = (await post('/api/utility/adjustments', { invoiceId: big.invoiceId, kind: 'KOMPENSASI', amount: '1000', reason: 'Kompensasi air mati dua hari' }, sales).expect(201)).body;
    expect((await post(`/api/utility/adjustments/${r1.id}/reject`, { note: 'dobel pengajuan' }, adm).expect(201)).body.status).toBe('DITOLAK');
    const r3 = (await post('/api/utility/adjustments', { invoiceId: big.invoiceId, kind: 'KOREKSI_PEMAKAIAN', amount: '600000', reason: 'Harga salah input, seharusnya Rp200.000' }, sales).expect(201)).body;
    expect((await post(`/api/utility/adjustments/${r3.id}/approve`, {}, fin)).status).toBe(403); // ≥ Rp500.000 → Admin/Pemilik
    await post(`/api/utility/adjustments/${r3.id}/approve`, {}, adm).expect(201);
    await post(`/api/utility/adjustments/${r2.id}/approve`, {}, fin).expect(201);
    const other = (await post('/api/utility/charges/issue', { chargeId: sambung.id, customerId: customer, price: '150000' }, fin).expect(201)).body;
    const cancel = (await post('/api/utility/adjustments', { invoiceId: other.invoiceId, kind: 'PEMBATALAN', reason: 'Permohonan dibatalkan pelanggan' }, sales).expect(201)).body;
    expect(Number(cancel.amount)).toBeCloseTo(150000, 2);
    await post(`/api/utility/adjustments/${cancel.id}/approve`, {}, fin).expect(201);
    const st = (await db.execute<{ status: string }>(sql`SELECT status::text AS status FROM invoices WHERE id = ${other.invoiceId}`)).rows[0].status;
    expect(st).toBe('PAID');
    await arBalanced();
    const sum = (await get('/api/utility/adjustments/summary', fin).expect(200)).body;
    expect(sum.pending).toBe(0);
  });

  let depId: string;
  it('jaminan: diterima sebagai utang kepada pelanggan, dipakai melunasi tunggakan, dikembalikan oleh orang lain', async () => {
    expect((await post('/api/utility/deposits', { customerId: customer, amount: '300000', method: 'CASH' }, fin)).status).toBe(400); // mode non-tunai
    const d = (await post('/api/utility/deposits', { customerId: customer, connectionId: connId, amount: '300000', note: 'Jaminan sambungan baru' }, fin).expect(201)).body;
    depId = d.id;
    expect(d.number).toMatch(/^JMN\//);
    expect((await post(`/api/utility/deposits/${depId}/refund`, {}, adm)).status).toBe(403); // Admin tidak mengeluarkan uang
    expect((await post(`/api/utility/deposits/${depId}/refund`, {}, fin2)).status).toBe(400); // masih ada tunggakan
    expect((await post(`/api/utility/deposits/${depId}/offset`, { invoiceId: billInvoice }, fin)).status).toBe(403); // penerima = pemakai
    const open = Number(((await get('/api/utility/adjustments/invoices?q=Siti', fin).expect(200)).body as { id: string; open: string }[]).find((x) => x.id === billInvoice)!.open);
    const off = (await post(`/api/utility/deposits/${depId}/offset`, { invoiceId: billInvoice }, adm).expect(201)).body;
    expect(Number(off.amount)).toBeCloseTo(Math.min(300000, open), 2);
    await arBalanced();
    const dep = (await get(`/api/utility/deposits/${depId}`, fin).expect(200)).body;
    expect(Number(dep.remaining)).toBeCloseTo(300000 - Number(off.amount), 2);
    expect(dep.movements.map((m: { kind: string }) => m.kind)).toEqual(['PENERIMAAN', 'PELUNASAN_TUNGGAKAN']);
    const gl = (await db.execute<{ v: string }>(sql`SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.tenant_id = ${tenantId} AND a.system_key = 'UTILITY_DEPOSIT'`)).rows[0].v;
    expect(Number(gl)).toBeCloseTo(Number(dep.remaining), 2);
    // pelanggan tanpa tunggakan: jaminan dikembalikan penuh oleh orang lain dari penerimanya
    const c2 = (await post('/api/customers', { code: 'PLG2', name: 'Budi', paymentTermDays: 20 }).expect(201)).body.id;
    const d2 = (await post('/api/utility/deposits', { customerId: c2, amount: '100000' }, fin).expect(201)).body;
    expect((await post(`/api/utility/deposits/${d2.id}/refund`, {}, fin)).status).toBe(403); // penerima tak boleh mengembalikan
    const rf = (await post(`/api/utility/deposits/${d2.id}/refund`, { note: 'Sambungan ditutup' }, fin2).expect(201)).body;
    expect(Number(rf.amount)).toBeCloseTo(100000, 2);
    expect((await post(`/api/utility/deposits/${d2.id}/refund`, {}, fin2)).status).toBe(400); // sudah habis
    expect(Number((await get('/api/utility/deposits/summary', fin).expect(200)).body.held)).toBeCloseTo(Number(dep.remaining), 2);
    await arBalanced();
  });

  it('angsuran tunggakan: jadwal, persetujuan orang lain, menahan usulan putus, progres dari pembayaran', async () => {
    // tagihan tunggakan baru: periode berikutnya
    await post('/api/utility/readings', { connectionId: connId, period: month(2), current: '45' }).expect(201);
    const ents = (await get(`/api/utility/readings?period=${month(2)}&status=ENTERED`, fin).expect(200)).body as { id: string }[];
    for (const e of ents) await post(`/api/utility/readings/${e.id}/verify`, {}, fin).expect(201);
    await post('/api/utility/billing/run', { period: month(2) }, fin).expect(201);
    await db.execute(sql`UPDATE invoices SET date = current_date - 30, due_date = current_date - 20 WHERE id IN (SELECT invoice_id FROM utility_bills WHERE tenant_id = ${tenantId} AND period = ${month(2)})`);
    const cover = (await get(`/api/utility/installments/coverable/${connId}`, fin).expect(200)).body as { id: string; open: string }[];
    expect(cover.length).toBeGreaterThanOrEqual(1);
    const tomorrow = new Date(Date.now() + 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10);
    expect((await post('/api/utility/installments', { connectionId: connId, invoiceIds: [cover[0].id], count: 3, firstDue: '2020-01-01' }, sales)).status).toBe(400);
    const plan = (await post('/api/utility/installments', { connectionId: connId, invoiceIds: cover.map((c) => c.id), count: 3, firstDue: tomorrow, note: 'Pelanggan kehilangan pekerjaan' }, sales).expect(201)).body;
    expect(plan.number).toMatch(/^ANG\//);
    expect(plan.schedule).toHaveLength(3);
    expect(plan.schedule.reduce((a: number, s: { amount: number }) => a + s.amount, 0)).toBeCloseTo(plan.total, 2);
    expect((await post('/api/utility/installments', { connectionId: connId, invoiceIds: [cover[0].id], count: 2, firstDue: tomorrow }, sales)).status).toBe(400); // sudah masuk rencana
    expect((await post(`/api/utility/installments/${plan.id}/approve`, {}, sales)).status).toBe(403);
    await post(`/api/utility/installments/${plan.id}/approve`, {}, fin).expect(201);
    const od = (await get('/api/utility/overdue', fin).expect(200)).body as { id: string; installmentPlan: boolean; suggestSuspend: boolean }[];
    const row = od.find((x) => x.id === connId)!;
    expect(row.installmentPlan).toBe(true);
    expect(row.suggestSuspend).toBe(false);
    expect((await post(`/api/utility/connections/${connId}/suspend`, { reason: 'Menunggak lama sekali' }, fin)).status).toBe(400);
    const first = Number(plan.schedule[0].amount);
    const invoiceId = cover[0].id;
    await post('/api/payments', { invoiceId, amount: String(Math.min(first, Number(cover[0].open))), method: 'TRANSFER' }, fin).expect(201);
    const view = (await get(`/api/utility/installments/${plan.id}`, fin).expect(200)).body;
    expect(view.status).toBe('AKTIF');
    expect(view.items[0].paid).toBeGreaterThan(0);
    await post(`/api/utility/installments/${plan.id}/cancel`, { reason: 'Pelanggan melunasi sekaligus' }, fin).expect(201);
    expect((await get(`/api/utility/installments/${plan.id}`, fin).expect(200)).body.status).toBe('BATAL');
    await arBalanced();
  });
});
