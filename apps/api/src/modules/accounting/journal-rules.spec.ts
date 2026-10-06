import { JournalValidationError, normalizeJournalLines } from './journal-rules';

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
