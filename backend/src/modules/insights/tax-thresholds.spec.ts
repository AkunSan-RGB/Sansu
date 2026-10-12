import { crossingMonth, evaluateThresholds, projectYear, type ThresholdInput, worstLevel } from '@sansu/shared';

const B = 1_000_000_000;
const base: ThresholdInput = { asOf: '2026-12-31', revenueYtd: 0, pkp: false, taxScheme: 'GENERAL', framework: 'SAK_EP', legalForm: 'UD', size: 'MICRO' };
const run = (o: Partial<ThresholdInput>) => evaluateThresholds({ ...base, ...o });
const find = (a: ReturnType<typeof run>, key: string) => a.find((x) => x.key === key);

describe('proyeksi & perkiraan bulan batas terlewati', () => {
  it('proyeksi baru dipercaya setelah 25% tahun berjalan', () => {
    expect(projectYear(1 * B, '2026-02-15')).toBeNull(); // hari ke-46 ≈ 12,6%
    expect(projectYear(1 * B, '2026-03-31')).toBeNull(); // hari ke-90 ≈ 24,7%
    expect(projectYear(1 * B, '2026-04-02')).not.toBeNull();
    expect(projectYear(0, '2026-12-31')).toBeNull();
    expect(projectYear(5 * B, '2026-12-31')).toBeCloseTo(5 * B, 0);
  });

  it('proyeksi setahun penuh = laju harian × 365 (tahun kabisat 366)', () => {
    expect(projectYear(2 * B, '2026-07-02')!).toBeCloseTo(2 * B * (365 / 183), -3);
    expect(projectYear(2 * B, '2028-07-01')!).toBeCloseTo(2 * B * (366 / 183), -3);
  });

  it('bulan terlewati dihitung dari laju; null bila lewat tahun ini atau sudah terlewati', () => {
    // 2,4 M di akhir Juni (hari 181) → 4,8 M tepat pada hari ke-362 → Desember
    expect(crossingMonth(2.4 * B, '2026-06-30', 4.8 * B)).toBe('2026-12');
    // laju lebih tinggi: 3,6 M di akhir Juni → hari ke-241 → Agustus
    expect(crossingMonth(3.6 * B, '2026-06-30', 4.8 * B)).toBe('2026-08');
    expect(crossingMonth(1 * B, '2026-06-30', 4.8 * B)).toBeNull(); // baru lewat tahun depan
    expect(crossingMonth(4.8 * B, '2026-06-30', 4.8 * B)).toBeNull(); // sudah di batas
    expect(crossingMonth(5 * B, '2026-06-30', 4.8 * B)).toBeNull();
    expect(crossingMonth(0, '2026-06-30', 4.8 * B)).toBeNull();
  });
});

describe('batas wajib PKP (Rp4,8 miliar)', () => {
  it('tidak berlaku bila sudah PKP', () => {
    expect(find(run({ pkp: true, revenueYtd: 9 * B }), 'pkp')).toBeUndefined();
  });
  it('tepat di batas belum melewati; satu rupiah lebih → ERROR', () => {
    expect(find(run({ revenueYtd: 4.8 * B }), 'pkp')!.level).toBe('WARN');
    const over = find(run({ revenueYtd: 4.8 * B + 1 }), 'pkp')!;
    expect(over.level).toBe('ERROR');
    expect(over.message).toMatch(/paling lambat akhir bulan berikutnya/);
  });
  it('mulai 80% → WARN, di bawah itu aman (akhir tahun, tanpa proyeksi berisik)', () => {
    expect(find(run({ revenueYtd: 3.84 * B }), 'pkp')!.level).toBe('WARN'); // tepat 80%
    expect(find(run({ revenueYtd: 3.839 * B }), 'pkp')!.level).toBe('OK');
    expect(find(run({ revenueYtd: 0 }), 'pkp')!.level).toBe('OK');
  });
  it('proyeksi melewati batas memberi peringatan dini walau baru 50%', () => {
    const a = find(run({ asOf: '2026-06-30', revenueYtd: 2.5 * B }), 'pkp')!;
    expect(a.level).toBe('WARN');
    expect(a.crossingMonth).toBe('2026-12');
    expect(a.message).toMatch(/sekitar Desember 2026/);
    // laju aman → tidak ada peringatan
    expect(find(run({ asOf: '2026-06-30', revenueYtd: 1 * B }), 'pkp')!.level).toBe('OK');
  });
  it('awal tahun tidak berisik: proyeksi belum dipakai sebelum 25% tahun', () => {
    expect(find(run({ asOf: '2026-02-15', revenueYtd: 1 * B }), 'pkp')!.level).toBe('OK');
  });
});

