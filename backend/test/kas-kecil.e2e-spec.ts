/**
 * Kas kecil — sistem dana tetap (e2e): pendirian dana, bukti kas kecil, pagar kas umum, pengisian kembali dengan persetujuan,
 * pembatalan, dan temuan kontrol.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kas kecil — dana tetap (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let pettyId: string;
  let bankCashId: string;
  let expenseId: string;
  let equityId: string;
  let fundId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const bal = async (id: string) => Number(((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; balance: string }[]).find((a) => a.id === id)!.balance);
  const voucher = (t: string, amount: string, receiptRef: string, extra: object = {}) =>
    post(t, '/api/petty-cash/vouchers', { fundId, date: day, payee: 'Toko ATK', description: 'Beli ATK', expenseAccountId: expenseId, amount, receiptRef, ...extra });
  const funds = async () => ((await get(owner, '/api/petty-cash/funds').expect(200)).body as { variance: string; balance: string; openCount: number; openVouchers: string }[])[0];
  const keys = async () => ((await get(owner, '/api/petty-cash/controls').expect(200)).body as { items: { key: string }[] }).items.map((i) => i.key.split(':')[0]);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kas Kecil', name: 'Pemilik', email: `kc-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Juru Kas', email: `kc-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `kc-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    const accs = (await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[];
    pettyId = accs.find((a) => a.code === '1-1110')!.id;
    bankCashId = accs.find((a) => a.code === '1-1100')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; code: string; type: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: bankCashId, date: day, description: 'Modal', reference: 'M1', lines: [{ accountId: equityId, amount: '20000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('pendirian dana: hanya admin/pemilik; plafon & batas bukti divalidasi; dana diisi dari kas besar', async () => {
    const dto = { accountId: pettyId, fundingAccountId: bankCashId, name: 'Kas Kecil Kantor', custodianName: 'Siti', imprestAmount: '2000000', maxVoucher: '200000' };
    await http.put('/api/petty-cash/funds').set(as(finance)).send(dto).expect(403);
    await http.put('/api/petty-cash/funds').set(as(owner)).send({ ...dto, maxVoucher: '3000000' }).expect(400);
    await http.put('/api/petty-cash/funds').set(as(owner)).send({ ...dto, fundingAccountId: pettyId }).expect(400);
    fundId = (await http.put('/api/petty-cash/funds').set(as(owner)).send(dto).expect(200)).body.id;
    const before = await bal(bankCashId);
    await post(owner, `/api/petty-cash/funds/${fundId}/top-up`, {}).expect(201);
    expect(await bal(pettyId)).toBe(2000000);
    expect(await bal(bankCashId)).toBe(before - 2000000);
    await post(owner, `/api/petty-cash/funds/${fundId}/top-up`, {}).expect(400); // sudah penuh
    expect((await funds()).variance).toBe('0.00');
  });

  it('pagar kas umum: kas kecil tidak bisa dikeluarkan/diisi lewat kas biasa dan tidak boleh melebihi plafon', async () => {
    const r1 = await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: pettyId, date: day, description: 'Bocor', reference: 'X', lines: [{ accountId: expenseId, amount: '1000' }] });
    expect(r1.status).toBe(400);
    expect(JSON.stringify(r1.body)).toMatch(/Kas Kecil/);
    const r2 = await post(owner, '/api/cash/transactions', { type: 'TRANSFER', cashAccountId: bankCashId, toCashAccountId: pettyId, date: day, description: 'Isi', amount: '1000', reference: 'Y' });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(r2.body)).toMatch(/melebihi dana tetap/);
  });

  it('bukti kas kecil: nota wajib & unik, batas per bukti, hanya akun beban, kas kecil berkurang dan beban tercatat', async () => {
    await voucher(finance, '300000', 'N-1').expect(400); // melebihi batas per bukti
    await voucher(finance, '50000', '').expect(400); // tanpa nota
    await voucher(finance, '50000', 'N-1', { expenseAccountId: equityId }).expect(400); // bukan beban
    await voucher(finance, '150000', 'N-1').expect(201);
    await voucher(finance, '20000', 'n-1').expect(400); // nota ganda (tak peka huruf)
    await voucher(finance, '100000', 'N-2').expect(201);
    expect(await bal(pettyId)).toBe(2000000 - 250000);
    const f = await funds();
    expect(f).toMatchObject({ openCount: 2, openVouchers: '250000.00', variance: '0.00' });
  });

  it('pembatalan bukti: hanya pemilik/admin, dana kembali', async () => {
    const v = (await voucher(finance, '40000', 'N-3').expect(201)).body as { id: string };
    expect(await bal(pettyId)).toBe(2000000 - 290000);
    await post(finance, `/api/petty-cash/vouchers/${v.id}/void`, { reason: 'Nota salah' }).expect(403);
    await post(owner, `/api/petty-cash/vouchers/${v.id}/void`, { reason: 'Nota salah' }).expect(201);
    expect(await bal(pettyId)).toBe(2000000 - 250000);
    expect((await funds()).variance).toBe('0.00');
  });

  it('pengisian kembali: peran lain menunggu persetujuan; setelah disetujui dana kembali ke plafon dan bukti menjadi diganti', async () => {
    const r = await post(finance, `/api/petty-cash/funds/${fundId}/replenish`, {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    expect(await bal(pettyId)).toBe(2000000 - 250000);
    const pending = ((await get(owner, '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string }[]).find((x) => x.kind === 'PETTY_REPLENISH')!;
    expect(pending).toBeTruthy();
    await post(owner, `/api/approvals/${pending.id}/approve`, { note: 'Sesuai nota' }).expect(201);
    expect(await bal(pettyId)).toBe(2000000);
    const f = await funds();
    expect(f).toMatchObject({ openCount: 0, variance: '0.00' });
    const list = (await get(owner, '/api/petty-cash/vouchers').expect(200)).body as { status: string }[];
    expect(list.filter((x) => x.status === 'REPLENISHED')).toHaveLength(2);
    await post(owner, `/api/petty-cash/funds/${fundId}/replenish`, {}).expect(400); // tak ada bukti
  });

  it('kontrol: saldo kas kecil dikurangi tanpa bukti (kekurangan) memicu temuan selisih; belum ada hitung kas', async () => {
    expect(await keys()).toContain('COUNT');
    // kekurangan tak terjelaskan: jurnal manual mengurangi kas kecil
    await post(owner, '/api/accounting/journals', { date: day, description: 'Koreksi uji', lines: [{ accountId: expenseId, debit: '30000' }, { accountId: pettyId, credit: '30000' }] }).expect(201);
    const k = await keys();
    expect(k).toContain('MISMATCH');
  });
});
