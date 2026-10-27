import { normalizePage, wantsPage } from './pagination';

describe('paginasi', () => {
  it('nilai bawaan, batas atas, dan masukan sembarang dibersihkan', () => {
    expect(normalizePage({ page: 1 })).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(normalizePage({ page: '3', pageSize: '20' })).toEqual({ page: 3, limit: 20, offset: 40 });
    expect(normalizePage({ page: 2, pageSize: 99999 })).toEqual({ page: 2, limit: 200, offset: 200 });
    expect(normalizePage({ page: -4, pageSize: 0 })).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(normalizePage({ page: 'abc', pageSize: 'x' })).toEqual({ page: 1, limit: 50, offset: 0 });
  });
  it('tanpa parameter page respons lama tetap berlaku', () => {
    expect(wantsPage({})).toBe(false);
    expect(wantsPage({ page: '' })).toBe(false);
    expect(wantsPage({ page: '1' })).toBe(true);
  });
});
