import { buildContractSchedule, contractYear, type ContractTerms } from './contract-calc';

const loan = (over: Partial<ContractTerms> = {}): ContractTerms => ({ kind: 'LOAN', amount: '12000000', ratePct: '12', startDate: '2026-01-15', termMonths: 12, method: 'ANNUITY', ...over });

describe('jadwal kontrak', () => {
  it('anuitas: cicilan tetap, saldo akhir tepat nol, bunga menurun', () => {
    const rows = buildContractSchedule(loan());
    expect(rows).toHaveLength(12);
    expect(rows[0].period).toBe('2026-01');
    expect(rows[0].additions.toFixed(2)).toBe('12000000.00');
    expect(rows[0].interest.toFixed(2)).toBe('120000.00'); // 12.000.000 × 1%
    expect(rows[0].payment.toFixed(2)).toBe('1066185.46');
    expect(rows[11].closing.toFixed(2)).toBe('0.00');
    expect(rows[5].interest.lt(rows[0].interest)).toBe(true);
    const totalPrincipal = rows.reduce((s, r) => s.plus(r.principal), rows[0].additions.minus(rows[0].additions));
    expect(totalPrincipal.toFixed(2)).toBe('12000000.00');
  });

  it('pokok tetap: pokok sama tiap bulan, bunga dari saldo', () => {
    const rows = buildContractSchedule(loan({ method: 'STRAIGHT_PRINCIPAL' }));
    expect(rows[0].principal.toFixed(2)).toBe('1000000.00');
    expect(rows[1].interest.toFixed(2)).toBe('110000.00'); // saldo 11.000.000 × 1%
    expect(rows[11].closing.toFixed(2)).toBe('0.00');
  });

  it('bullet: bunga tiap bulan, pokok dilunasi di bulan terakhir', () => {
    const rows = buildContractSchedule(loan({ method: 'BULLET' }));
    expect(rows[0].principal.toFixed(2)).toBe('0.00');
    expect(rows[0].interest.toFixed(2)).toBe('120000.00');
    expect(rows[10].closing.toFixed(2)).toBe('12000000.00');
    expect(rows[11].principal.toFixed(2)).toBe('12000000.00');
    expect(rows[11].closing.toFixed(2)).toBe('0.00');
  });

  it('bunga nol: anuitas menjadi cicilan pokok rata', () => {
    const rows = buildContractSchedule(loan({ ratePct: '0', termMonths: 6, amount: '600000' }));
    expect(rows.map((r) => r.principal.toFixed(2))).toEqual(Array(6).fill('100000.00'));
  });

  it('dibayar di muka: amortisasi garis lurus, selisih pembulatan di bulan terakhir', () => {
    const rows = buildContractSchedule({ kind: 'PREPAID', amount: '1000000', ratePct: null, startDate: '2026-03-01', termMonths: 3, method: 'STRAIGHT_LINE' });
    expect(rows.map((r) => r.principal.toFixed(2))).toEqual(['333333.33', '333333.33', '333333.34']);
    expect(rows[2].closing.toFixed(2)).toBe('0.00');
    expect(rows.every((r) => r.interest.isZero() && r.payment.isZero())).toBe(true);
  });

  it('ringkasan tahun: saldo awal dari tahun lalu, penambahan hanya di tahun mulai, bulan di luar masa kontrak kosong', () => {
    const rows = buildContractSchedule(loan({ startDate: '2025-10-01', termMonths: 12 })); // Okt 2025 – Sep 2026
    const y25 = contractYear(rows, 2025);
    expect(y25.opening.toFixed(2)).toBe('0.00');
    expect(y25.additions.toFixed(2)).toBe('12000000.00');
    expect(y25.months.filter(Boolean)).toHaveLength(3);
    const y26 = contractYear(rows, 2026);
    expect(y26.opening.toFixed(2)).toBe(y25.closing.toFixed(2));
    expect(y26.additions.toFixed(2)).toBe('0.00');
    expect(y26.closing.toFixed(2)).toBe('0.00');
    expect(y26.months.filter(Boolean)).toHaveLength(9);
    expect(y25.principal.plus(y26.principal).toFixed(2)).toBe('12000000.00');
  });
});
