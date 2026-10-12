import { describeDbError, safeDbTarget } from './db-error';

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
