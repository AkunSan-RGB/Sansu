import { TAX_PAYMENT_TYPES, taxDueDate } from '@sansu/shared';

describe('tenggat setor pajak', () => {
  it('PPh 21, 23, dan 4(2) disetor tanggal 10 bulan berikutnya', () => {
    for (const t of ['PPH21', 'PPH23', 'PPH4_2'] as const) {
      expect(taxDueDate(t, '2026-02')).toBe('2026-03-10');
      expect(taxDueDate(t, '2026-12')).toBe('2027-01-10'); // pergantian tahun
    }
  });
  it('PPh 25 dan PPh final UMKM disetor tanggal 15', () => {
    expect(taxDueDate('PPH25', '2026-05')).toBe('2026-06-15');
    expect(taxDueDate('PPH_FINAL', '2026-12')).toBe('2027-01-15');
  });
  it('PPN: akhir bulan berikutnya, termasuk Februari biasa dan kabisat', () => {
    expect(taxDueDate('PPN', '2026-01')).toBe('2026-02-28');
    expect(taxDueDate('PPN', '2027-01')).toBe('2027-02-28');
    expect(taxDueDate('PPN', '2028-01')).toBe('2028-02-29'); // kabisat
    expect(taxDueDate('PPN', '2026-03')).toBe('2026-04-30');
    expect(taxDueDate('PPN', '2026-12')).toBe('2027-01-31');
  });
  it('PPh 29 badan: 30 April tahun berikutnya, dari tahun pajak maupun periode bulan', () => {
    expect(taxDueDate('PPH29', '2026')).toBe('2027-04-30');
    expect(taxDueDate('PPH29', '2026-12')).toBe('2027-04-30');
  });
  it('BPJS: tanggal 10', () => {
    expect(taxDueDate('BPJS', '2026-09')).toBe('2026-10-10');
  });
  it('setiap jenis setoran punya tenggat berformat tanggal valid dan setelah masanya', () => {
    for (const t of TAX_PAYMENT_TYPES) {
      const d = taxDueDate(t, '2026-06');
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d > '2026-06-30').toBe(true);
    }
  });
});
