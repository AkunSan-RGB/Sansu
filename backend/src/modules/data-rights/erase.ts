/**
 * Penghapusan permanen seluruh data satu perusahaan. Dijalankan lewat koneksi admin (bukan peran aplikasi) dalam SATU transaksi:
 * bila ada satu saja langkah atau pemeriksaan yang gagal, seluruhnya dibatalkan dan tidak ada data yang terhapus sebagian.
 *
 * Tabel yang dihapus ditentukan dari katalog database (bukan daftar tulisan tangan), sehingga tabel baru otomatis ikut:
 *  - tabel dengan kolom tenant_id, dan
 *  - tabel anak tanpa tenant_id yang terhubung ke tabel perusahaan lewat rantai foreign key (baris faktur, baris jurnal, dst.).
 * Urutan hapus: anak lebih dulu. Sesudahnya dihitung ulang: jumlah baris tiap tabel harus turun persis sebanyak baris perusahaan itu,
 * dan tidak boleh ada baris tersisa yang bertanda perusahaan itu. Kegagalan pemeriksaan membatalkan transaksi.
 */
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Tabel global (bukan milik perusahaan) yang tidak pernah dihapus */
const GLOBAL_TABLES = new Set(['plans', 'platform_settings', 'data_erasure_log']);

export interface EraseResult {
  rowsDeleted: number;
  tablesTouched: number;
  perTable: Record<string, number>;
}

export type Fk = { child: string; col: string; parent: string; pcol: string };

/**
 * Susun rencana penghapusan: kondisi kepemilikan tiap tabel dan urutan hapus (anak dulu). Dipisah dari eksekusi agar bisa diuji.
 */
export function planErase(tenantTables: string[], allTables: string[], fks: Fk[], tenantId: string) {
  if (!UUID_RE.test(tenantId)) throw new Error('tenantId tidak valid');
  const hasTenant = new Set(tenantTables);
  const cond = new Map<string, string>();
  for (const t of tenantTables) cond.set(t, `${q(t)}.${q('tenant_id')} = '${tenantId}'`);
  // tabel anak: kepemilikan lewat rantai foreign key ke tabel yang sudah diketahui miliknya
  const pending = allTables.filter((t) => !hasTenant.has(t) && !GLOBAL_TABLES.has(t) && t !== 'tenants');
  let progressed = true;
  const remaining = new Set(pending);
  while (progressed && remaining.size) {
    progressed = false;
    for (const t of [...remaining]) {
      const link = fks.find((f) => f.child === t && f.parent !== t && cond.has(f.parent));
      if (!link) continue;
      cond.set(t, `${q(t)}.${q(link.col)} IN (SELECT ${q(link.pcol)} FROM ${q(link.parent)} WHERE ${cond.get(link.parent)})`);
      remaining.delete(t);
      progressed = true;
    }
  }
  const owned = [...cond.keys()];
  // urutan: tabel yang tidak lagi dirujuk tabel milik lain (selain dirinya) dihapus lebih dulu
  const order: string[] = [];
  const left = new Set(owned);
  while (left.size) {
    const ready = [...left].filter((t) => !fks.some((f) => f.parent === t && f.child !== t && left.has(f.child)));
    if (!ready.length) throw new Error(`Ketergantungan melingkar antar tabel, penghapusan dibatalkan: ${[...left].join(', ')}`);
    ready.sort();
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  return { cond, order, unowned: [...remaining].sort() };
}

export async function eraseTenant(db: Db, tenantId: string): Promise<EraseResult> {
  if (!UUID_RE.test(tenantId)) throw new Error('tenantId tidak valid');
  return db.transaction(async (tx) => {
    const rows = <T extends Record<string, unknown>>(r: { rows: T[] }) => r.rows;
    // Kunci baris perusahaan: penulisan lain yang menunjuk ke perusahaan ini menunggu lalu gagal setelah selesai
    const locked = rows(await tx.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`));
    if (!locked.length) throw new Error('Perusahaan tidak ditemukan');
    // Satu-satunya jalur sah menghapus jurnal (lihat trigger journal_*_immutable): hanya berlaku di transaksi ini
    await tx.execute(sql`SELECT set_config('sansu.allow_journal_delete', 'on', true)`);

    const tenantTables = rows(await tx.execute<{ t: string }>(sql`
      SELECT c.table_name AS t FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`)).map((r) => r.t);
    const allTables = rows(await tx.execute<{ t: string }>(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`)).map((r) => r.t);
    const fks = rows(await tx.execute<Fk>(sql`
      SELECT cl.relname AS child, a.attname AS col, pl.relname AS parent, pa.attname AS pcol
      FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND n.nspname = 'public'`));
    const composite = rows(await tx.execute<{ n: string }>(sql`SELECT conname AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE contype = 'f' AND ns.nspname = 'public' AND array_length(conkey, 1) > 1`));
    if (composite.length) throw new Error(`Foreign key majemuk belum didukung penghapusan: ${composite.map((c) => c.n).join(', ')}`);

    const { cond, order, unowned } = planErase(tenantTables, allTables, fks, tenantId);
    // Tabel tanpa tenant_id yang tidak bisa dikaitkan ke perusahaan lewat foreign key (selain tabel global) berarti skema berubah
    // tanpa penyesuaian: hentikan daripada meninggalkan data yang tak terhapus tanpa diketahui.
    if (unowned.length) throw new Error(`Tabel tidak dapat dikaitkan ke perusahaan: ${unowned.join(', ')}`);

    const count = async (sqlText: string) => Number(rows(await tx.execute<{ n: string }>(sql.raw(sqlText)))[0].n);
    const before = new Map<string, { mine: number; total: number }>();
    for (const t of order) before.set(t, { mine: await count(`SELECT count(*) AS n FROM ${q(t)} WHERE ${cond.get(t)}`), total: await count(`SELECT count(*) AS n FROM ${q(t)}`) });

    const perTable: Record<string, number> = {};
    for (const t of order) {
      const b = before.get(t)!;
      if (!b.mine) continue;
      const del = await tx.execute(sql.raw(`DELETE FROM ${q(t)} WHERE ${cond.get(t)}`));
      const n = Number(del.rowCount ?? 0);
      if (n !== b.mine) throw new Error(`Penghapusan ${t} tidak sesuai: seharusnya ${b.mine}, terhapus ${n}`);
      perTable[t] = n;
    }

    // Pemeriksaan: jumlah baris tiap tabel turun persis sebesar milik perusahaan, dan tidak ada sisa bertanda perusahaan itu
    for (const t of order) {
      const b = before.get(t)!;
      const total = await count(`SELECT count(*) AS n FROM ${q(t)}`);
      if (total !== b.total - b.mine) throw new Error(`Pemeriksaan gagal pada ${t}: baris tersisa ${total}, seharusnya ${b.total - b.mine}`);
    }
    for (const t of tenantTables) {
      const left = await count(`SELECT count(*) AS n FROM ${q(t)} WHERE ${q('tenant_id')} = '${tenantId}'`);
      if (left) throw new Error(`Pemeriksaan gagal: ${left} baris perusahaan ini masih ada di ${t}`);
    }

    await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`);
    const gone = await count(`SELECT count(*) AS n FROM tenants WHERE id = '${tenantId}'`);
    if (gone) throw new Error('Baris perusahaan tidak terhapus');
    const rowsDeleted = Object.values(perTable).reduce((a, b) => a + b, 0) + 1;
    return { rowsDeleted, tablesTouched: Object.keys(perTable).length + 1, perTable: { ...perTable, tenants: 1 } };
  });
}
