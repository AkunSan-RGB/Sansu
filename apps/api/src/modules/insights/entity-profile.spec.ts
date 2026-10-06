import { classifyEntity, finalTaxEligible, recommendProfile, simplificationsFor, type EntityProfileInput } from '@sansu/shared';

const base: EntityProfileInput = { publicAccountability: false, assets: 0, revenue: 0, legalForm: 'UD' };
const rec = (o: Partial<EntityProfileInput>) => recommendProfile({ ...base, ...o });

describe('klasifikasi ukuran usaha (PP 7/2021)', () => {
  it('batas atas tiap kelas termasuk kelas itu, satu rupiah di atasnya naik kelas', () => {
    expect(classifyEntity(1_000_000_000, 0).size).toBe('MICRO');
    expect(classifyEntity(1_000_000_001, 0).size).toBe('SMALL');
    expect(classifyEntity(5_000_000_000, 0).size).toBe('SMALL');
    expect(classifyEntity(5_000_000_001, 0).size).toBe('MEDIUM');
    expect(classifyEntity(10_000_000_000, 0).size).toBe('MEDIUM');
    expect(classifyEntity(10_000_000_001, 0).size).toBe('LARGE');
    expect(classifyEntity(0, 2_000_000_000).size).toBe('MICRO');
    expect(classifyEntity(0, 2_000_000_001).size).toBe('SMALL');
    expect(classifyEntity(0, 15_000_000_000).size).toBe('SMALL');
    expect(classifyEntity(0, 15_000_000_001).size).toBe('MEDIUM');
    expect(classifyEntity(0, 50_000_000_000).size).toBe('MEDIUM');
    expect(classifyEntity(0, 50_000_000_001).size).toBe('LARGE');
  });

  it('dipakai yang lebih besar dari ukuran menurut modal dan menurut peredaran', () => {
    expect(classifyEntity(500_000_000, 3_000_000_000)).toEqual({ size: 'SMALL', byAssets: 'MICRO', byRevenue: 'SMALL' });
    expect(classifyEntity(6_000_000_000, 1_000_000_000)).toEqual({ size: 'MEDIUM', byAssets: 'MEDIUM', byRevenue: 'MICRO' });
  });

  it('nilai negatif atau nol dianggap usaha mikro, bukan error', () => {
    expect(classifyEntity(-5, -5).size).toBe('MICRO');
    expect(classifyEntity(0, 0).size).toBe('MICRO');
  });
});

describe('PPh final UMKM 0,5%', () => {
  it('PT, CV, dan Firma dikecualikan; bentuk lain berhak sampai Rp4,8 miliar', () => {
    for (const f of ['PT', 'CV', 'FIRMA'] as const) expect(finalTaxEligible(f, 1_000_000_000)).toBe(false);
    for (const f of ['PT_PERORANGAN', 'KOPERASI', 'UD', 'PERORANGAN'] as const) expect(finalTaxEligible(f, 1_000_000_000)).toBe(true);
  });
  it('tepat Rp4,8 miliar masih berhak, satu rupiah lebih tidak', () => {
    expect(finalTaxEligible('UD', 4_800_000_000)).toBe(true);
    expect(finalTaxEligible('UD', 4_800_000_001)).toBe(false);
  });
});

