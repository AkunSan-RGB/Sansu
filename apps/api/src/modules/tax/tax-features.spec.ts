import { taxFeatures } from '@sansu/shared';

const base = { pkp: true, taxScheme: 'GENERAL' as const };

describe('fitur pajak menurut jenis usaha, status PKP, dan skema PPh', () => {
  it('PKP umum: PPN, Coretax, dan rekonsiliasi fiskal tampil', () => {
    const f = taxFeatures({ model: 'DAGANG', ...base });
    expect(f.vat && f.coretax && f.fiscalReconciliation).toBe(true);
  });
  it('non-PKP: PPN dan Coretax disembunyikan di semua jenis usaha', () => {
    for (const model of ['DAGANG', 'RITEL', 'JASA', 'PRODUKSI'] as const) {
      const f = taxFeatures({ model, pkp: false, taxScheme: 'GENERAL' });
      expect(f.vat).toBe(false);
      expect(f.coretax).toBe(false);
      expect(f.reasons.join(' ')).toMatch(/Belum PKP/);
    }
  });
  it('PPh final UMKM: tanpa rekonsiliasi fiskal', () => {
    expect(taxFeatures({ model: 'JASA', pkp: true, taxScheme: 'FINAL_UMKM' }).fiscalReconciliation).toBe(false);
  });
  it('PPh dipotong pelanggan: jasa dan produksi; dagang dan ritel hanya bila sudah ada datanya', () => {
    expect(taxFeatures({ model: 'JASA', ...base }).withheldByCustomers).toBe(true);
    expect(taxFeatures({ model: 'PRODUKSI', ...base }).withheldByCustomers).toBe(true);
    expect(taxFeatures({ model: 'DAGANG', ...base }).withheldByCustomers).toBe(false);
    expect(taxFeatures({ model: 'RITEL', ...base }).withheldByCustomers).toBe(false);
    expect(taxFeatures({ model: 'DAGANG', ...base, hasData: { withheldByCustomers: true } }).withheldByCustomers).toBe(true);
  });
  it('alasan hanya muncul untuk fitur yang disembunyikan', () => {
    expect(taxFeatures({ model: 'JASA', ...base }).reasons).toEqual([]);
    expect(taxFeatures({ model: 'RITEL', pkp: false, taxScheme: 'FINAL_UMKM' }).reasons).toHaveLength(3);
  });
});
