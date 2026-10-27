/**
 * Pindahkan gambar lama (data URL di basis data) ke penyimpanan objek.
 *   npm run storage:migrate              → pindahkan
 *   npm run storage:migrate -- --dry-run → hanya hitung
 *
 * Aman diulang: hanya baris yang masih berisi data URL yang diproses. Setiap gambar diunggah, dibaca ulang dari bucket dan
 * dibandingkan dengan aslinya; kolom basis data baru diganti rujukan setelah terbukti sama. Gambar yang rusak dilewati dan dilaporkan.
 * Memakai koneksi admin (lintas perusahaan), jalankan hanya oleh operator.
 */
import 'dotenv/config';
import type { Pool } from 'pg';
import { StorageService } from '../common/storage/storage.service';
import { createPool } from './db';
import { Logger } from '@nestjs/common';

const log = new Logger('Penyimpanan');

const TARGETS = [
  { table: 'utility_readings', column: 'photo', kind: 'meter' },
  { table: 'delivery_trip_stops', column: 'proof_photo', kind: 'bukti-kirim' },
  { table: 'delivery_trip_stops', column: 'proof_signature', kind: 'tanda-tangan' },
] as const;

export interface MoveResult { moved: number; skipped: { table: string; id: string; reason: string }[]; pending: number }

export async function moveImagesToStorage(pool: Pool, storage: StorageService, opts: { dryRun?: boolean; batch?: number } = {}): Promise<MoveResult> {
  const result: MoveResult = { moved: 0, skipped: [], pending: 0 };
  if (!storage.enabled && !opts.dryRun) throw new Error('Penyimpanan belum dikonfigurasi (STORAGE_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY)');
  for (const t of TARGETS) {
    const where = `${t.column} LIKE 'data:%'`;
    result.pending += Number((await pool.query(`SELECT count(*) AS n FROM ${t.table} WHERE ${where}`)).rows[0].n);
    if (opts.dryRun) continue;
    let last = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const { rows } = await pool.query<{ id: string; tenant_id: string; v: string }>(`SELECT id, tenant_id, ${t.column} AS v FROM ${t.table} WHERE ${where} AND id > $1 ORDER BY id LIMIT $2`, [last, opts.batch ?? 50]);
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id;
        try {
          const ref = await storage.store(r.tenant_id, t.kind, r.v);
          if (!ref || !StorageService.isRef(ref)) throw new Error('unggah tidak menghasilkan rujukan');
          const back = await storage.load(r.tenant_id, ref);
          if (back !== r.v) {
            await storage.discard(ref);
            throw new Error('isi di bucket tidak sama dengan asli');
          }
          const u = await pool.query(`UPDATE ${t.table} SET ${t.column} = $1 WHERE id = $2 AND ${t.column} = $3`, [ref, r.id, r.v]);
          if (!u.rowCount) await storage.discard(ref); // berubah selagi berjalan: biarkan yang baru
          else result.moved++;
        } catch (e) {
          result.skipped.push({ table: t.table, id: r.id, reason: (e as Error).message });
        }
      }
    }
  }
  return result;
}

async function main() {
  const pool = createPool();
  try {
    const dry = process.argv.includes('--dry-run');
    const r = await moveImagesToStorage(pool, new StorageService(), { dryRun: dry });
    log.log(dry ? `Gambar yang akan dipindah: ${r.pending}` : `Dipindah: ${r.moved}; dilewati: ${r.skipped.length}`);
    for (const s of r.skipped) log.log(`  dilewati ${s.table} ${s.id}: ${s.reason}`);
    if (r.skipped.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[X] Pemindahan gambar gagal: ${(e as Error).message}`);
    process.exit(1);
  });
}
