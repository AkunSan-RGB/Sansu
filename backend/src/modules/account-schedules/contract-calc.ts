import { D, Dec, Decimal, money, ZERO } from '../../common/utils/money';

export type ContractKind = 'LOAN' | 'LEASE' | 'PREPAID';
/** ANNUITY = cicilan tetap (pokok+bunga), STRAIGHT_PRINCIPAL = pokok tetap, BULLET = pokok dilunasi di akhir, STRAIGHT_LINE = amortisasi garis lurus */
export type ContractMethod = 'ANNUITY' | 'STRAIGHT_PRINCIPAL' | 'BULLET' | 'STRAIGHT_LINE';

export const METHODS_BY_KIND: Record<ContractKind, ContractMethod[]> = {
  LOAN: ['ANNUITY', 'STRAIGHT_PRINCIPAL', 'BULLET'],
  LEASE: ['ANNUITY', 'STRAIGHT_PRINCIPAL', 'BULLET'],
  PREPAID: ['STRAIGHT_LINE'],
};

export interface ContractTerms {
  kind: ContractKind;
  /** Pokok pinjaman, nilai kini liabilitas sewa saat dimulai, atau jumlah dibayar di muka */
  amount: string;
  /** Bunga per tahun (%), kosong untuk dibayar di muka */
  ratePct: string | null;
  /** Tanggal mulai (YYYY-MM-DD); bulan ini = periode pertama */
  startDate: string;
  termMonths: number;
  method: ContractMethod;
}

export interface ContractPeriod {
  /** YYYY-MM */
  period: string;
  opening: Dec;
  /** Penambahan saldo: pokok pinjaman diterima / liabilitas sewa diakui / pembayaran di muka (hanya di periode pertama) */
  additions: Dec;
  /** Pokok yang dilunasi, atau amortisasi untuk dibayar di muka */
  principal: Dec;
  interest: Dec;
  /** Pembayaran kas periode itu (pokok + bunga) untuk pinjaman/sewa; kosong untuk dibayar di muka */
  payment: Dec;
  closing: Dec;
}

const addMonths = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

/**
 * Jadwal kontraktual per bulan (murni, tanpa akses data). Saldo diakui pada bulan mulai; pembayaran/amortisasi jatuh di akhir tiap bulan
 * selama `termMonths`. Selisih pembulatan ditampung bulan terakhir sehingga saldo akhir kontrak tepat nol.
 */
export function buildContractSchedule(c: ContractTerms): ContractPeriod[] {
  const n = c.termMonths;
  const amount = money(c.amount);
  const r = c.kind === 'PREPAID' ? ZERO : D(c.ratePct ?? 0).div(100).div(12);
  const start = c.startDate.slice(0, 7);
  const rows: ContractPeriod[] = [];
  let balance = ZERO;
  const level = c.method === 'ANNUITY' ? (r.isZero() ? amount.div(n) : amount.times(r).div(D(1).minus(D(1).plus(r).pow(-n)))) : ZERO;
  for (let i = 0; i < n; i++) {
    const opening = balance;
    const additions = i === 0 ? amount : ZERO;
    const base = opening.plus(additions);
    const last = i === n - 1;
    let principal: Dec;
    let interest = money(base.times(r));
    if (c.kind === 'PREPAID' || c.method === 'STRAIGHT_PRINCIPAL') principal = last ? base : money(amount.div(n));
    else if (c.method === 'BULLET') principal = last ? base : ZERO;
    else principal = last ? base : money(money(level).minus(interest));
    if (principal.gt(base)) principal = base;
    if (c.kind === 'PREPAID') interest = ZERO;
    balance = base.minus(principal);
    rows.push({ period: addMonths(start, i), opening, additions, principal, interest, payment: c.kind === 'PREPAID' ? ZERO : principal.plus(interest), closing: balance });
  }
  return rows;
}

export interface ContractYear {
  opening: Dec;
  additions: Dec;
  principal: Dec;
  interest: Dec;
  closing: Dec;
  /** Baris per bulan Januari–Desember (null bila kontrak belum berjalan atau sudah selesai di bulan itu) */
  months: (ContractPeriod | null)[];
}

/** Ringkasan satu kontrak untuk satu tahun kalender, dari jadwal kontraktualnya */
export function contractYear(rows: ContractPeriod[], year: number): ContractYear {
  const y = String(year);
  const before = rows.filter((r) => r.period < `${y}-01`);
  const inYear = rows.filter((r) => r.period.startsWith(y));
  const opening = before.length ? before[before.length - 1].closing : ZERO;
  const sum = (f: (r: ContractPeriod) => Dec) => inYear.reduce<Dec>((s, r) => s.plus(f(r)), ZERO);
  const lastInYear = inYear[inYear.length - 1];
  return {
    opening,
    additions: sum((r) => r.additions),
    principal: sum((r) => r.principal),
    interest: sum((r) => r.interest),
    closing: lastInYear ? lastInYear.closing : opening,
    months: Array.from({ length: 12 }, (_, i) => inYear.find((r) => r.period === `${y}-${String(i + 1).padStart(2, '0')}`) ?? null),
  };
}

export { Decimal };
