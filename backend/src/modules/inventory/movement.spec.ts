import { classifyMovement } from '@sansu/shared';

describe('klasifikasi perputaran stok menurut jenis usaha', () => {
  it('ritel: cakupan ≤14 hari cepat, ≤45 normal, lebih lambat', () => {
    expect(classifyMovement('RITEL', { onHand: 10, netOut: 30, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('FAST');
    expect(classifyMovement('RITEL', { onHand: 40, netOut: 30, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('NORMAL');
    expect(classifyMovement('RITEL', { onHand: 100, netOut: 30, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('SLOW');
  });
  it('barang yang sama (stok 60, keluar 1/hari) lambat di toko tetapi normal di dagang & produksi', () => {
    expect(classifyMovement('RITEL', { onHand: 60, netOut: 30, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('SLOW');
    expect(classifyMovement('DAGANG', { onHand: 60, netOut: 90, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('NORMAL');
    expect(classifyMovement('MANUFAKTUR', { onHand: 60, netOut: 90, ageDays: 400, lastOutDaysAgo: 1 }).cls).toBe('NORMAL');
  });
  it('tidak bergerak, baru, habis', () => {
    expect(classifyMovement('DAGANG', { onHand: 10, netOut: 0, ageDays: 300, lastOutDaysAgo: null }).cls).toBe('DEAD');
    expect(classifyMovement('DAGANG', { onHand: 10, netOut: 0, ageDays: 20, lastOutDaysAgo: null }).cls).toBe('NEW');
    expect(classifyMovement('DAGANG', { onHand: 10, netOut: 0, ageDays: 300, lastOutDaysAgo: 100 }).cls).toBe('SLOW');
    expect(classifyMovement('DAGANG', { onHand: 0, netOut: 5, ageDays: 300, lastOutDaysAgo: 1 }).cls).toBe('OUT');
    expect(classifyMovement('DAGANG', { onHand: 0, netOut: 0, ageDays: 300, lastOutDaysAgo: 200 }).cls).toBe('EMPTY');
  });
  it('barang baru tidak tampak lambat hanya karena baru masuk', () => {
    // 7 hari lalu masuk, terjual 7 → 1/hari, stok 10 → cakupan 10 hari → cepat
    expect(classifyMovement('DAGANG', { onHand: 10, netOut: 7, ageDays: 7, lastOutDaysAgo: 0 }).cls).toBe('FAST');
  });
});
