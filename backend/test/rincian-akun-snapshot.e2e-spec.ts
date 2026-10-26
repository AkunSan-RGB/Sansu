/**
 * Pembekuan laporan keuangan yang ditandatangani (e2e): snapshot tidak dapat diubah/dihapus (dijaga database), perbandingan dengan
 * pembukuan terkini menampilkan selisih per akun dan jurnal susulan, dan hanya pembukuan yang boleh membekukan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pembekuan laporan keuangan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let owner: string;
  const year = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = Date.now();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Beku', name: 'Pemilik', email: `beku-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const acc = (await http.get('/api/accounting/accounts').set(as(owner))).body as { id: string; code: string }[];
    const id = (c: string) => acc.find((a) => a.code === c)!.id;
    await http.post('/api/accounting/journals').set(as(owner)).send({ date: today, description: 'Modal', lines: [{ accountId: id('1-1100'), debit: '5000000' }, { accountId: id('3-1000'), credit: '5000000' }] }).expect(201);
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('membekukan laporan: versi 1 tercatat, perbandingan langsung menunjukkan tidak ada perubahan', async () => {
    const f = (await http.post('/api/account-schedules/snapshots').set(as(owner)).send({ year, note: 'Ditandatangani direksi' }).expect(201)).body;
    expect(f.version).toBe(1);
    expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const list = (await http.get(`/api/account-schedules/snapshots?year=${year}`).set(as(owner)).expect(200)).body as { version: number; signedByName: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].signedByName).toBe('Pemilik');
    const c = (await http.get(`/api/account-schedules/snapshots/compare?year=${year}`).set(as(owner)).expect(200)).body;
    expect(c.intact).toBe(true);
    expect(c.unchanged).toBe(true);
    expect(c.lateJournals).toHaveLength(0);
  });

  it('jurnal susulan setelah pembekuan: selisih per akun dan daftar jurnal susulan terlihat', async () => {
    const acc = (await http.get('/api/accounting/accounts').set(as(owner))).body as { id: string; code: string }[];
    const id = (c: string) => acc.find((a) => a.code === c)!.id;
    await new Promise((r) => setTimeout(r, 1100));
    await http.post('/api/accounting/journals').set(as(owner)).send({ date: today, description: 'Susulan', lines: [{ accountId: id('1-1100'), debit: '700000' }, { accountId: id('3-1000'), credit: '700000' }] }).expect(201);
    const c = (await http.get(`/api/account-schedules/snapshots/compare?year=${year}`).set(as(owner)).expect(200)).body;
    expect(c.unchanged).toBe(false);
    expect(c.intact).toBe(true);
    const cash = c.accounts.find((a: { code: string }) => a.code === '1-1100');
    expect(Number(cash.delta)).toBe(700000);
    expect(Number(c.totals.find((t: { key: string }) => t.key === 'assets').delta)).toBe(700000);
    expect(c.lateJournals.map((j: { description: string }) => j.description)).toContain('Susulan');
    expect(Number(c.lateTotal)).toBe(700000);
  });

  it('membekukan lagi membuat versi 2; versi 1 tetap dapat dibandingkan', async () => {
    const f = (await http.post('/api/account-schedules/snapshots').set(as(owner)).send({ year }).expect(201)).body;
    expect(f.version).toBe(2);
    const latest = (await http.get(`/api/account-schedules/snapshots/compare?year=${year}`).set(as(owner)).expect(200)).body;
    expect(latest.snapshot.version).toBe(2);
    expect(latest.unchanged).toBe(true);
    const v1 = (await http.get(`/api/account-schedules/snapshots/compare?year=${year}&version=1`).set(as(owner)).expect(200)).body;
    expect(v1.snapshot.version).toBe(1);
    expect(v1.unchanged).toBe(false);
  });

  it('snapshot tidak dapat diubah atau dihapus, bahkan lewat SQL langsung', async () => {
    await expect(pool.query(`UPDATE report_snapshots SET note = 'ubah'`)).rejects.toThrow(/tidak boleh diubah atau dihapus/);
    await expect(pool.query(`DELETE FROM report_snapshots`)).rejects.toThrow(/tidak boleh diubah atau dihapus/);
  });

  it('hanya pembukuan yang boleh membekukan; Keuangan hanya melihat; tahun depan ditolak', async () => {
    await http.post('/api/users').set(as(owner)).send({ name: 'Kasir Uang', email: `beku-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    const fin = (await http.post('/api/auth/login').send({ email: `beku-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken as string;
    await http.post('/api/account-schedules/snapshots').set(as(fin)).send({ year }).expect(403);
    await http.get(`/api/account-schedules/snapshots?year=${year}`).set(as(fin)).expect(200);
    await http.post('/api/account-schedules/snapshots').set(as(owner)).send({ year: year + 1 }).expect(400);
    await http.get(`/api/account-schedules/snapshots/compare?year=${year - 3}`).set(as(owner)).expect(404);
  });
});
