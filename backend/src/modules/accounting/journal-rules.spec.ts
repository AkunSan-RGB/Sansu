import { interBranchBalancingLines, JournalValidationError, normalizeJournalLines } from './journal-rules';

describe('normalizeJournalLines', () => {
  it('menerima jurnal seimbang dan membuang baris nol', () => {
    const r = normalizeJournalLines([
      { accountId: 'ar', debit: '111000' },
      { accountId: 'sales', credit: '100000' },
      { accountId: 'vat', credit: '11000' },
      { accountId: 'zero', credit: 0 },
    ]);
    expect(r.lines).toHaveLength(3);
    expect(r.total.toFixed(2)).toBe('111000.00');
  });

  it('menolak jurnal tidak seimbang', () => {
    expect(() =>
      normalizeJournalLines([
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 99.99 },
      ]),
    ).toThrow(JournalValidationError);
  });

  it('menolak baris debit dan kredit sekaligus', () => {
    expect(() =>
      normalizeJournalLines([
        { accountId: 'a', debit: 100, credit: 100 },
        { accountId: 'b', credit: 0 },
      ]),
    ).toThrow('hanya boleh debit atau kredit');
  });

  it('menolak nilai negatif', () => {
    expect(() =>
      normalizeJournalLines([
        { accountId: 'a', debit: -5 },
        { accountId: 'b', credit: -5 },
      ]),
    ).toThrow('negatif');
  });

  it('tidak terkena galat float (0.1 + 0.2)', () => {
    const r = normalizeJournalLines([
      { accountId: 'a', debit: 0.1 },
      { accountId: 'b', debit: 0.2 },
      { accountId: 'c', credit: 0.3 },
    ]);
    expect(r.total.toFixed(2)).toBe('0.30');
  });
});

describe('interBranchBalancingLines (jurnal lintas cabang)', () => {
  const norm = (rows: { accountId: string; debit?: number; credit?: number; branchId?: string | null }[]) => normalizeJournalLines(rows).lines;
  it('satu cabang atau semua pusat: tidak ada baris penyeimbang', () => {
    expect(interBranchBalancingLines(norm([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }]), null, 'RAK')).toEqual([]);
    expect(interBranchBalancingLines(norm([{ accountId: 'a', debit: 100, branchId: 'B1' }, { accountId: 'b', credit: 100, branchId: 'B1' }]), null, 'RAK')).toEqual([]);
  });
  it('pusat membayar biaya cabang: tiap cabang seimbang dan jumlah baris penyeimbang nol', () => {
    const lines = norm([{ accountId: 'biaya', debit: 500, branchId: 'B1' }, { accountId: 'kas', credit: 500, branchId: null }]);
    const extra = interBranchBalancingLines(lines, null, 'RAK');
    expect(extra).toHaveLength(2);
    const all = [...lines, ...extra];
    for (const b of ['B1', null]) {
      const d = all.filter((l) => (l.branchId ?? null) === b).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
      expect(d).toBe(0);
    }
    expect(all.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0)).toBe(0);
    expect(extra.every((l) => l.accountId === 'RAK' && l.memo === 'Antar cabang')).toBe(true);
  });
  it('cabang tak ditentukan (undefined) memakai cabang jurnal; masukan tidak diubah', () => {
    const lines = norm([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100, branchId: 'B2' }]);
    const before = JSON.stringify(lines);
    const extra = interBranchBalancingLines(lines, 'B1', 'RAK');
    expect(extra).toHaveLength(2);
    expect(JSON.stringify(lines)).toBe(before);
  });
});
