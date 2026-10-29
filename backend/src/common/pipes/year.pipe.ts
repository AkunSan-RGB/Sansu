import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** "2026" → 2026; menolak apa pun yang bukan tahun 4 digit dalam rentang wajar (mis. 94, -5, 99999, 2026.5) */
export function parseYear(value: string): number {
  if (!/^\d{4}$/.test(value.trim())) throw new BadRequestException(`Tahun harus 4 digit antara ${MIN_YEAR} dan ${MAX_YEAR}`);
  const y = Number(value);
  if (y < MIN_YEAR || y > MAX_YEAR) throw new BadRequestException(`Tahun harus antara ${MIN_YEAR} dan ${MAX_YEAR}`);
  return y;
}

/** Parameter rute `:year` */
@Injectable()
export class YearPipe implements PipeTransform<string, number> {
  transform(value: string) {
    return parseYear(String(value));
  }
}

/** Parameter `?year=`: kosong = bawaan; ada tetapi tidak sah = 400 (tidak diam-diam diganti) */
export function yearQuery<T>(value: string | undefined, fallback: T): number | T {
  return value === undefined || value === '' ? fallback : parseYear(value);
}

/** Parameter `?month=` (1–12): kosong = setahun; ada tetapi tidak sah = 400 */
export function monthQuery(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^(0?[1-9]|1[0-2])$/.test(value.trim())) throw new BadRequestException('Bulan harus 1 sampai 12');
  return Number(value);
}
