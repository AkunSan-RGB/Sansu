import { describe, expect, it } from 'vitest';
import { terbilang } from './terbilang';

describe('terbilang', () => {
  it.each([
    [0, 'Nol rupiah'],
    [11, 'Sebelas rupiah'],
    [1001, 'Seribu satu rupiah'],
    [110000, 'Seratus sepuluh ribu rupiah'],
    [1250500, 'Satu juta dua ratus lima puluh ribu lima ratus rupiah'],
    [12366510.4, 'Dua belas juta tiga ratus enam puluh enam ribu lima ratus sepuluh rupiah'],
    [1000000001, 'Satu miliar satu rupiah'],
  ])('%d', (n, s) => expect(terbilang(n)).toBe(s));
});
