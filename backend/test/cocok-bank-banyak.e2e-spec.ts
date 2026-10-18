/**
 * Pencocokan bank satu-ke-banyak: satu mutasi bank (mis. setoran gabungan) cocok dengan beberapa transaksi buku.
 * Jumlah harus persis sama; transaksi yang sudah dicocokkan tidak bisa dibatalkan; batalkan pencocokan membebaskan semuanya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Cocok bank satu-ke-banyak (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let fin: string; let acct: string;
  let bankId: string; let kasId: string; let equityId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const bankIn = (amount: string, desc: string) => post('/api/cash/transactions', { type: 'IN', cashAccountId: bankId, date: today, description: desc, lines: [{ accountId: equityId, amount }] }).expect(201);
  const bookLineOf = async (journalNumber: string, accountId: string) => {
    const rows = (await get(`/api/bank/lines/${lineId}/candidates`, fin).expect(200)).body as { id: string; description: string }[];
    return rows.find((r) => r.description.includes(journalNumber))!.id;
  };
  let lineId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Bank Gabung', name: 'P', email: `bg-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `bg-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `bg-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    acct = await mk('ACCOUNTANT', 'akuntan');
    const accs = (await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    bankId = accs.find((a) => a.code === '1-1200')!.id;
    kasId = accs.find((a) => a.code === '1-1100')!.id;
    equityId = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
  });
  afterAll(() => app.close());

  let t1: { number: string; id: string }; let t2: { number: string; id: string }; let t3: { number: string };
  it('setoran gabungan: satu-satu tidak cocok, tetapi gabungan persis sama bisa dicocokkan', async () => {
    t1 = (await bankIn('100000', 'Pembayaran pelanggan A')).body;
    t2 = (await bankIn('200000', 'Pembayaran pelanggan B')).body;
    t3 = (await bankIn('50000', 'Pembayaran pelanggan C')).body;
    const st = (await post('/api/bank/statements', { cashAccountId: bankId, lines: [{ date: today, description: 'TRSF MASUK GABUNGAN', amount: '300000' }] }, fin).expect(201)).body;
    lineId = st.lines[0].id;
    expect(st.lines[0].status).toBe('UNMATCHED'); // otomatis tidak cocok: tidak ada satu transaksi bernilai 300.000
    const j1 = await bookLineOf(t1.number, bankId);
    const j2 = await bookLineOf(t2.number, bankId);
    const j3 = await bookLineOf(t3.number, bankId);
    // salah: satu-satu berbeda nilai
    expect((await post(`/api/bank/lines/${lineId}/match`, { journalLineId: j1 }, fin)).status).toBe(400);
    // salah: jumlah tidak persis sama
    expect((await post(`/api/bank/lines/${lineId}/match-many`, { journalLineIds: [j1, j3] }, fin)).status).toBe(400);
    expect((await post(`/api/bank/lines/${lineId}/match-many`, { journalLineIds: [j1, j1] }, fin)).status).toBe(400);
    expect((await post(`/api/bank/lines/${lineId}/match-many`, { journalLineIds: [j1] }, fin)).status).toBe(400); // minimal dua
    // peran: Akuntan tidak mencocokkan
    expect((await post(`/api/bank/lines/${lineId}/match-many`, { journalLineIds: [j1, j2] }, acct)).status).toBe(403);
    await post(`/api/bank/lines/${lineId}/match-many`, { journalLineIds: [j1, j2] }, fin).expect(201);
    const got = (await get(`/api/bank/statements/${st.id}`, fin).expect(200)).body.lines[0];
    expect(got.status).toBe('MATCHED');
    expect(got.extraBooks).toBe(1);
    // sudah dicocokkan: tidak muncul lagi sebagai kandidat/transaksi terbuka
    const left = (await get(`/api/bank/reconciliation?cashAccountId=${bankId}&asOf=${today}`, fin).expect(200)).body;
    const desc = (left.depositsInTransit as { description: string }[]).map((d) => d.description).join('|');
    expect(desc).toContain(t3.number);
    expect(desc).not.toContain(t1.number);
    expect(desc).not.toContain(t2.number);
  });

  it('transaksi yang sudah dicocokkan (termasuk yang tambahan) tidak bisa dibatalkan', async () => {
    const r = await post(`/api/cash/transactions/${t2.id}/void`, { reason: 'salah catat' }, owner);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/dicocokkan/);
    expect((await post(`/api/cash/transactions/${t1.id}/void`, { reason: 'salah catat' }, owner)).status).toBe(400);
  });

  it('batalkan pencocokan membebaskan semua transaksi', async () => {
    await post(`/api/bank/lines/${lineId}/unmatch`, {}, fin).expect(201);
    await post(`/api/cash/transactions/${t2.id}/void`, { reason: 'salah catat, dibatalkan' }, owner).expect(201);
  });
});
