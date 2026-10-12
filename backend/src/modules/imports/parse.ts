import { D, Dec } from '../../common/utils/money';

/** Nilai sel kosong? */
export const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export const text = (v: unknown): string | undefined => (blank(v) ? undefined : String(v).trim());

/**
 * Angka dari Excel / ketikan pengguna: 1250000 · "1.250.000" · "1.250.000,50" · "1,250,000.50" · "Rp 1.250.000" · "(5.000)".
 * Mengembalikan null bila kosong, 'invalid' bila tidak bisa dibaca.
 */
export function num(v: unknown): Dec | null | 'invalid' {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? D(v) : 'invalid';
  let s = String(v).trim().replace(/^rp\.?/i, '').replace(/\s/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.250.000,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // 1,250,000.50
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.'); // 1250,5
  if (!/^\d+(\.\d+)?$/.test(s)) return 'invalid';
  const d = D(s);
  return neg ? d.negated() : d;
}

/** Tanggal dari Excel (nomor seri), "2025-12-31", "31/12/2025", "31-12-2025". */
export function date(v: unknown): string | null | 'invalid' {
  if (blank(v)) return null;
  let y: number, m: number, d: number;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return 'invalid';
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = String(v).trim();
    let r: RegExpMatchArray | null;
    if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [y, m, d] = [+r[3], +r[2], +r[1]];
    else return 'invalid';
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
