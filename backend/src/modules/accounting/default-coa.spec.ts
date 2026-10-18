import { DEFAULT_COA } from './default-coa';

/** Bagan akun beban operasional: satu akun = satu jenis beban (tidak ada nama gabungan "A & B" atau "A, B") */
describe('Bagan akun beban operasional', () => {
  // Beban gaji dan tunjangan dijurnal otomatis oleh penggajian dalam satu akun (SALARY_EXPENSE)
  const ALLOWED = new Set(['6-1000']);
  const opex = DEFAULT_COA.filter((r) => r.code.startsWith('6-') && !r.header);

  it('tidak ada beban operasional bernama gabungan', () => {
    const bad = opex.filter((r) => !ALLOWED.has(r.code) && /(&| dan |,)/i.test([r.name, ...Object.values(r.names ?? {})].join('|')));
    expect(bad.map((r) => `${r.code} ${r.name}`)).toEqual([]);
  });

  it('kode akun unik', () => {
    const codes = DEFAULT_COA.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('akun hasil pemisahan diwarisi dari nama lama agar akun perusahaan lama diganti namanya', () => {
    const renamed = opex.filter((r) => r.was?.length);
    expect(renamed.length).toBeGreaterThanOrEqual(15);
  });
});
