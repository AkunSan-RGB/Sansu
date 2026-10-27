import { budgetUsage, retainerOverage } from './service-limits';

describe('budgetUsage', () => {
  it('tanpa anggaran tidak dipantau', () => {
    expect(budgetUsage('500', '0')).toEqual({ status: 'NONE', usedPct: null, remaining: '0.00' });
  });
  it('OK di bawah 80%, WARN mulai 80%, OVER di atas 100%', () => {
    expect(budgetUsage('700', '1000').status).toBe('OK');
    expect(budgetUsage('800', '1000').status).toBe('WARN');
    expect(budgetUsage('1000', '1000').status).toBe('WARN');
    expect(budgetUsage('1001', '1000')).toMatchObject({ status: 'OVER', remaining: '-1.00' });
  });
});

describe('retainerOverage', () => {
  it('tidak ada tagihan tambahan bila jam dalam jatah', () => {
    expect(retainerOverage('9.5', '10', '300000')).toMatchObject({ over: '0.00', amount: expect.anything() });
    expect(retainerOverage('10', '10', '300000').amount.toFixed(2)).toBe('0.00');
  });
  it('hanya kelebihan yang ditagih', () => {
    const o = retainerOverage('13', '10', '300000');
    expect(o.over).toBe('3.00');
    expect(o.amount.toFixed(2)).toBe('900000.00');
  });
});
