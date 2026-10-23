import {
  concentrationInsight, costRiseInsight, deadStockInsight, expiryInsight, idr, lapsedCustomersInsight, marginInsight, overdueReceivableInsight, payableInsight,
  rankInsights, runwayInsight, salesTrendInsight, summarize, topProductsInsight, type DashboardInsight,
} from './insight-rules';

describe('insight beranda: format rupiah ringkas', () => {
  it('memakai miliar/juta/ribu dengan koma desimal', () => {
    expect(idr(1_250_000_000)).toBe('Rp1,3 miliar');
    expect(idr(24_000_000)).toBe('Rp24 juta');
    expect(idr(71_100_000)).toBe('Rp71,1 juta');
    expect(idr(366_000)).toBe('Rp366 ribu');
    expect(idr(850)).toBe('Rp850');
    expect(idr(-5_000_000)).toBe('−Rp5 juta');
  });
});

describe('insight beranda: kas dan daya tahan', () => {
  it('tingkat peringatan menurut bulan biaya yang dapat ditutup', () => {
    expect(runwayInsight({ cash: 0, monthlyCost: 10e6 })).toMatchObject({ tone: 'warning', score: 100 });
    expect(runwayInsight({ cash: 5e6, monthlyCost: 10e6 })).toMatchObject({ tone: 'warning', score: 95 });
    expect(runwayInsight({ cash: 20e6, monthlyCost: 10e6 })).toMatchObject({ tone: 'warning', score: 70 });
    expect(runwayInsight({ cash: 40e6, monthlyCost: 10e6 })).toMatchObject({ tone: 'info' });
    expect(runwayInsight({ cash: 90e6, monthlyCost: 10e6 })).toMatchObject({ tone: 'good' });
    expect(runwayInsight({ cash: 90e6, monthlyCost: 0 })).toBeNull();
  });
});

describe('insight beranda: tren penjualan', () => {
  const base = { daysElapsed: 15, daysInMonth: 30 };
  it('turun ≥ 15% = peringatan; naik ≥ 15% = kabar baik; ±10% diabaikan', () => {
    expect(salesTrendInsight({ ...base, mtd: 60e6, prevSame: 100e6 })).toMatchObject({ tone: 'warning' });
    expect(salesTrendInsight({ ...base, mtd: 130e6, prevSame: 100e6 })).toMatchObject({ tone: 'good' });
    expect(salesTrendInsight({ ...base, mtd: 105e6, prevSame: 100e6 })).toBeNull();
  });
  it('tidak berbicara bila terlalu awal, tanpa pembanding, atau usaha baru', () => {
    expect(salesTrendInsight({ ...base, daysElapsed: 3, mtd: 1, prevSame: 100 })).toBeNull();
    expect(salesTrendInsight({ ...base, mtd: 10e6, prevSame: 0 })).toBeNull();
    expect(salesTrendInsight({ ...base, mtd: 10e6, prevSame: 1e6, monthsWithSales: 1 })).toBeNull();
  });
  it('lonjakan besar dibaca kali lipat, bukan ribuan persen', () => {
    const r = salesTrendInsight({ ...base, mtd: 100e6, prevSame: 10e6 })!;
    expect(r.title).toContain('kali lipat');
    expect(r.title).not.toMatch(/\d{3,}%/);
  });
});

describe('insight beranda: margin, piutang, hutang, biaya', () => {
  it('margin turun ≥ 3 poin memberi peringatan beserta nilai laba yang tergerus', () => {
    const r = marginInsight({ gm: 0.2, avgPrev: 0.3, sales: 100e6 })!;
    expect(r.tone).toBe('warning');
    expect(r.impact?.amount).toBeCloseTo(10e6);
    expect(marginInsight({ gm: 0.29, avgPrev: 0.3, sales: 100e6 })).toBeNull();
    expect(marginInsight({ gm: 0.4, avgPrev: 0.3, sales: 100e6 })!.tone).toBe('good');
    expect(marginInsight({ gm: 0.4, avgPrev: 0.3, sales: 0 })).toBeNull();
  });
  it('piutang lewat jatuh tempo: peringatan bila ≥ 20% dari total, menyebut pelanggan terbesar', () => {
    const r = overdueReceivableInsight({ ar: 100e6, overdue: 30e6, overdueCount: 3, top: [{ name: 'PT A', amount: 20e6 }, { name: 'PT B', amount: 10e6 }], dso: 41.2 })!;
    expect(r.tone).toBe('warning');
    expect(r.evidence).toContain('PT A');
    expect(overdueReceivableInsight({ ar: 100e6, overdue: 5e6, overdueCount: 1, top: [], dso: null })!.tone).toBe('info');
    expect(overdueReceivableInsight({ ar: 100e6, overdue: 0, overdueCount: 0, top: [], dso: null })).toBeNull();
  });
  it('hutang: melebihi kas lebih mendesak daripada sekadar terlambat; bahasa menyesuaikan', () => {
    const a = payableInsight({ overdue: 80e6, due14: 80e6, cash: 50e6 })!;
    expect(a.id).toBe('hutang-kas');
    expect(a.evidence).toContain('seluruhnya sudah lewat');
    expect(payableInsight({ overdue: 5e6, due14: 8e6, cash: 500e6 })!.id).toBe('hutang-lewat');
    expect(payableInsight({ overdue: 0, due14: 8e6, cash: 500e6 })).toBeNull();
  });
  it('beban naik ≥ 20% dan ≥ Rp1 juta; menyebut pos terbesar', () => {
    const r = costRiseInsight({ last: 30e6, avgPrev: 20e6, top: { name: 'Beban Listrik', delta: 6e6 } })!;
    expect(r.evidence).toContain('Beban Listrik');
    expect(costRiseInsight({ last: 21e6, avgPrev: 20e6 })).toBeNull();
    expect(costRiseInsight({ last: 1.5e6, avgPrev: 1e6 })).toBeNull();
  });
});

