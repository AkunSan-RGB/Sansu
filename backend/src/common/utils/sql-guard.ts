import { sql, type SQL } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pertahanan berlapis untuk kueri yang merangkai teks (`sql.raw`): nilai yang disisipkan sebagai teks harus UUID.
 * Dipakai selain validasi di DTO, supaya jalur lain yang lupa memvalidasi tidak membuka injeksi SQL.
 */
export function assertUuid(value: string, label = 'ID'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${label} tidak valid`);
  return value;
}

/** Tanggal dokumen YYYY-MM-DD untuk kueri yang merangkai teks */
export function assertDocDateText(value: string, label = 'Tanggal'): string {
  if (typeof value !== 'string' || !DOC_DATE_RE.test(value)) throw new Error(`${label} tidak valid`);
  return value;
}

/** Larik teks sebagai parameter kueri (bukan rangkaian teks): `ARRAY[$1, $2]::text[]` */
export function textArray(items: readonly string[]): SQL {
  return items.length ? sql`ARRAY[${sql.join(items.map((i) => sql`${i}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`;
}
