import { describe, expect, it } from 'vitest';
import { profileCostOptions, withProfileCosts } from './profileCosts';

const accounts = [
  { id: 'a1', code: '5-1500', name: 'Beban Subkontraktor' },
  { id: 'a2', code: '5-1810', name: 'Honor Pengajar per Sesi' },
  { id: 'a3', code: '6-3000', name: 'Beban Sewa' },
];

describe('jenis biaya khas profil', () => {
  it('kontraktor melihat subkontraktor, pendidikan melihat honor pengajar', () => {
    expect(profileCostOptions('JASA', ['KONTRAKTOR'], accounts).map((o) => o.value)).toEqual(['a1']);
    expect(profileCostOptions('JASA', ['PENDIDIKAN'], accounts).map((o) => o.value)).toEqual(['a2']);
  });
  it('jenis usaha lain tidak berubah', () => {
    const rest = accounts.map((a) => ({ value: a.id, label: a.code }));
    expect(withProfileCosts('DAGANG', undefined, accounts, rest)).toBe(rest);
  });
  it('akun khas di kelompok atas dan tidak muncul dua kali', () => {
    const rest = accounts.map((a) => ({ value: a.id, label: a.code }));
    const g = withProfileCosts('JASA', ['KONTRAKTOR'], accounts, rest) as { label: string; options: { value: string }[] }[];
    expect(g[0].options.map((o) => o.value)).toEqual(['a1']);
    expect(g[1].options.map((o) => o.value)).toEqual(['a2', 'a3']);
  });
});