describe('insight beranda: persediaan, pelanggan, produk', () => {
  it('stok mati: butuh ≥ Rp1 juta dan ≥ 5% nilai stok; ≥ 15% = peringatan', () => {
    expect(deadStockInsight({ dead: 20e6, total: 100e6, n: 4, top: [{ name: 'X', value: 20e6 }] })!.tone).toBe('warning');
    expect(deadStockInsight({ dead: 8e6, total: 100e6, n: 2, top: [] })!.tone).toBe('info');
    expect(deadStockInsight({ dead: 3e6, total: 100e6, n: 1, top: [] })).toBeNull();
    expect(deadStockInsight({ dead: 500_000, total: 1e6, n: 1, top: [] })).toBeNull();
  });
  it('kedaluwarsa: yang sudah lewat lebih mendesak dari yang akan datang', () => {
    expect(expiryInsight({ expiredValue: 2e6, expiredN: 1, soonValue: 1e6, soonN: 1, top: ['Susu'] })!.score).toBeGreaterThan(expiryInsight({ expiredValue: 0, expiredN: 0, soonValue: 1e6, soonN: 1, top: [] })!.score);
    expect(expiryInsight({ expiredValue: 0, expiredN: 0, soonValue: 0, soonN: 0, top: [] })).toBeNull();
  });
  it('konsentrasi pelanggan mulai 35%; pelanggan lama berpotensi kembali', () => {
    expect(concentrationInsight({ name: 'PT A', share: 0.46, amount: 46e6, total: 100e6 })!.tone).toBe('warning');
    expect(concentrationInsight({ name: 'PT A', share: 0.2, amount: 20e6, total: 100e6 })).toBeNull();
    expect(lapsedCustomersInsight({ customers: [{ name: 'Toko B', past: 4e6 }, { name: 'Toko C', past: 2e6 }] })!.tone).toBe('opportunity');
    expect(lapsedCustomersInsight({ customers: [{ name: 'Toko B', past: 200_000 }] })).toBeNull();
  });
  it('produk andalan diam bila produknya terlalu sedikit', () => {
    const top = [{ name: 'A', gp: 5 }, { name: 'B', gp: 4 }, { name: 'C', gp: 3 }];
    expect(topProductsInsight({ top, totalGp: 20, productCount: 4 })).toBeNull();
    expect(topProductsInsight({ top, totalGp: 20, productCount: 12 })!.title).toContain('60%');
  });
});

describe('insight beranda: urutan dan ringkasan', () => {
  const mk = (id: string, tone: DashboardInsight['tone'], score: number): DashboardInsight => ({ id, category: 'KAS', tone, title: id, evidence: 'e', recommendation: 'r', score });
  it('diurutkan menurut prioritas; kabar baik selalu ikut tampil walau skornya rendah', () => {
    const items = [...Array.from({ length: 12 }, (_, i) => mk(`w${i}`, 'warning', 90 - i)), mk('baik', 'good', 5)];
    const r = rankInsights(items, 10);
    expect(r).toHaveLength(10);
    expect(r.map((x) => x.id)).toContain('baik');
    expect(r[0].id).toBe('w0');
  });
  it('ringkasan menghitung jenis temuan', () => {
    const s = summarize([mk('a', 'warning', 1), mk('b', 'opportunity', 1), mk('c', 'good', 1)]);
    expect(s).toMatchObject({ warnings: 1, opportunities: 1, good: 1, headline: '1 hal layak diperhatikan bulan ini' });
    expect(summarize([mk('c', 'good', 1)]).headline).toContain('sehat');
    expect(summarize([]).headline).toContain('Belum cukup data');
  });
});
