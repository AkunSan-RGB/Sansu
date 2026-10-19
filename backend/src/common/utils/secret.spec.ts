import { decrypt, encrypt } from './secret';

describe('enkripsi token', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('bolak-balik dan setiap enkripsi memakai IV berbeda', () => {
    process.env.DATA_ENCRYPTION_KEY = 'k'.repeat(40);
    const a = encrypt('token-rahasia');
    expect(a).not.toContain('token-rahasia');
    expect(encrypt('token-rahasia')).not.toBe(a);
    expect(decrypt(a)).toBe('token-rahasia');
  });

  it('data lama (kunci turunan JWT_SECRET) tetap terbaca setelah DATA_ENCRYPTION_KEY diisi', () => {
    process.env.JWT_SECRET = 'j'.repeat(40);
    delete process.env.DATA_ENCRYPTION_KEY;
    const old = encrypt('token-lama');
    process.env.DATA_ENCRYPTION_KEY = 'd'.repeat(40);
    expect(decrypt(old)).toBe('token-lama');
    const fresh = encrypt('token-baru'); // enkripsi baru memakai kunci baru
    process.env.JWT_SECRET = 'x'.repeat(40);
    expect(decrypt(fresh)).toBe('token-baru'); // tidak bergantung lagi pada JWT_SECRET
  });

  it('data rusak atau kunci salah ditolak', () => {
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(40);
    const blob = encrypt('x');
    process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(40);
    process.env.JWT_SECRET = 'c'.repeat(40);
    expect(() => decrypt(blob)).toThrow();
    expect(() => decrypt('v1.AAAA.BBBB.CCCC')).toThrow();
  });
});
