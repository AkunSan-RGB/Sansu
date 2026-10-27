/**
 * Batas waktu database (e2e): koneksi aplikasi membawa batas waktu kueri dan batas waktu transaksi menganggur, dan kueri yang
 * melewatinya dibatalkan dengan kode 57014 (bukan menggantung dan menahan kolam koneksi).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { POOL } from '../src/db/db';

describe('Batas waktu database (e2e)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    pool = app.get<Pool>(POOL, { strict: false });
  });
  afterAll(() => app.close());

  it('koneksi aplikasi membawa batas waktu kueri dan transaksi menganggur', async () => {
    const st = await pool.query('SHOW statement_timeout');
    const idle = await pool.query('SHOW idle_in_transaction_session_timeout');
    expect(st.rows[0].statement_timeout).toBe('1min');
    expect(idle.rows[0].idle_in_transaction_session_timeout).toBe('1min');
  });

  it('kueri yang melewati batas dibatalkan (57014) dan koneksi tetap sehat sesudahnya', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '200ms'");
      const t0 = Date.now();
      await expect(client.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - t0).toBeLessThan(3000);
      await client.query('ROLLBACK');
      expect((await client.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    } finally {
      client.release();
    }
  });
});
