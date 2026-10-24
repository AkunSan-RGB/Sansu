/**
 * Kunci idempotensi (e2e): kirim ulang dengan Idempotency-Key yang sama tidak menggandakan transaksi uang;
 * jawaban pertama diputar ulang. Kunci yang dipakai permintaan lain ditolak; permintaan gagal melepas kuncinya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kunci idempotensi (e2e)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashId: string;
  let exp: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const out = (key: string | undefined, over: Record<string, unknown> = {}) => {
    const r = http.post('/api/cash/transactions').set(as(owner));
    if (key) r.set('Idempotency-Key', key);
    return r.send({ type: 'OUT', cashAccountId: cashId, date: todayJakarta(), description: 'uji idempotensi', lines: [{ accountId: exp, amount: '1000' }], ...over });
  };
  const count = async () => ((await http.get('/api/cash/transactions').set(as(owner)).expect(200)).body as { description: string }[]).filter((t) => t.description === 'uji idempotensi').length;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Idempoten', name: 'Pemilik', email: `id-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await http.put('/api/cash/settings').set(as(owner)).send({ blockNegative: false }).expect(200);
    cashId = (await http.get('/api/cash/accounts').set(as(owner)).expect(200)).body[0].id;
    const coa = (await http.get('/api/accounting/accounts').set(as(owner)).expect(200)).body as { id: string; type: string; parentId: string | null }[];
    exp = coa.filter((x) => x.type === 'EXPENSE' && !coa.some((y) => y.parentId === x.id))[0].id;
  });
  afterAll(() => app.close());

  it('kirim ulang dengan kunci sama: satu transaksi, jawaban sama diputar ulang', async () => {
    const a = await out('kunci-uji-0001').expect(201);
    const b = await out('kunci-uji-0001').expect(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.number).toBe(a.body.number);
    expect(await count()).toBe(1);
  });

  it('tanpa kunci perilaku tetap: dua permintaan = dua transaksi', async () => {
    await out(undefined).expect(201);
    await out(undefined).expect(201);
    expect(await count()).toBe(3);
  });

  it('kunci dipakai isi berbeda atau alamat lain: 422', async () => {
    const r = await out('kunci-uji-0001', { lines: [{ accountId: exp, amount: '5000' }] }).expect(422);
    expect(r.body.message).toContain('sudah dipakai');
    const other = await http.post('/api/suppliers').set(as(owner)).set('Idempotency-Key', 'kunci-uji-0001').send({ code: 'S-ID', name: 'Pemasok' });
    expect(other.status).toBe(422);
  });

  it('permintaan gagal melepas kunci: kirim ulang yang sudah benar dijalankan', async () => {
    await out('kunci-uji-0002', { lines: [{ accountId: exp, amount: '0' }] }).expect(400);
    const ok = await out('kunci-uji-0002', { lines: [{ accountId: exp, amount: '0' }] }).expect(400); // isi sama, tetap gagal tapi tidak 409/422
    expect(ok.headers['idempotent-replay']).toBeUndefined();
    await out('kunci-uji-0002').expect(201); // isi berbeda tidak lagi terkunci karena kegagalan melepas kunci
    expect(await count()).toBe(4);
  });

  it('lima permintaan sama serentak: hanya satu yang dijalankan', async () => {
    const before = await count();
    const rs = await Promise.all(Array.from({ length: 5 }, () => out('kunci-uji-0003')));
    expect(rs.filter((r) => r.status >= 500)).toEqual([]);
    expect(rs.filter((r) => r.status === 201 && !r.headers['idempotent-replay'])).toHaveLength(1);
    expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(await count()).toBe(before + 1);
  });

  it('kunci tidak valid ditolak', async () => {
    await out('pendek').expect(400);
  });
});