describe('batas PPh final UMKM', () => {
  const final = (o: Partial<ThresholdInput>) => run({ taxScheme: 'FINAL_UMKM', pkp: true, ...o });
  it('hanya muncul pada skema PPh final', () => {
    expect(find(run({ taxScheme: 'GENERAL', revenueYtd: 9 * B }), 'final-tax')).toBeUndefined();
    expect(find(final({ revenueYtd: 1 * B }), 'final-tax')!.level).toBe('OK');
  });
  it('lewat batas → ERROR dan menyebut tahun berikutnya', () => {
    const a = find(final({ revenueYtd: 4.8 * B + 1 }), 'final-tax')!;
    expect(a.level).toBe('ERROR');
    expect(a.message).toMatch(/tahun pajak berikutnya/);
    expect(find(final({ revenueYtd: 4.8 * B }), 'final-tax')!.level).toBe('WARN');
  });
  it('PT/CV/Firma pada skema final mendapat peringatan hak; bentuk lain tidak', () => {
    for (const legalForm of ['PT', 'CV', 'FIRMA'] as const) expect(find(final({ legalForm }), 'final-tax-eligibility')!.level).toBe('WARN');
    for (const legalForm of ['UD', 'PERORANGAN', 'KOPERASI', 'PT_PERORANGAN'] as const) expect(find(final({ legalForm }), 'final-tax-eligibility')).toBeUndefined();
    expect(find(run({ taxScheme: 'GENERAL', legalForm: 'PT' }), 'final-tax-eligibility')).toBeUndefined();
  });
});

describe('fasilitas Pasal 31E (Rp50 miliar)', () => {
  it('di bawah Rp4,8 miliar: seluruh PKP tarif 11%', () => {
    const a = find(run({ pkp: true, revenueYtd: 2 * B }), 'facility-31e')!;
    expect(a.level).toBe('OK');
    expect(a.message).toMatch(/Seluruh penghasilan kena pajak mendapat tarif 11%/);
  });
  it('antara Rp4,8 dan Rp50 miliar: berlaku sebagian', () => {
    const a = find(run({ pkp: true, revenueYtd: 10 * B }), 'facility-31e')!;
    expect(a.level).toBe('OK');
    expect(a.message).toMatch(/berlaku sebagian/);
  });
  it('mendekati dan melewati Rp50 miliar', () => {
    expect(find(run({ pkp: true, revenueYtd: 40 * B }), 'facility-31e')!.level).toBe('WARN');
    expect(find(run({ pkp: true, revenueYtd: 50 * B }), 'facility-31e')!.level).toBe('WARN');
    const over = find(run({ pkp: true, revenueYtd: 50 * B + 1 }), 'facility-31e')!;
    expect(over.level).toBe('INFO'); // informasi, bukan pelanggaran
    expect(over.message).toMatch(/tarif 22%/);
  });
  it('tidak muncul pada skema PPh final', () => {
    expect(find(run({ taxScheme: 'FINAL_UMKM', revenueYtd: 60 * B }), 'facility-31e')).toBeUndefined();
  });
});

describe('kriteria UMKM untuk SAK EMKM', () => {
  it('usaha besar di SAK EMKM → WARN; selain itu OK; SAK EP tidak dicek', () => {
    expect(find(run({ framework: 'SAK_EMKM', size: 'LARGE' }), 'umkm-size')!.level).toBe('WARN');
    for (const size of ['MICRO', 'SMALL', 'MEDIUM'] as const) expect(find(run({ framework: 'SAK_EMKM', size }), 'umkm-size')!.level).toBe('OK');
    expect(find(run({ framework: 'SAK_EP', size: 'LARGE' }), 'umkm-size')).toBeUndefined();
  });
});

describe('keseluruhan', () => {
  it('worstLevel mengambil yang terparah', () => {
    expect(worstLevel([])).toBe('OK');
    expect(worstLevel([{ level: 'OK' }, { level: 'INFO' }])).toBe('INFO');
    expect(worstLevel([{ level: 'WARN' }, { level: 'ERROR' }, { level: 'OK' }])).toBe('ERROR');
  });
  it('semua kombinasi menghasilkan peringatan lengkap tanpa error, angka persen tidak negatif', () => {
    for (const taxScheme of ['GENERAL', 'FINAL_UMKM'] as const)
      for (const framework of ['SAK_EP', 'SAK_EMKM'] as const)
        for (const pkp of [true, false])
          for (const legalForm of ['PT', 'UD', 'CV'] as const)
            for (const revenueYtd of [0, 1, 3.84 * B, 4.8 * B, 4.8 * B + 1, 40 * B, 50 * B + 1, 500 * B])
              for (const asOf of ['2026-01-10', '2026-04-02', '2026-12-31', '2028-02-29']) {
                const a = evaluateThresholds({ asOf, revenueYtd, pkp, taxScheme, framework, legalForm, size: 'LARGE' });
                for (const x of a) {
                  expect(x.message.length).toBeGreaterThan(10);
                  expect(x.percent).toBeGreaterThanOrEqual(0);
                  expect(['OK', 'INFO', 'WARN', 'ERROR']).toContain(x.level);
                  expect(x.link.startsWith('/')).toBe(true);
                }
              }
  });
});
