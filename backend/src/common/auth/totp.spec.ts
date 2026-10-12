import { base32Decode, base32Encode, hotp, newBackupCodes, totp, verifyTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('vektor uji resmi RFC 6238 (SHA1)', () => {
    expect(totp(secret, 59_000, 8)).toBe('94287082');
    expect(totp(secret, 1111111109_000, 8)).toBe('07081804');
    expect(totp(secret, 2000000000_000, 8)).toBe('69279037');
  });
  it('vektor uji RFC 4226 (HOTP)', () => {
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224');
    expect(hotp(Buffer.from('12345678901234567890'), 9)).toBe('520489');
  });
  it('base32 bolak-balik', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('toleransi ±30 detik, tolak kode lain', () => {
    const now = 1_760_000_000_000;
    const code = totp(secret, now - 30_000);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
  });
  it('kode cadangan unik', () => {
    const c = newBackupCodes();
    expect(new Set(c).size).toBe(10);
    expect(c[0]).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
  });
});
