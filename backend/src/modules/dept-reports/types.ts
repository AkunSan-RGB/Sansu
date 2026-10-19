import type { BusinessModel } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/db';

/** Jenis kolom: dipakai tampilan dan ekspor untuk memformat angka */
export type ColType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'pct' | 'hours';
export interface Col { key: string; label: string; type?: ColType }
/** Satu tabel laporan; tampilan membuat satu tab per bagian */
export interface Section { key: string; title: string; note?: string; columns: Col[]; rows: Record<string, unknown>[]; empty?: string }
export interface Kpi { label: string; value: string | number; type?: ColType; tone?: 'warn' | 'ok' }
export const DEPTS = ['sales', 'purchases', 'inventory', 'cash', 'pos', 'fnb', 'fmcg', 'mfg', 'jasa', 'utility', 'hr'] as const;
export type DeptKey = (typeof DEPTS)[number];
export interface DeptReport { dept: DeptKey; title: string; description: string; period: { from: string; to: string }; kpis: Kpi[]; sections: Section[] }
export interface Ctx { db: Db; tenantId: string; from: string; to: string; today: string; model: BusinessModel }
export type Builder = (c: Ctx) => Promise<Pick<DeptReport, 'kpis' | 'sections'>>;

/** Jalankan query dan kembalikan barisnya */
export async function rows<T = Record<string, unknown>>(c: Ctx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await c.db.execute(q)).rows as T[];
}
export const num = (v: unknown) => Number(v ?? 0);
export const rp = (v: unknown) => `Rp${Math.round(num(v)).toLocaleString('id-ID')}`;
const dayMs = 86_400_000;
export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs) + 1;
/** Rentang pendek dikelompokkan per hari, panjang per bulan */
export const grainOf = (c: Ctx): 'day' | 'month' => (spanDays(c.from, c.to) <= 62 ? 'day' : 'month');
export const grainSql = (col: string, g: 'day' | 'month') => (g === 'day' ? sql.raw(`to_char(${col}, 'YYYY-MM-DD')`) : sql.raw(`to_char(${col}, 'YYYY-MM')`));
export const periodLabel = (g: 'day' | 'month') => (g === 'day' ? 'Tanggal' : 'Bulan');