describe('rekomendasi standar akuntansi, skema PPh, dan PKP', () => {
  it('mikro/kecil → SAK EMKM, SAK EP tetap boleh', () => {
    for (const r of [rec({ assets: 300_000_000, revenue: 900_000_000 }), rec({ assets: 3_000_000_000, revenue: 10_000_000_000 })]) {
      expect(r.framework).toBe('SAK_EMKM');
      expect(r.frameworkAlternatives).toEqual(['SAK_EP']);
      expect(r.outOfScope).toBe(false);
    }
  });

  it('menengah → SAK EP dengan SAK EMKM sebagai alternatif; besar → SAK EP saja', () => {
    const mid = rec({ assets: 8_000_000_000, revenue: 20_000_000_000 });
    expect(mid).toMatchObject({ size: 'MEDIUM', framework: 'SAK_EP', frameworkAlternatives: ['SAK_EMKM'] });
    const big = rec({ assets: 20_000_000_000, revenue: 90_000_000_000 });
    expect(big).toMatchObject({ size: 'LARGE', framework: 'SAK_EP', frameworkAlternatives: [] });
  });

  it('akuntabilitas publik: di luar cakupan dan diberi peringatan', () => {
    const r = rec({ publicAccountability: true, assets: 1, revenue: 1 });
    expect(r.outOfScope).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/akuntabilitas publik/i);
  });

  it('UD omzet kecil → PPh final; breakeven margin dijelaskan', () => {
    const r = rec({ legalForm: 'UD', revenue: 1_000_000_000 });
    expect(r.taxScheme).toBe('FINAL_UMKM');
    expect(r.finalTaxEligible).toBe(true);
    expect(r.pkpRequired).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/4,5%/);
  });

  it('PT/CV/Firma omzet kecil → tarif umum (Pasal 31E), skema final tidak direkomendasikan', () => {
    for (const legalForm of ['PT', 'CV', 'FIRMA'] as const) {
      const r = rec({ legalForm, revenue: 1_000_000_000 });
      expect(r.taxScheme).toBe('GENERAL');
      expect(r.finalTaxEligible).toBe(false);
      expect(r.warnings.join(' ')).toMatch(/masa transisi/);
    }
  });

  it('omzet melewati Rp4,8 miliar → tarif umum dan wajib PKP; Pasal 31E dijelaskan sampai Rp50 miliar', () => {
    const over = rec({ legalForm: 'UD', revenue: 4_800_000_001 });
    expect(over).toMatchObject({ taxScheme: 'GENERAL', pkpRequired: true, finalTaxEligible: false });
    expect(over.reasons.join(' ')).toMatch(/Pasal 31E/);
    const huge = rec({ legalForm: 'PT', revenue: 60_000_000_000 });
    expect(huge.reasons.join(' ')).not.toMatch(/Pasal 31E berlaku/);
    const exactly = rec({ legalForm: 'UD', revenue: 4_800_000_000 });
    expect(exactly).toMatchObject({ taxScheme: 'FINAL_UMKM', pkpRequired: false });
  });

  it('semua kombinasi menghasilkan jawaban lengkap tanpa error', () => {
    const forms = ['PT', 'PT_PERORANGAN', 'CV', 'FIRMA', 'KOPERASI', 'UD', 'PERORANGAN'] as const;
    for (const legalForm of forms) {
      for (const assets of [0, 1e9, 5e9, 1e10, 5e10]) {
        for (const revenue of [0, 2e9, 4.8e9, 15e9, 50e9, 1e11]) {
          for (const publicAccountability of [false, true]) {
            const r = rec({ legalForm, assets, revenue, publicAccountability });
            expect(['SAK_EMKM', 'SAK_EP']).toContain(r.framework);
            expect(r.frameworkAlternatives).not.toContain(r.framework);
            expect(r.reasons.length).toBeGreaterThan(0);
            // skema final hanya bila berhak
            if (r.taxScheme === 'FINAL_UMKM') expect(r.finalTaxEligible).toBe(true);
            // standar EMKM tidak pernah disarankan untuk usaha besar
            if (r.size === 'LARGE') expect(r.framework).toBe('SAK_EP');
          }
        }
      }
    }
  });
});

describe('penyederhanaan otomatis', () => {
  it('EMKM: tiga laporan wajib, pajak tangguhan tidak dihitung', () => {
    const s = simplificationsFor('SAK_EMKM', 'GENERAL').join(' ');
    expect(s).toMatch(/hanya Posisi Keuangan, Laba Rugi, dan CALK/);
    expect(s).toMatch(/Pajak tangguhan tidak dihitung/);
    expect(s).toMatch(/Rekonsiliasi fiskal, angsuran PPh 25/);
  });
  it('EP + tarif umum: lima laporan dan pajak tangguhan; EP + final: tanpa pajak tangguhan dan rekonsiliasi', () => {
    const general = simplificationsFor('SAK_EP', 'GENERAL').join(' ');
    expect(general).toMatch(/Lima laporan lengkap/);
    expect(general).toMatch(/Pajak tangguhan atas beda temporer/);
    const final = simplificationsFor('SAK_EP', 'FINAL_UMKM').join(' ');
    expect(final).not.toMatch(/Pajak tangguhan atas beda temporer/);
    expect(final).toMatch(/Rekonsiliasi fiskal dan angsuran PPh 25 dinonaktifkan/);
  });
});
