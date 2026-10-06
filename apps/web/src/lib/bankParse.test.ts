import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { findHeader, type Grid, guessColumns, parseAmount, parseDate, toLines } from './bankParse';

const DIR = join(__dirname, '__fixtures__/bank');
const read = (f: string): Grid => {
  const wb = XLSX.read(readFileSync(join(DIR, f), 'utf8'), { type: 'string', raw: true });
  return XLSX.utils.sheet_to_json<Grid[number]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false }) as Grid;
};
const parse = (f: string) => {
  const g = read(f);
  const h = findHeader(g);
  return toLines(g, h, guessColumns(g[h]), 2026);
};

describe('mutasi rekening bank Indonesia', () => {
  // Setiap contoh: 1 Okt uang masuk 1.500.000 dari TOKO ABADI, 2 Okt biaya admin keluar
  it.each(readdirSync(DIR).filter((f) => f.endsWith('.csv')))('%s', (f) => {
    const { lines, skipped } = parse(f);
    expect(skipped).toBe(0);
    expect(lines[0]).toMatchObject({ date: '2026-10-01', amount: '1500000.00' });
    expect(lines[0].description).toMatch(/TOKO ABA/i);
    expect(lines[1].date).toBe('2026-10-02');
    expect(Number(lines[1].amount)).toBeLessThan(0);
  });

  it('BCA: transaksi tertunda (PEND) & baris ringkasan tidak diimpor', () => {
    const r = parse('bca-klikbca.csv');
    expect(r.lines).toHaveLength(3);
    expect(r.pending).toBe(1);
  });

  it('angka & tanggal berbagai format', () => {
    expect(parseAmount('1.500.000,00')?.value).toBe(1500000);
    expect(parseAmount('1,500,000.00 CR')).toEqual({ value: 1500000, dc: 'CR' });
    expect(parseAmount('(15.000)')?.value).toBe(-15000);
    expect(parseDate("'03/09", 2026)).toBe('2026-09-03');
    expect(parseDate('01 Okt 2026', 2026)).toBe('2026-10-01');
    expect(parseDate('01/10/26 08:15:22', 2026)).toBe('2026-10-01');
  });
});
