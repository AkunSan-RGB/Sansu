import { D } from './money';
import { foreignTotals, settleForeign, toIdr } from './fx';

describe('fx', () => {
  it('toIdr membulatkan 2 desimal', () => {
    expect(toIdr('10.005', '3').toFixed(2)).toBe('30.02'); // 30,015 dibulatkan ke atas
    expect(toIdr('100', '16250').toFixed(2)).toBe('1625000.00');
  });

  it('dokumen valas: PPN dari DPP rupiah, PPN valas = PPN rupiah ÷ kurs', () => {
    const t = foreignTotals([D('1000')], '16000', '11');
    expect(t.subtotalIdr.toFixed(2)).toBe('16000000.00');
    expect(t.taxIdr.toFixed(2)).toBe('1760000.00');
    expect(t.totalIdr.toFixed(2)).toBe('17760000.00');
    expect(t.taxForeign.toFixed(2)).toBe('110.00');
    expect(t.totalForeign.toFixed(2)).toBe('1110.00');
  });

  it('jumlah baris rupiah = DPP rupiah (tidak ada selisih pembulatan antar baris)', () => {
    const t = foreignTotals([D('0.33'), D('0.33'), D('0.34')], '16123.45', '11', 'NEAREST');
    expect(t.lineIdr.reduce((a, x) => a.plus(x), D(0)).toFixed(2)).toBe(t.subtotalIdr.toFixed(2));
    expect(t.taxIdr.toFixed(2)).toBe(t.taxIdr.toDecimalPlaces(0).toFixed(2));
  });

  it('pelunasan sebagian memakai kurs faktur, pelunasan akhir menutup seluruh sisa rupiah', () => {
    const part = settleForeign({ amountForeign: D('100'), outstandingForeign: D('1110'), outstandingIdr: D('17760000'), invoiceRate: '16000', payRate: '16200' });
    expect(part).toMatchObject({ final: false });
    expect(part.carrying.toFixed(2)).toBe('1600000.00');
    expect(part.cash.toFixed(2)).toBe('1620000.00');
    expect(part.diff.toFixed(2)).toBe('20000.00');
    const last = settleForeign({ amountForeign: D('510'), outstandingForeign: D('510'), outstandingIdr: D('8160001.37'), invoiceRate: '16000', payRate: '16300' });
    expect(last.final).toBe(true);
    expect(last.carrying.toFixed(2)).toBe('8160001.37');
    expect(last.diff.toFixed(2)).toBe(D('510').times('16300').minus('8160001.37').toFixed(2));
  });
});
