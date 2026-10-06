import { activityFor, BUSINESS_MODEL_KEYS, DEFAULT_ACTIVITIES, REPORT_TERMS } from '@sansu/shared';

describe('istilah laporan per jenis usaha', () => {
  it('setiap model punya semua istilah terisi', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      for (const [k, v] of Object.entries(REPORT_TERMS[m])) expect([m, k, typeof v === 'string' && v.trim().length > 0]).toEqual([m, k, true]);
    }
  });

  it('istilah dagang tetap sama seperti sebelum fitur ini (laporan lama tidak berubah)', () => {
    const t = REPORT_TERMS.DAGANG;
    expect(t.revenueLabel).toBe('Pendapatan usaha');
    expect(t.cogsLabel).toBe('Beban pokok penjualan');
    expect(t.activity).toBe('perdagangan besar (distribusi) barang konsumsi');
    expect(t.revenueNote).toBe('Seluruh pendapatan berasal dari penjualan barang dagang di dalam negeri.');
    expect(t.payableNote).toBe('Utang usaha merupakan utang kepada pemasok barang dagang, tanpa jaminan dan tanpa bunga, dengan jangka waktu kredit 14–60 hari.');
  });

  it('jasa & produksi memakai istilah sendiri, bukan "barang dagang"', () => {
    expect(REPORT_TERMS.JASA.cogsLabel).toBe('Beban pokok pendapatan');
    expect(REPORT_TERMS.JASA.revenueLabel).toBe('Pendapatan jasa');
    expect(REPORT_TERMS.PRODUKSI.cogsLabel).toBe('Beban pokok produksi dan penjualan');
    for (const m of ['JASA', 'PRODUKSI'] as const) {
      const t = REPORT_TERMS[m];
      expect(`${t.revenueNote} ${t.receivableNote} ${t.cogsNote}`).not.toMatch(/barang dagang/);
    }
  });

  it('kegiatan usaha: teks pengguna dipakai apa adanya, teks bawaan mengikuti model sekarang', () => {
    expect(activityFor('JASA', 'jasa konsultasi manajemen')).toBe('jasa konsultasi manajemen');
    expect(activityFor('JASA', '')).toBe(REPORT_TERMS.JASA.activity);
    expect(activityFor('JASA', null)).toBe(REPORT_TERMS.JASA.activity);
    // teks bawaan model lain (mis. bawaan lama "perdagangan besar") ikut model yang berlaku sekarang
    for (const d of DEFAULT_ACTIVITIES) expect(activityFor('PRODUKSI', d)).toBe(REPORT_TERMS.PRODUKSI.activity);
    expect(DEFAULT_ACTIVITIES).toHaveLength(new Set(DEFAULT_ACTIVITIES).size);
  });
});
