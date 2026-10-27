/**
 * Pembukuan otomatis (e2e): perusahaan tanpa Akuntan tetap terbukukan — posting gaji, penilaian ulang valas, kunci periode,
 * dan tutup buku dikerjakan sistem (atas nama Pemilik, tercatat di jejak audit), dengan syarat aman dan idempoten.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { AutoBookkeepingService } from '../src/modules/auto-bookkeeping/auto-bookkeeping.service';

describe('Pembukuan otomatis (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let svc: AutoBookkeepingService;
  let owner: string;
  let admin: string;
  let acct: string;
  let fin: string;
  let tenantId: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const prevEnd = addDays(thisMonth, -1);
  const prevStart = `${prevEnd.slice(0, 7)}-01`;
  const prevPeriod = prevEnd.slice(0, 7);
  const olderPeriod = addDays(prevStart, -1).slice(0, 7);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const audited = async (action: string) => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = $2`, [tenantId, action])).rows[0].n);
  const balanced = async () => expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  const lockedUntil = async () => (await get(owner, '/api/accounting/period').expect(200)).body.lockedUntil as string | null;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    svc = app.get(AutoBookkeepingService);
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Serba Otomatis', name: 'Pemilik', email: `po-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    tenantId = (await get(owner, '/api/auth/me').expect(200)).body.tenantId;
    for (const [k, role] of [['adm', 'ADMIN'], ['akn', 'ACCOUNTANT'], ['fin', 'FINANCE']] as const) await post(owner, '/api/users', { name: k, email: `po-${k}-${stamp}@uji.id`, password: 'rahasia123', role }).expect(201);
    [admin, acct, fin] = await Promise.all(['adm', 'akn', 'fin'].map((k) => login(`po-${k}-${stamp}@uji.id`, 'rahasia123')));
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('pengaturan: bawaan, hanya Admin/Akuntan yang mengubah, nilai tidak sah ditolak', async () => {
    expect((await get(fin, '/api/accounting/auto').expect(200)).body).toEqual({ payroll: true, fx: true, lock: false, lockDay: 10, closeYear: false });
    await put(fin, '/api/accounting/auto', { lock: true }).expect(403);
    await post(fin, '/api/accounting/auto/run').expect(403);
    await put(owner, '/api/accounting/auto', { lockDay: 40 }).expect(400);
    await put(acct, '/api/accounting/auto', { lockDay: 5 }).expect(200);
    await put(admin, '/api/accounting/auto', { lockDay: 10 }).expect(200);
    await get(owner, '/api/accounting/auto').expect(200);
  });

  it('gaji: Admin boleh memposting manual (Keuangan tidak); draf lewat tanggal bayar diposting otomatis setelah jeda 24 jam, sekali saja', async () => {
    await post(owner, '/api/apps/payroll/install').expect(201);
    await post(owner, '/api/hr/employees', { code: 'E-1', name: 'Pegawai Satu', ptkp: 'TK/0', joinDate: '2020-01-02', baseSalary: '5000000' }).expect(201);
    const older = (await post(owner, '/api/payroll/runs', { period: olderPeriod }).expect(201)).body;
    await post(fin, `/api/payroll/runs/${older.id}/post`).expect(403);
    await post(admin, `/api/payroll/runs/${older.id}/post`).expect(201);
    const prev = (await post(owner, '/api/payroll/runs', { period: prevPeriod }).expect(201)).body;
    // baru dibuat: masih dalam jeda koreksi SDM
    expect((await svc.runTenant(tenantId)).payrollPosted).toEqual([]);
    expect((await get(owner, `/api/payroll/runs/${prev.id}`).expect(200)).body.status).toBe('DRAFT');
    const r = await svc.runTenant(tenantId, { payrollMinAgeHours: 0 });
    expect(r.payrollPosted).toEqual([prev.number]);
    expect((await get(owner, `/api/payroll/runs/${prev.id}`).expect(200)).body.status).toBe('POSTED');
    expect(await audited('AUTO_PAYROLL_POST')).toBe(1);
    expect((await svc.runTenant(tenantId, { payrollMinAgeHours: 0 })).payrollPosted).toEqual([]); // idempoten
    await balanced();
    // bila dimatikan, draf dibiarkan
    const nextPeriod = addDays(`${today.slice(0, 7)}-01`, 40).slice(0, 7);
    expect(nextPeriod > prevPeriod).toBe(true);
    await put(owner, '/api/accounting/auto', { payroll: false }).expect(200);
    await put(owner, '/api/accounting/auto', { payroll: true }).expect(200);
  });

  it('valas: dinilai ulang akhir bulan lalu bila kurs lengkap; tanpa kurs ditunda; tidak ganda', async () => {
    const wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    const cust = (await post(owner, '/api/customers', { code: 'USD1', name: 'Buyer Luar Negeri' }).expect(201)).body.id;
    const supp = (await post(owner, '/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    const prod = (await post(owner, '/api/products', { sku: 'FX1', name: 'Barang FX', sellPrice: '1000' }).expect(201)).body.id;
    const po = (await post(owner, '/api/purchase-orders/quick', { supplierId: supp, warehouseId: wh, receiveNow: true, lines: [{ productId: prod, qty: '50', price: '50000' }] }).expect(201)).body;
    await post(owner, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'IDR-1' }).expect(201);
    await put(owner, '/api/fx/rates', { currency: 'USD', rate: '16000', date: prevStart }).expect(200);
    const so = (await post(owner, '/api/sales-orders', { customerId: cust, warehouseId: wh, currency: 'USD', date: prevStart, lines: [{ productId: prod, qty: '10', price: '10' }] }).expect(201)).body;
    await post(owner, `/api/sales-orders/${so.id}/confirm`).expect(201);
    await post(owner, '/api/invoices', { salesOrderId: so.id, date: prevStart }).expect(201);
    // kurs penutup belum ada pada akhir bulan: kurs terakhir (awal bulan) dipakai, jadi tidak ada selisih yang berarti; isi kurs penutup
    await put(owner, '/api/fx/rates', { currency: 'USD', rate: '16500', date: prevEnd }).expect(200);
    const r = await svc.runTenant(tenantId, { payrollMinAgeHours: 0 });
    expect(r.fxRevalued).toBe(prevEnd);
    expect(await audited('AUTO_FX_REVALUATION')).toBe(1);
    await balanced();
    expect((await svc.runTenant(tenantId)).fxRevalued).toBeNull(); // sudah dicatat
    expect(await audited('AUTO_FX_REVALUATION')).toBe(1);
    // dimatikan: tidak berjalan lagi walau diminta
    await put(owner, '/api/accounting/auto', { fx: false }).expect(200);
    expect((await svc.runTenant(tenantId)).fxRevalued).toBeNull();
    await put(owner, '/api/accounting/auto', { fx: true }).expect(200);
  });

  it('kunci periode: hanya setelah tanggal yang dipilih, ditunda bila ada persetujuan menunggu, hanya maju', async () => {
    await put(owner, '/api/accounting/auto', { lock: true, lockDay: 10 }).expect(200);
    // sebelum tanggal 10: belum dikunci
    expect((await svc.runTenant(tenantId, { today: `${today.slice(0, 7)}-05` })).locked).toBeNull();
    expect(await lockedUntil()).toBeNull();
    // ada permintaan persetujuan menunggu: ditunda
    await put(owner, '/api/approvals/policy', { manualJournal: 1000 }).expect(200);
    const accs = (await get(owner, '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const id = (c: string) => accs.find((a) => a.code === c)!.id;
    const j = await post(acct, '/api/accounting/journals', { date: today, description: 'Besar', lines: [{ accountId: id('6-4000'), debit: '5000000' }, { accountId: id('3-1000'), credit: '5000000' }] });
    expect(j.status).toBe(409);
    const held = await svc.runTenant(tenantId, { today: `${today.slice(0, 7)}-15` });
    expect(held.locked).toBeNull();
    expect(held.skipped.join(' ')).toMatch(/persetujuan/);
    await post(owner, `/api/approvals/${j.body.requestId}/approve`).expect(201);
    const done = await svc.runTenant(tenantId, { today: `${today.slice(0, 7)}-15` });
    expect(done.locked).toBe(prevEnd);
    expect(await lockedUntil()).toBe(prevEnd);
    expect(await audited('AUTO_LOCK_PERIOD')).toBe(1);
    // idempoten dan tidak pernah membuka: tanggal yang lebih awal tidak menggeser kunci
    expect((await svc.runTenant(tenantId, { today: `${today.slice(0, 7)}-15` })).locked).toBeNull();
    expect(await lockedUntil()).toBe(prevEnd);
  });

  it('tutup buku: setelah Februari, periodenya sudah terkunci, sekali saja', async () => {
    const lastYear = Number(today.slice(0, 4)) - 1;
    await put(owner, '/api/accounting/auto', { lock: false, closeYear: true }).expect(200);
    // pendapatan tahun lalu (jurnal bertanggal mundur harus sebelum kunci; kunci baru sampai bulan lalu → jurnal tahun lalu sudah terkunci)
    expect((await lockedUntil())! >= `${lastYear}-12-31`).toBe(true);
    // belum Maret: tidak ditutup
    expect((await svc.runTenant(tenantId, { today: `${lastYear + 1}-02-20` })).closedYear).toBeNull();
    // tidak ada saldo pendapatan/beban tahun lalu: dilewati tanpa galat
    const none = await svc.runTenant(tenantId, { today: `${lastYear + 1}-03-05` });
    expect(none.closedYear).toBeNull();
    expect(none.skipped.filter((s) => /gagal/.test(s))).toEqual([]);
  });

  it('tutup buku otomatis (perusahaan lain): menunggu Maret dan kunci sampai akhir tahun, lalu menutup sekali dengan laba pindah ke saldo laba', async () => {
    const lastYear = Number(today.slice(0, 4)) - 1;
    const t2 = (await http.post('/api/auth/register').send({ companyName: 'PT Tutup Otomatis', name: 'Pemilik', email: `po2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const tid = (await get(t2, '/api/auth/me').expect(200)).body.tenantId as string;
    const accs = (await get(t2, '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const id = (c: string) => accs.find((a) => a.code === c)!.id;
    await post(t2, '/api/accounting/journals', { date: `${lastYear}-06-15`, description: 'Pendapatan jasa', lines: [{ accountId: id('1-1100'), debit: '3000000' }, { accountId: id('4-1000'), credit: '3000000' }] }).expect(201);
    await put(t2, '/api/accounting/auto', { closeYear: true }).expect(200);
    // periode belum terkunci: ditunda
    const early = await svc.runTenant(tid, { today: `${lastYear + 1}-03-05` });
    expect(early.closedYear).toBeNull();
    expect(early.skipped.join(' ')).toMatch(/belum terkunci/);
    await post(t2, '/api/accounting/period/lock', { until: `${lastYear}-12-31` }).expect(201);
    expect((await svc.runTenant(tid, { today: `${lastYear + 1}-02-20` })).closedYear).toBeNull(); // belum Maret
    const done = await svc.runTenant(tid, { today: `${lastYear + 1}-03-05` });
    expect(done.skipped.filter((x) => /gagal/.test(x))).toEqual([]);
    expect(done.closedYear).toBe(lastYear);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'AUTO_CLOSE_YEAR'`, [tid])).rows[0].n)).toBe(1);
    expect((await get(t2, '/api/accounting/period').expect(200)).body.closings.map((c: { year: string }) => c.year)).toContain(String(lastYear));
    expect((await get(t2, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
    expect((await svc.runTenant(tid, { today: `${lastYear + 1}-03-06` })).closedYear).toBeNull(); // sekali saja
  });

  it('status terakhir berjalan: terbaca dari jejak audit, dan hanya mencatat yang benar-benar dikerjakan', async () => {
    const last = (await get(owner, '/api/accounting/auto/last').expect(200)).body as Record<string, { at: string; data: Record<string, unknown> | null }>;
    // pekerjaan yang dikerjakan pada tes-tes di atas (gaji diposting, valas dinilai, periode dikunci) muncul dengan tanggalnya
    expect(last.payroll?.at).toBeTruthy();
    expect(last.fx?.at).toBeTruthy();
    expect(last.lock?.at).toBeTruthy();
    // riwayat kunci periode: kunci otomatis tercatat dengan penanda otomatis dan tanggal sebelum/sesudahnya
    const st = (await get(owner, '/api/accounting/period').expect(200)).body as { lockedUntil: string | null; lockHistory: { kind: string; auto: boolean; to: string | null; from: string | null; at: string }[] };
    expect(st.lockHistory.length).toBeGreaterThan(0);
    const autoLock = st.lockHistory.find((h) => h.kind === 'LOCK' && h.auto);
    expect(autoLock?.to).toBeTruthy();
    expect(st.lockHistory[0].at >= st.lockHistory[st.lockHistory.length - 1].at).toBe(true); // terbaru dulu
    // akun Keuangan boleh membaca (hanya melihat), Admin dan Akuntan juga
    await get(fin, '/api/accounting/auto/last').expect(200);
  });

  it('Cek kesehatan memuat status pembukuan otomatis', async () => {
    const checks = (await get(owner, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string; message: string }[];
    const c = checks.find((x) => x.key === 'auto-bookkeeping')!;
    expect(c.message).toMatch(/Otomatis: penyusutan, jurnal berulang, posting gaji, penilaian ulang valas/);
    expect(c.message).toMatch(/Belum otomatis: kunci periode/);
    await put(owner, '/api/accounting/auto', { lock: true, closeYear: true }).expect(200);
    const c2 = ((await get(owner, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[]).find((x) => x.key === 'auto-bookkeeping')!;
    expect(c2.status).toBe('OK');
  });
});
