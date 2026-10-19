import { conclude } from './support-insights';
import type { Reconciliation, SupportSection } from './support-reports';

const period = { from: '2026-10-01', to: '2026-10-19' };
const rec = (key: string, left: number, right: number): Reconciliation => ({ key, title: key, left: { label: 'L', value: left }, right: { label: 'R', value: right }, diff: left - right, ok: Math.abs(left - right) < 1 });
const sec = (key: string, rows: (string | number | null)[][], idx = 0): SupportSection => ({ key, number: 'X', title: key, paragraphs: [], tables: Array.from({ length: idx + 1 }, (_, i) => ({ columns: [], align: [], rows: i === idx ? rows : [] })) });
const titles = (c: ReturnType<typeof conclude>) => c.findings.map((f) => f.title).join(' | ');

describe('conclude', () => {
  it('semua cocok dan tanpa temuan → status ok', () => {
    const c = conclude('sales', { reconciliation: [rec('a', 100, 100)], sections: [], period });
    expect(c.status).toBe('ok');
    expect(c.summary).toBe('Semua 1 pencocokan buku besar cocok; tidak ada temuan yang perlu ditindaklanjuti.');
  });

  it('selisih buku besar → kritis dengan jumlah dan saran', () => {
    const c = conclude('sales', { reconciliation: [rec('sales-ar', 1000000, 900000)], sections: [], period });
    expect(c.status).toBe('danger');
    expect(c.findings[0].title).toContain('Rp100.000');
    expect(c.findings[0].action).toBeTruthy();
    expect(c.summary).toContain('1 dari 1 pencocokan buku besar berselisih');
  });

  it('selisih biaya konversi produksi hanya informasi', () => {
    const c = conclude('mfg', { reconciliation: [rec('mfg-conversion', 150000, 0)], sections: [], period });
    expect(c.status).toBe('info');
    expect(c.findings[0].detail).toContain('lebih dibebankan');
  });

  it('umur piutang: > 90 hari besar dan konsentrasi pelanggan', () => {
    const rows = [['PT A', 0, 0, 0, 0, 600, 600], ['PT B', 400, 0, 0, 0, 0, 400]];
    const c = conclude('sales', { reconciliation: [], sections: [sec('sales-aging', rows)], period });
    expect(titles(c)).toContain('Piutang lewat 90 hari Rp600');
    expect(c.findings.find((f) => f.title.includes('lewat 90'))!.level).toBe('danger'); // 60%
    expect(titles(c)).toContain('terkonsentrasi');
  });

  it('umur piutang sehat → ok', () => {
    const c = conclude('sales', { reconciliation: [], sections: [sec('sales-aging', [['PT A', 400, 0, 0, 0, 0, 400], ['PT B', 300, 0, 0, 0, 0, 300], ['PT C', 300, 0, 0, 0, 0, 300]])], period });
    expect(c.findings.map((f) => f.level)).toEqual(['ok']);
  });

  it('margin negatif, retur tinggi, surat jalan lama, dan pendapatan jurnal manual', () => {
    const c = conclude('sales', {
      reconciliation: [],
      sections: [
        sec('sales-monthly', [['2026-10', 5, 1000, 110, 100, 900, 1000, -100]]),
        sec('sales-unbilled', [['SJ/1', '2026-09-01', 'PT A', 'SO/1', 40, 500]]),
        sec('sales-source', [['Jurnal manual', 1, 250]]),
      ],
      period,
    });
    const t = titles(c);
    expect(t).toContain('laba kotor -Rp100');
    expect(t).toContain('Retur 10%');
    expect(t).toContain('1 surat jalan belum difaktur');
    expect(t).toContain('jurnal manual');
    expect(c.status).toBe('danger');
  });

  it('kasir: selisih kurang berulang pada kasir yang sama dan sesi lama masih terbuka', () => {
    const s = (no: string, who: string, diff: number | null, st = 'Ditutup', open = '2026-10-18 08:00') => [no, who, open, '-', st, 10, 100000, 0, 0, diff];
    const c = conclude('pos', {
      reconciliation: [],
      sections: [
        sec('pos-session', [s('S1', 'Budi', -5000), s('S2', 'Budi', -5000), s('S3', 'Budi', -5000), s('S4', 'Ani', 0), s('S5', 'Ani', null, 'Terbuka')]),
        sec('pos-cashier', [['Budi', 30, 0, 0, 300000, 0, 0], ['Ani', 10, 0, 0, 100000, 10000, 90000]]),
      ],
      period,
    });
    const t = titles(c);
    expect(t).toContain('3 sesi uang laci kurang (Rp15.000)');
    expect(t).toContain('Selisih kurang berulang pada Budi (3 sesi)');
    expect(t).toContain('1 sesi kasir masih terbuka');
    expect(t).toContain('Retur kasir Ani 10%');
  });

  it('F&B: bahan menyimpang dari resep', () => {
    const c = conclude('fnb', { reconciliation: [], sections: [sec('fnb-usage', [['K', 'Kopi', 100, 130, 30], ['S', 'Susu', 100, 101, 1]])], period });
    expect(titles(c)).toContain('1 bahan menyimpang lebih dari 5%');
  });

  it('produksi: rendemen rendah dan barang dalam proses lama', () => {
    const done = ['PRD/1', '-', 'S', 'P', '2026-10-05', 10, 8, 80, 0, 0, 0, 0, 0];
    const c = conclude('mfg', { reconciliation: [], sections: [sec('mfg-done', [done]), sec('mfg-wip', [['PRD/2', 'P', '2026-07-01', 80, 300000]])], period });
    expect(titles(c)).toContain('rendemen di bawah 90%');
    expect(c.findings.find((f) => f.title.includes('perintah masih berjalan'))!.level).toBe('danger');
  });

  it('jasa: proyek tanpa kemajuan, ditagih melebihi kontrak', () => {
    const prj = [['PRJ/1', 'A', 'C', 1000, null, null, 500, 500, null, 'Berjalan'], ['PRJ/2', 'B', 'C', 1000, 50, 500, 1200, -200, -700, 'Berjalan']];
    const c = conclude('jasa', { reconciliation: [], sections: [sec('jasa-project', prj)], period });
    expect(titles(c)).toContain('1 proyek berjalan belum punya catatan kemajuan');
    expect(titles(c)).toContain('1 proyek ditagih melebihi nilai kontrak');
  });

  it('utilitas: catatan janggal banyak dan tunggakan lama', () => {
    const c = conclude('utility', { reconciliation: [], sections: [sec('util-readings', [['2026-10', 10, 5, 3, 0, 3, 30]]), sec('util-arrears', [['SBG/1', 'Budi', '2026-05', '2026-06-01', 120, 100, 100]])], period });
    expect(titles(c)).toContain('30% catatan meter ditandai janggal');
    expect(titles(c)).toContain('1 tagihan menunggak');
    expect(c.findings.find((f) => f.title.includes('menunggak'))!.level).toBe('warning');
  });

  it('kas negatif dan rekening koran belum diimpor', () => {
    const c = conclude('cash', { reconciliation: [], sections: [sec('cash-accounts', [['1-1100', 'Kas', 0, 0, 100, -100]])], period });
    expect(titles(c)).toContain('1 akun kas/bank bersaldo negatif');
    expect(titles(c)).toContain('Belum ada rekening koran');
  });

  it('stok negatif', () => {
    const c = conclude('inventory', { reconciliation: [], sections: [sec('inventory-card', [['A', 'Barang A', 'PCS', 0, 0, 5, -5]])], period });
    expect(c.findings[0].level).toBe('danger');
  });
});
