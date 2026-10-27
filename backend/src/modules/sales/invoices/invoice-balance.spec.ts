import { InvoiceBalance } from './invoice-balance';

const inv = (total: string, paid = '0', returned = '0') => InvoiceBalance.of({ total, paidAmount: paid, returnedAmount: returned });

describe('InvoiceBalance', () => {
  it('sisa tagihan = total - dibayar - retur', () => {
    expect(inv('1110000', '500000', '110000').outstanding.toFixed(2)).toBe('500000.00');
  });
  it('pembayaran sebagian lalu pelunasan mengubah status PARTIAL → PAID', () => {
    const a = inv('1000');
    expect(a.status).toBe('PARTIAL');
    const b = a.apply(400);
    expect(b.status).toBe('PARTIAL');
    expect(b.outstanding.toFixed(2)).toBe('600.00');
    expect(b.apply(600).status).toBe('PAID');
    expect(b.apply(600).outstanding.isZero()).toBe(true);
  });
  it('retur ikut menutup tagihan', () => {
    expect(inv('1000', '700', '300').isSettled).toBe(true);
    expect(inv('1000', '700', '299.99').isSettled).toBe(false);
  });
  it('canApply: harus positif dan tidak melebihi sisa; objek tidak berubah oleh apply', () => {
    const a = inv('1000', '250');
    expect(a.canApply(750)).toBe(true);
    expect(a.canApply('750.01')).toBe(false);
    expect(a.canApply(0)).toBe(false);
    expect(a.canApply(-5)).toBe(false);
    a.apply(500);
    expect(a.paid.toFixed(2)).toBe('250.00');
  });
  it('tidak ada galat pembulatan pada angka desimal', () => {
    expect(inv('0.3', '0.1').apply('0.2').status).toBe('PAID');
  });
});
