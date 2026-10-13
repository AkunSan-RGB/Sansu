import { cleanDbUrl, describeDbError, safeDbTarget } from './db-error';

describe('db-error', () => {
  const url = 'postgresql://pengguna:RAHASIA@ep-abc.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

  it('tidak pernah menampilkan password atau pengguna', () => {
    expect(safeDbTarget(url)).toBe('ep-abc.ap-southeast-1.aws.neon.tech/neondb');
    expect(describeDbError({ code: '28P01', message: 'x' }, url)).not.toMatch(/RAHASIA|pengguna:/);
  });

  it.each([
    [{ code: '28P01', message: 'password authentication failed for user "x"' }, /Password atau nama pengguna/],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' }, /host\) database tidak ditemukan/],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5434' }, /tidak menerima koneksi/],
    [{ code: '3D000', message: 'database "x" does not exist' }, /tidak ada/],
    [{ message: 'SSL/TLS required' }, /sslmode=require/],
  ])('menerjemahkan %j', (e, re) => expect(describeDbError(e, url)).toMatch(re));

  it('mengenali DATABASE_URL kosong dan tidak valid', () => {
    expect(describeDbError(new Error('x'), '')).toMatch(/belum diisi/);
    expect(safeDbTarget('bukan-url')).toMatch(/tidak valid/);
  });
});

describe('cleanDbUrl', () => {
  const ok = 'postgresql://pengguna:RAHASIA@ep-abc.neon.tech/neondb?sslmode=require';
  it('merapikan spasi, tanda kutip, dan awalan DATABASE_URL=', () => {
    expect(cleanDbUrl(`  ${ok}  `)).toBe(ok);
    expect(cleanDbUrl(`"${ok}"`)).toBe(ok);
    expect(cleanDbUrl(`'${ok}'`)).toBe(ok);
    expect(cleanDbUrl(`DATABASE_URL=${ok}`)).toBe(ok);
    expect(cleanDbUrl(`postgres://u:p@h/db`)).toBe('postgres://u:p@h/db');
  });
  it('menolak yang bukan alamat PostgreSQL, tanpa membocorkan isinya', () => {
    for (const bad of ['', 'ep-abc.neon.tech', 'psql postgresql://u:RAHASIA@h/db', 'mysql://u:RAHASIA@h/db', '${{Postgres.DATABASE_URL}}']) {
      let msg = '';
      try {
        cleanDbUrl(bad);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/DATABASE_URL/);
      expect(msg).not.toMatch(/RAHASIA/);
    }
  });
  it('galat host "base" dijelaskan sebagai DATABASE_URL tidak valid', () => {
    expect(describeDbError({ code: 'ENOTFOUND', hostname: 'base', message: 'getaddrinfo ENOTFOUND base' }, 'x')).toMatch(/bukan alamat PostgreSQL yang valid/);
  });
});
