import { ADJUSTMENT_ADMIN_THRESHOLD, METER_CALIBRATION_YEARS, WATER_QUALITY_LIMITS, addYears, buildInstallments, complaintDueAt, estimateUsage, evaluateWaterQuality, installmentProgress, nonRevenueWater, spLevelFor, splitReduction, trueUpUsage, whatsappLink } from '@sansu/shared';

describe('hitungan layanan air lanjutan', () => {
  it('jadwal angsuran: dibagi rata, selisih pembulatan di angsuran terakhir, jumlahnya persis total', () => {
    const rows = buildInstallments(100000.01, 3, '2026-11-01', 30);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-11-01', '2026-12-01', '2026-12-31']);
    expect(Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100).toBe(100000.01);
    expect(rows[0].amount).toBe(33333.33);
    expect(rows[2].amount).toBe(33333.35);
  });

  it('progres angsuran: pembayaran menutup cicilan berurutan dari yang pertama; telat dibedakan dari belum jatuh tempo', () => {
    const items = buildInstallments(90000, 3, '2026-10-01', 30);
    const p = installmentProgress(items, 40000, '2026-11-15');
    expect(p.map((x) => x.status)).toEqual(['LUNAS', 'TERLAMBAT', 'BELUM']);
    expect(p[1].paid).toBe(10000);
    expect(installmentProgress(items, 0, '2026-09-01').map((x) => x.status)).toEqual(['BELUM', 'BELUM', 'BELUM']);
    expect(installmentProgress(items, 90000, '2027-01-01').every((x) => x.status === 'LUNAS')).toBe(true);
  });

  it('pecah pengurangan: PPN diambil menurut perbandingan faktur, jumlah tetap utuh', () => {
    const s = splitReduction(111000, 100000, 11000);
    expect(s).toEqual({ dpp: 100000, tax: 11000 });
    expect(splitReduction(5000, 100000, 0)).toEqual({ dpp: 5000, tax: 0 });
    const odd = splitReduction(33333.33, 90000, 9900);
    expect(Math.round((odd.dpp + odd.tax) * 100) / 100).toBe(33333.33);
    expect(ADJUSTMENT_ADMIN_THRESHOLD).toBe(500000);
  });

  it('taksiran: rata-rata maksimal 3 periode nyata; tanpa riwayat tidak ditaksir; koreksi tidak pernah negatif', () => {
    expect(estimateUsage([10, 20, 30, 999])).toBe(20);
    expect(estimateUsage([])).toBeNull();
    expect(estimateUsage([Number.NaN, -3])).toBeNull();
    expect(trueUpUsage(150, 100, 40)).toEqual({ usage: 10, overEstimate: 0 });
    expect(trueUpUsage(130, 100, 40)).toEqual({ usage: 0, overEstimate: 10 });
  });

  it('SLA pengaduan: prioritas tinggi separuh waktu (min. 4 jam), rendah dua kali', () => {
    const t0 = new Date('2026-10-26T00:00:00Z');
    const hours = (d: Date) => (d.getTime() - t0.getTime()) / 3_600_000;
    expect(hours(complaintDueAt('PIPA_BOCOR', 'NORMAL', t0))).toBe(12);
    expect(hours(complaintDueAt('PIPA_BOCOR', 'TINGGI', t0))).toBe(6);
    expect(hours(complaintDueAt('PIPA_BOCOR', 'RENDAH', t0))).toBe(24);
  });

  it('surat peringatan bertingkat menurut keterlambatan', () => {
    expect([0, 6, 7, 20, 21, 34, 35, 90].map(spLevelFor)).toEqual([null, null, 'SP1', 'SP1', 'SP2', 'SP2', 'SP3', 'SP3']);
  });

  it('tautan WhatsApp: nomor dinormalkan ke format internasional; nomor tak layak tidak dibuatkan tautan', () => {
    expect(whatsappLink('0812-3456-7890', 'Halo & salam')).toBe('https://wa.me/6281234567890?text=Halo%20%26%20salam');
    expect(whatsappLink('+62 812 3456 7890', 'a')).toContain('wa.me/6281234567890');
    expect(whatsappLink('81234567890', 'a')).toContain('wa.me/6281234567890');
    expect(whatsappLink('123', 'a')).toBeNull();
    expect(whatsappLink(null, 'a')).toBeNull();
  });

  it('baku mutu air: batas tepat masih memenuhi, di luar batas ditandai; parameter kosong diabaikan', () => {
    expect(evaluateWaterQuality({ ph: 7, turbidity: 5, chlorine: 0.2, coliform: 0, tds: 500 })).toEqual({ ok: true, failed: [] });
    expect(evaluateWaterQuality({ ph: 6.4, turbidity: 5.1, chlorine: 1.1, coliform: 1, tds: 501 }).failed.sort()).toEqual(['chlorine', 'coliform', 'ph', 'tds', 'turbidity']);
    expect(evaluateWaterQuality({ ph: 8.5 })).toEqual({ ok: true, failed: [] });
    expect(evaluateWaterQuality({}).ok).toBe(true);
    expect(WATER_QUALITY_LIMITS.ph.max).toBe(8.5);
  });

  it('air tak berekening: selisih dan persen; tanpa distribusi tidak ada persen', () => {
    expect(nonRevenueWater(1000, 720)).toEqual({ volume: 280, pct: 28 });
    expect(nonRevenueWater(0, 0)).toEqual({ volume: 0, pct: null });
    expect(nonRevenueWater(100, 130).pct).toBe(-30);
  });

  it('tera meter: lima tahun, tahun kabisat tidak menggeser tanggal', () => {
    expect(METER_CALIBRATION_YEARS).toBe(5);
    expect(addYears('2026-10-26', METER_CALIBRATION_YEARS)).toBe('2031-10-26');
    expect(addYears('2024-02-29', 1)).toBe('2025-03-01');
  });
});
