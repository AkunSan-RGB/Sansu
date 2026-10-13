import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnTo';

describe('safeReturnPath', () => {
  it('menerima jalur internal', () => {
    expect(safeReturnPath('/invoices?x=1')).toBe('/invoices?x=1');
    expect(safeReturnPath('/')).toBe('/');
  });
  it('menolak alamat luar, protokol-relatif, dan halaman auth', () => {
    expect(safeReturnPath('https://jahat.example')).toBeUndefined();
    expect(safeReturnPath('//jahat.example')).toBeUndefined();
    expect(safeReturnPath('/\\jahat.example')).toBeUndefined();
    expect(safeReturnPath('/login')).toBeUndefined();
    expect(safeReturnPath('/forgot-password')).toBeUndefined();
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath('/' + 'a'.repeat(600))).toBeUndefined();
  });
});
