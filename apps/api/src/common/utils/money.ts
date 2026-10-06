import Decimal from 'decimal.js';

/**
 * Semua perhitungan uang & kuantitas memakai Decimal, bukan number (float).
 * 0.1 + 0.2 !== 0.3 di JavaScript — tidak boleh terjadi di sistem keuangan.
 * Kolom NUMERIC dari PostgreSQL dibaca sebagai string lalu dibungkus D(...).
 */
export type Dec = Decimal;
export type DecValue = Decimal.Value;
export { Decimal };

export const D = (v: DecValue | null | undefined): Dec => new Decimal(v ?? 0);
export const ZERO = new Decimal(0);

/** Pembulatan uang: 2 desimal, half-up (standar akuntansi Indonesia). */
export const money = (v: DecValue): Dec => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Pembulatan kuantitas & biaya satuan: 4 desimal. */
export const qty4 = (v: DecValue): Dec => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export const sum = (values: DecValue[]): Dec => values.reduce<Dec>((acc, v) => acc.plus(D(v)), ZERO);

/** Format untuk disimpan ke kolom NUMERIC */
export const toMoney = (v: DecValue): string => money(v).toFixed(2);
export const toQty = (v: DecValue): string => qty4(v).toFixed(4);
