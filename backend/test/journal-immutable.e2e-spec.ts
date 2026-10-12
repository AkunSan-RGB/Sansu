/** Jurnal terposting tidak bisa diubah/dihapus, bahkan lewat SQL langsung; koreksi hanya lewat jurnal balik */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jurnal tidak dapat diubah (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let token: string;
  let journalId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const MSG = /tidak boleh diubah atau dihapus/;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Jejak', name: 'Pemilik', email: `jejak-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const acc = (await http.get('/api/accounting/accounts').set(as())).body as { id: string; code: string }[];
    const id = (c: string) => acc.find((a) => a.code === c)!.id;
    journalId = (
      await http.post('/api/accounting/journals').set(as()).send({ date: todayJakarta(), description: 'Uji jejak', lines: [{ accountId: id('1-1100'), debit: '1000' }, { accountId: id('3-1000'), credit: '1000' }] }).expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  const reject = async (sql: string, params: unknown[] = []) => {
    await expect(pool.query(sql, params)).rejects.toThrow(MSG);
  };

  it('UPDATE dan DELETE pada jurnal dan baris jurnal ditolak database', async () => {
    await reject('UPDATE journal_lines SET debit = 999999 WHERE journal_id = $1', [journalId]);
    await reject('UPDATE journal_lines SET account_id = account_id WHERE journal_id = $1', [journalId]);
    await reject("UPDATE journal_entries SET description = 'diubah' WHERE id = $1", [journalId]);
    await reject("UPDATE journal_entries SET date = '2020-01-01' WHERE id = $1", [journalId]);
    await reject('DELETE FROM journal_lines WHERE journal_id = $1', [journalId]);
    await reject('DELETE FROM journal_entries WHERE id = $1', [journalId]);
  });

  it('jurnal tetap utuh setelah semua percobaan', async () => {
    const e = (await pool.query('SELECT description FROM journal_entries WHERE id = $1', [journalId])).rows;
    expect(e).toEqual([{ description: 'Uji jejak' }]);
    const l = (await pool.query('SELECT debit::numeric AS d, credit::numeric AS c FROM journal_lines WHERE journal_id = $1 ORDER BY debit DESC', [journalId])).rows;
    expect(l.map((r) => [Number(r.d), Number(r.c)])).toEqual([[1000, 0], [0, 1000]]);
  });

  it('koreksi lewat jurnal balik tetap berjalan (hanya menambah baris)', async () => {
    const rev = await http.post(`/api/accounting/journals/${journalId}/reverse`).set(as()).send({}).expect(201);
    expect(rev.body.reversalOfId).toBe(journalId);
    const tb = (await http.get('/api/accounting/reports/trial-balance').set(as()).expect(200)).body;
    expect(tb.balanced).toBe(true);
  });

  it('izin hapus eksplisit (reset data demo) hanya berlaku dalam transaksinya', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('sansu.allow_journal_delete', 'on', true)");
      // UPDATE tetap dilarang walau izin hapus menyala
      await expect(c.query('UPDATE journal_lines SET debit = 1 WHERE journal_id = $1', [journalId])).rejects.toThrow(MSG);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("SELECT set_config('sansu.allow_journal_delete', 'on', true)");
      const del = await c.query('DELETE FROM journal_lines WHERE journal_id = $1', [journalId]);
      expect(del.rowCount).toBe(2);
      await c.query('ROLLBACK'); // jangan benar-benar menghapus
    } finally {
      c.release();
    }
    // di luar transaksi tadi izin tidak berlaku
    await reject('DELETE FROM journal_lines WHERE journal_id = $1', [journalId]);
    expect((await pool.query('SELECT 1 FROM journal_lines WHERE journal_id = $1', [journalId])).rowCount).toBe(2);
  });
});
