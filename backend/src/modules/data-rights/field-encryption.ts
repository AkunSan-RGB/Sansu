/**
 * Enkripsi per kolom untuk data identitas/rekening. Penulisan baru otomatis terenkripsi (tipe kolom `encryptedText`);
 * layanan ini mengenkripsi data lama yang masih teks biasa saat aplikasi start (idempotent, aman dijalankan berulang
 * dan oleh beberapa instance sekaligus) dan melaporkan sisa data yang belum terenkripsi.
 *
 * Kolom: employees.nik/npwp/bank_account, suppliers.npwp/bank_account_no, customers.npwp, serta salinan nilai yang sama di
 * employee_change_requests.changes dan approval_requests.payload (jsonb).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { encryptField, isEncryptedField } from '../../common/utils/secret';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

export const ENCRYPTED_COLUMNS = [
  { table: 'employees', column: 'nik' },
  { table: 'employees', column: 'npwp' },
  { table: 'employees', column: 'bank_account' },
  { table: 'suppliers', column: 'npwp' },
  { table: 'suppliers', column: 'bank_account_no' },
  { table: 'customers', column: 'npwp' },
] as const;

const BATCH = 500;
const CHANGE_KEYS = ['nik', 'npwp', 'bankAccount'];

@Injectable()
export class FieldEncryptionService implements OnModuleInit {
  private readonly logger = new Logger('Enkripsi');
  constructor(@InjectDb() private readonly db: Db) {}

  /** Jumlah baris yang masih menyimpan nilai teks biasa (0 = semuanya terenkripsi) */
  async plaintextCount(): Promise<number> {
    let n = 0;
    for (const { table, column } of ENCRYPTED_COLUMNS) {
      const r = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(table)} WHERE btrim(coalesce(${sql.identifier(column)}, '')) <> '' AND ${sql.identifier(column)} NOT LIKE 'enc1:%'`);
      n += r.rows[0].n;
    }
    const c = await this.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM employee_change_requests c, jsonb_each(c.changes) e
      WHERE e.key IN ('nik','npwp','bankAccount') AND (jsonb_typeof(e.value->'from') = 'string' AND (e.value->>'from') NOT LIKE 'enc1:%' AND btrim(e.value->>'from') <> ''
         OR jsonb_typeof(e.value->'to') = 'string' AND (e.value->>'to') NOT LIKE 'enc1:%' AND btrim(e.value->>'to') <> '')`);
    const a = await this.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM approval_requests WHERE kind = 'SUPPLIER_BANK' AND jsonb_typeof(payload->'bankAccountNo') = 'string'
        AND (payload->>'bankAccountNo') NOT LIKE 'enc1:%' AND btrim(payload->>'bankAccountNo') <> ''`);
    return n + c.rows[0].n + a.rows[0].n;
  }

  /** Mengenkripsi semua nilai lama. Mengembalikan jumlah nilai yang dienkripsi. */
  async backfill(): Promise<number> {
    let done = 0;
    for (const { table, column } of ENCRYPTED_COLUMNS) {
      for (;;) {
        const rows = (await this.db.execute<{ id: string; v: string }>(sql`
          SELECT id, ${sql.identifier(column)} AS v FROM ${sql.identifier(table)}
          WHERE btrim(coalesce(${sql.identifier(column)}, '')) <> '' AND ${sql.identifier(column)} NOT LIKE 'enc1:%' LIMIT ${BATCH}`)).rows;
        if (!rows.length) break;
        let progressed = 0;
        for (const r of rows) {
          // syarat nilai lama sama mencegah menimpa perubahan yang masuk bersamaan
          const u = await this.db.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${encryptField(r.v)} WHERE id = ${r.id} AND ${sql.identifier(column)} = ${r.v}`);
          progressed += u.rowCount ?? 0;
        }
        done += progressed;
        if (!progressed) break;
      }
    }
    done += await this.sealJson('employee_change_requests', 'changes', async (v) => sealChanges(v as Record<string, { from: unknown; to: unknown }>), sql`c.changes::text ~ '"(nik|npwp|bankAccount)"'`);
    done += await this.sealJson('approval_requests', 'payload', async (v) => {
      const p = v as Record<string, unknown>;
      return typeof p.bankAccountNo === 'string' && !isEncryptedField(p.bankAccountNo) ? { ...p, bankAccountNo: encryptField(p.bankAccountNo) } : p;
    }, sql`c.kind = 'SUPPLIER_BANK' AND c.payload ? 'bankAccountNo'`);
    return done;
  }

  private async sealJson(table: string, column: string, seal: (v: unknown) => Promise<unknown>, where: ReturnType<typeof sql>): Promise<number> {
    let last = '00000000-0000-0000-0000-000000000000';
    let done = 0;
    for (;;) {
      const rows = (await this.db.execute<{ id: string; v: unknown }>(sql`
        SELECT c.id, c.${sql.identifier(column)} AS v FROM ${sql.identifier(table)} c WHERE c.id > ${last} AND (${where}) ORDER BY c.id LIMIT ${BATCH}`)).rows;
      if (!rows.length) return done;
      for (const r of rows) {
        last = r.id;
        const next = await seal(r.v);
        if (canon(next) === canon(r.v)) continue; // jsonb mengurutkan kunci sendiri: bandingkan tanpa peduli urutan
        const u = await this.db.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${JSON.stringify(next)}::jsonb WHERE id = ${r.id} AND ${sql.identifier(column)} = ${JSON.stringify(r.v)}::jsonb`);
        done += u.rowCount ?? 0;
      }
    }
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.FIELD_ENCRYPTION_BACKFILL === 'off') return;
    // di latar belakang: tidak menahan aplikasi mulai melayani
    void this.backfill()
      .then((n) => n > 0 && this.logger.log(`${n} nilai identitas/rekening lama dienkripsi`))
      .catch((e: Error) => this.logger.error(`Pengisian ulang enkripsi gagal: ${e.message}`));
  }
}

const ID_FIELDS = new Set(CHANGE_KEYS);
function sealChanges(c: Record<string, { from: unknown; to: unknown }>) {
  const enc = (x: unknown) => (typeof x === 'string' ? encryptField(x) : x);
  return Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, ID_FIELDS.has(k) && v ? { from: enc(v.from), to: enc(v.to) } : v]));
}

/** JSON dengan kunci terurut, untuk membandingkan isi tanpa peduli urutan kunci */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
