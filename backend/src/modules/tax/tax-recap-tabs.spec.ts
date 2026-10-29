import { BUSINESS_MODEL_KEYS, SERVICE_PROFILE_KEYS, taxRecapTabs, withheldParty, type BusinessModel, type TaxRecapTabCtx } from '@sansu/shared';

const base = (model: BusinessModel, extra: Partial<TaxRecapTabCtx> = {}): TaxRecapTabCtx => ({
  model,
  taxFeatures: { vat: true, withheldByCustomers: model === 'JASA' || model === 'MANUFAKTUR' },
  canPayroll: true,
  canSales: true,
  ...extra,
});
const keys = (c: TaxRecapTabCtx) => taxRecapTabs(c).map((t) => t.key);

describe('Rekap pajak: tab per jenis usaha', () => {
  it('Ringkasan tahunan selalu pertama dan "Kita potong" selalu ada, untuk semua jenis usaha', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      const k = keys(base(m));
      expect(k[0]).toBe('annual');
      expect(k).toContain('withholding');
      expect(new Set(k).size).toBe(k.length); // tidak ada tab kembar
    }
  });

  it('PPN hanya untuk PKP', () => {
    expect(keys(base('DAGANG', { taxFeatures: { vat: true } }))).toContain('vat');
    expect(keys(base('DAGANG', { taxFeatures: { vat: false } }))).not.toContain('vat');
  });

  it('PPh 21 dan BPJS hanya untuk yang boleh membuka Penggajian', () => {
    expect(keys(base('RITEL'))).toEqual(expect.arrayContaining(['pph21', 'bpjs']));
    const k = keys(base('RITEL', { canPayroll: false }));
    expect(k).not.toContain('pph21');
    expect(k).not.toContain('bpjs');
  });

  it('PPh dipotong pihak lain: lazim di Jasa dan Manufaktur, selebihnya hanya bila sudah ada datanya', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      const lazim = m === 'JASA' || m === 'MANUFAKTUR';
      expect(keys(base(m))).toEqual(lazim ? expect.arrayContaining(['withheld']) : expect.not.arrayContaining(['withheld']));
      expect(keys(base(m, { taxFeatures: { vat: true, withheldByCustomers: true } }))).toContain('withheld');
    }
    expect(keys(base('JASA', { canSales: false }))).not.toContain('withheld'); // daftar potongan memakai aplikasi Penjualan
  });

  it('urutan tetap: ringkasan, PPN, PPh 21, BPJS, kita potong, dipotong pihak lain', () => {
    expect(keys(base('JASA'))).toEqual(['annual', 'vat', 'pph21', 'bpjs', 'withholding', 'withheld']);
  });

  it('sebutan pihak yang memotong mengikuti jenis usaha dan profil layanan', () => {
    expect(withheldParty('DAGANG')).toBe('pelanggan');
    expect(withheldParty('MANUFAKTUR')).toBe('pemesan');
    expect(withheldParty('FNB')).toBe('pemesan katering');
    expect(withheldParty('JASA')).toBe('klien');
    expect(withheldParty('JASA', ['KONTRAKTOR'])).toBe('pemberi kerja');
    expect(withheldParty('JASA', ['ALIH_DAYA'])).toBe('pengguna jasa');
    expect(withheldParty('JASA', ['KONSULTAN', 'KONTRAKTOR'])).toBe('klien'); // beberapa profil: sebutan umum
    expect(withheldParty('DAGANG', ['KONTRAKTOR'])).toBe('pelanggan'); // profil hanya berlaku untuk Jasa
    const parties = SERVICE_PROFILE_KEYS.map((p) => withheldParty('JASA', [p]));
    expect(parties.every(Boolean)).toBe(true);
    const tab = taxRecapTabs(base('JASA', { serviceProfiles: ['KONTRAKTOR'] })).find((t) => t.key === 'withheld')!;
    expect(tab.label).toBe('Dipotong pemberi kerja');
    expect(tab.hint).toContain('PPh final');
  });

  it('nama dua tab "dipotong" tidak membingungkan: satu "Kita potong", satu "Dipotong <pihak>"', () => {
    const t = taxRecapTabs(base('JASA'));
    expect(t.find((x) => x.key === 'withholding')!.label).toMatch(/^Kita potong/);
    expect(t.find((x) => x.key === 'withheld')!.label).toMatch(/^Dipotong /);
  });
});
