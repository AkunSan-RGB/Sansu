import { digitsOnly, isNik, isNpwp } from './npwp';

describe('validasi NPWP / NIK', () => {
  it('NPWP: 15 digit lama dan 16 digit baru, dengan atau tanpa pemisah', () => {
    for (const v of ['012345678901234', '0123456789012345', '01.234.567.8-901.000', '01.234.567.8-901.0000', ' 0123 4567 8901 2345 ']) expect(isNpwp(v)).toBe(true);
  });
  it('menolak jumlah digit lain, huruf, dan karakter selain pemisah wajar', () => {
    for (const v of ['', '12345', '01234567890123', '01234567890123456', 'ABCDEFGHIJKLMNO', '0123456789012A5', '01/234/567', '012345678901234x', null, undefined, 123456789012345]) expect(isNpwp(v)).toBe(false);
  });
  it('NIK harus tepat 16 digit', () => {
    expect(isNik('3174012345678901')).toBe(true);
    expect(isNik('317401234567890')).toBe(false);
    expect(isNik('31740123456789012')).toBe(false);
    expect(isNik('317401234567890A')).toBe(false);
  });
  it('digitsOnly membuang pemisah', () => {
    expect(digitsOnly('01.234.567.8-901.000')).toBe('012345678901000');
  });
});
