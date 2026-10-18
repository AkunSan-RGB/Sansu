/**
 * Jenis usaha dikunci per perusahaan: boleh diubah selama belum ada transaksi; begitu ada transaksi, berganti ke jenis lain
 * ditolak untuk SEMUA jenis usaha (data antar jenis usaha tidak boleh tercampur). Perusahaan lama yang belum pernah memilih
 * (nilai bawaan) boleh memilih satu kali.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'] as const;

describe('Jenis usaha dikunci setelah bertransaksi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
  });
  afterAll(() => app.close());

  const reg = async (model: string, tag: string) => {
    const r = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'P', email: `kl-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body;
    return { token: r.accessToken as string, tenantId: r.user.tenantId as string };
  };
  const put = (t: string, model: string) => http.put('/api/settings/business').set(as(t)).send({ model, applyApps: false });
  const book = async (t: string) => {
    const cash = (await http.get('/api/cash/accounts').set(as(t)).expect(200)).body[0].id;
    const equity = ((await http.get('/api/cash/counter-accounts').set(as(t)).expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
    await http.post('/api/cash/transactions').set(as(t)).send({ type: 'IN', cashAccountId: cash, date: today, description: 'Modal awal', reference: 'M-1', lines: [{ accountId: equity, amount: '1000000' }] }).expect(201);
  };

  describe.each(MODELS)('%s', (m) => {
    it('boleh diganti sebelum ada transaksi, terkunci setelahnya untuk semua jenis lain', async () => {
      const { token } = await reg(m, m.toLowerCase());
      const other = MODELS.find((x) => x !== m)!;
      expect((await http.get('/api/settings/business').set(as(token)).expect(200)).body.locked).toBe(false);
      await put(token, other).expect(200); // belum bertransaksi: boleh
      await put(token, m).expect(200); // kembali
      await book(token);
      expect((await http.get('/api/settings/business').set(as(token)).expect(200)).body).toMatchObject({ model: m, locked: true });
      for (const target of MODELS.filter((x) => x !== m)) {
        const r = await put(token, target);
        expect({ target, status: r.status }).toEqual({ target, status: 409 });
        expect(JSON.stringify(r.body)).toMatch(/dikunci/);
      }
      await put(token, m).expect(200); // model yang sama tetap sah
      expect((await http.get('/api/auth/me').set(as(token)).expect(200)).body.businessModel).toBe(m);
    });
  });

  it('perusahaan lama yang belum pernah memilih jenis usaha boleh memilih satu kali, lalu terkunci', async () => {
    const { token, tenantId } = await reg('DAGANG', 'lama');
    await book(token);
    await db.execute(sql`UPDATE tenants SET settings = settings - 'business' WHERE id = ${tenantId}`); // meniru data lama: tanpa pilihan
    expect((await http.get('/api/settings/business').set(as(token)).expect(200)).body.locked).toBe(false);
    await put(token, 'JASA').expect(200);
    expect((await put(token, 'FMCG')).status).toBe(409);
  });

  it('dua perusahaan berbeda jenis tidak saling memengaruhi', async () => {
    const a = await reg('FMCG', 'sepa');
    const b = await reg('JASA', 'sepb');
    await book(a.token);
    expect((await put(a.token, 'JASA')).status).toBe(409);
    await put(b.token, 'DAGANG').expect(200); // b belum bertransaksi: tidak ikut terkunci
    expect((await http.get('/api/auth/me').set(as(a.token)).expect(200)).body.businessModel).toBe('FMCG');
  });

  it('menyimpan pengaturan lain tidak mengembalikan jenis usaha ke nilai lama (penulisan atomik)', async () => {
    const { token } = await reg('DAGANG', 'atom');
    await Promise.all([put(token, 'JASA'), http.put('/api/settings/reporting').set(as(token)).send({ city: 'Bandung' }), http.put('/api/settings/payroll').set(as(token)).send({ workDaysPerWeek: 5 })]);
    expect((await http.get('/api/auth/me').set(as(token)).expect(200)).body.businessModel).toBe('JASA');
  });
});
