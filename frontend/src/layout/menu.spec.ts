import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

/** Setiap tautan menu harus punya halaman (rute) — mencegah menu yang membuka halaman kosong */
describe('menu sidebar', () => {
  const app = read('../App.tsx');
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1].replace(/^\/|\/$/g, ''));
  const keys = [...new Set([...read('./menuData.tsx').matchAll(/\{ key: '(\/[^']*)'/g)].map((m) => m[1]))];
  const hasRoute = (key: string) => {
    const p = key.split('?')[0].replace(/^\/|\/$/g, '');
    if (p === '' || p === 'pos') return true; // rute indeks di dalam layout / kasir
    return routes.some((r) => new RegExp(`^${r.replace(/\/?:[A-Za-z]+\??/g, '(/[^/]+)?')}$`).test(p));
  };
  it('semua tautan menu punya rute', () => {
    expect(keys.filter((k) => !hasRoute(k))).toEqual([]);
  });
  it('menu Layanan utilitas terdaftar dan rutenya ada', () => {
    expect(keys).toEqual(expect.arrayContaining(['/utility/sambungan', '/utility/meter', '/utility/tagihan', '/utility/tunggakan', '/utility/tarif']));
    expect(hasRoute('/utility/meter')).toBe(true);
  });
});
