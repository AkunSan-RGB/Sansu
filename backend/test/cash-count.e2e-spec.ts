/**
 * Opname kas (e2e): hitung per pecahan, pos rekonsiliasi, selisih kecil langsung dibukukan,
 * selisih besar menunggu Pemilik, kunci transaksi kas sebelum tanggal opname, pembatalan oleh Pemilik.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Opname kas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let fin: string;
  let accounts: { id: string; code: string }[];
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const plus = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
  const balance = async (code: string) => {
    const rows = (await http.get('/api/cash/counts/accounts').set(as(owner)).expect(200)).body as {
      code: string;
      balance: string;
    }[];
    return Number(rows.find((r) => r.code === code)?.balance);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'PT Kas Rapi', name: 'Pemilik', email: `kas-${stamp}@uji.id`, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    await http
      .post('/api/users')
      .set(as(owner))
      .send({ name: 'Keuangan', email: `kasfin-${stamp}@uji.id`, password: 'rahasia123', role: 'FINANCE' })
      .expect(201);
    fin = (
      await http
        .post('/api/auth/login')
        .send({ email: `kasfin-${stamp}@uji.id`, password: 'rahasia123' })
        .expect(200)
    ).body.accessToken;
    accounts = (await http.get('/api/accounting/accounts').set(as(owner))).body;
    await http
      .post('/api/cash/transactions')
      .set(as(owner))
      .send({
        type: 'IN',
        cashAccountId: acc('1-1110'),
        date: today,
        description: 'Isi kas kecil',
        lines: [{ accountId: acc('3-1000'), amount: '1000000' }],
      })
      .expect(201);
  });
  afterAll(() => app.close());

  it('hanya akun kas fisik yang bisa diopname', async () => {
    const rows = (await http.get('/api/cash/counts/accounts').set(as(fin)).expect(200)).body as { code: string }[];
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(['1-1100', '1-1110']));
    expect(rows.map((r) => r.code)).not.toContain('1-1200');
    await http
      .post('/api/cash/counts')
      .set(as(fin))
      .send({ accountId: acc('1-1200') })
      .expect(400);
  });

  let first: string;
  it('selisih kecil: hitung per pecahan + bon sementara → langsung dibukukan', async () => {
    const c = (
      await http
        .post('/api/cash/counts')
        .set(as(fin))
        .send({ accountId: acc('1-1110'), date: today, custodianName: 'Rina' })
        .expect(201)
    ).body;
    first = c.id;
    expect(c.number).toMatch(/^OPK\//);
    expect(Number(c.bookBalance)).toBe(1_000_000);
    await http
      .post('/api/cash/counts')
      .set(as(fin))
      .send({ accountId: acc('1-1110'), date: today })
      .expect(400); // masih ada yang terbuka
    await http
      .put(`/api/cash/counts/${c.id}`)
      .set(as(fin))
      .send({ denominations: { X999: 1 } })
      .expect(400);
    const u = (
      await http
        .put(`/api/cash/counts/${c.id}`)
        .set(as(fin))
        .send({
          denominations: { K100000: 9, K50000: 1, K20000: 2 },
          items: [{ type: 'ADD', description: 'Bon sementara ATK', amount: '5000' }],
        })
        .expect(200)
    ).body;
    expect(Number(u.countedTotal)).toBe(990_000);
    expect(Number(u.itemsTotal)).toBe(5_000);
    expect(Number(u.difference)).toBe(-5_000);
    await http.post(`/api/cash/counts/${c.id}/finish`).set(as(fin)).expect(400); // selisih tanpa penjelasan
    await http
      .put(`/api/cash/counts/${c.id}`)
      .set(as(fin))
      .send({ reason: 'Uang receh kembalian tidak tercatat' })
      .expect(200);
    const done = (await http.post(`/api/cash/counts/${c.id}/finish`).set(as(fin)).expect(200)).body;
    expect(done.status).toBe('POSTED');
    expect(done.journalNumber).toBeTruthy();
    expect(await balance('1-1110')).toBe(995_000);
  });

  it('kas terkunci sampai tanggal opname', async () => {
    const r = await http
      .post('/api/cash/transactions')
      .set(as(owner))
      .send({
        type: 'OUT',
        cashAccountId: acc('1-1110'),
        date: today,
        description: 'Telat dicatat',
        lines: [{ accountId: acc('6-4000'), amount: '1000' }],
      })
      .expect(400);
    expect(r.body.message).toMatch(/sudah diopname/);
    // akun kas lain tidak terkunci; tanggal sesudah opname boleh
    await http
      .post('/api/cash/transactions')
      .set(as(owner))
      .send({
        type: 'OUT',
        cashAccountId: acc('1-1110'),
        date: plus(today, 1),
        description: 'Beli air',
        lines: [{ accountId: acc('6-4000'), amount: '15000' }],
      })
      .expect(201);
    await http
      .post('/api/cash/counts')
      .set(as(fin))
      .send({ accountId: acc('1-1110'), date: today })
      .expect(400); // tidak boleh sebelum/sama opname terakhir
  });

  let second: string;
  it('selisih besar menunggu persetujuan Pemilik; tolak → hitung ulang; setujui', async () => {
    const day = plus(today, 1);
    const c = (
      await http
        .post('/api/cash/counts')
        .set(as(fin))
        .send({ accountId: acc('1-1110'), date: day })
        .expect(201)
    ).body;
    second = c.id;
    expect(Number(c.bookBalance)).toBe(980_000);
    await http
      .put(`/api/cash/counts/${c.id}`)
      .set(as(fin))
      .send({ denominations: { K100000: 9 }, reason: 'Belum ketemu' })
      .expect(200);
    const w = (await http.post(`/api/cash/counts/${c.id}/finish`).set(as(fin)).expect(200)).body;
    expect(w.status).toBe('WAITING_APPROVAL');
    expect(Number(w.difference)).toBe(-80_000);
    await http.post(`/api/cash/counts/${c.id}/approve`).set(as(fin)).expect(403);
    const rj = (
      await http
        .post(`/api/cash/counts/${c.id}/reject`)
        .set(as(owner))
        .send({ reason: 'Hitung ulang, cek laci kedua' })
        .expect(200)
    ).body;
    expect(rj).toMatchObject({ status: 'DRAFT', rejectReason: 'Hitung ulang, cek laci kedua' });
    await http
      .put(`/api/cash/counts/${c.id}`)
      .set(as(fin))
      .send({ denominations: { K100000: 9, K10000: 2 }, reason: 'Uang hilang Rp60.000, sedang ditelusuri' })
      .expect(200);
    expect((await http.post(`/api/cash/counts/${c.id}/finish`).set(as(fin)).expect(200)).body.status).toBe(
      'WAITING_APPROVAL',
    );
    const ok = (await http.post(`/api/cash/counts/${c.id}/approve`).set(as(owner)).expect(200)).body;
    expect(ok).toMatchObject({ status: 'POSTED', approvedBy: 'Pemilik' });
    expect(await balance('1-1110')).toBe(920_000);
  });

  it('pengaturan batas persetujuan khusus Pemilik', async () => {
    expect((await http.get('/api/cash/counts/settings').set(as(fin)).expect(200)).body.approvalThreshold).toBe(50_000);
    await http.put('/api/cash/counts/settings').set(as(fin)).send({ approvalThreshold: 0 }).expect(403);
    await http.put('/api/cash/counts/settings').set(as(owner)).send({ approvalThreshold: 100000 }).expect(200);
  });

  it('pembatalan opname selesai: hanya Pemilik, dari yang terbaru; jurnal dibalik & kunci dibuka', async () => {
    await http.post(`/api/cash/counts/${second}/cancel`).set(as(fin)).expect(403);
    await http.post(`/api/cash/counts/${first}/cancel`).set(as(owner)).expect(400); // masih ada yang lebih baru
    await http.post(`/api/cash/counts/${second}/cancel`).set(as(owner)).expect(200);
    expect(await balance('1-1110')).toBe(980_000);
    await http.post(`/api/cash/counts/${first}/cancel`).set(as(owner)).expect(200);
    expect(await balance('1-1110')).toBe(985_000);
    await http
      .post('/api/cash/transactions')
      .set(as(owner))
      .send({
        type: 'OUT',
        cashAccountId: acc('1-1110'),
        date: today,
        description: 'Sekarang boleh',
        lines: [{ accountId: acc('6-4000'), amount: '1000' }],
      })
      .expect(201);
    const list = (await http.get('/api/cash/counts').set(as(fin)).expect(200)).body as { status: string }[];
    expect(list.every((c) => c.status === 'CANCELLED')).toBe(true);
  });

  it('cek kesehatan mengingatkan opname kas', async () => {
    const h = (await http.get('/api/accounting/health').set(as(owner)).expect(200)).body as {
      checks: { key: string; status: string }[];
    };
    expect(h.checks.find((c) => c.key === 'cash-count')?.status).toBe('WARN');
  });
});
