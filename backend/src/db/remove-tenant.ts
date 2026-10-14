import { eq, sql } from 'drizzle-orm';
import { Db } from './db';
import { tenants } from './schema';

/**
 * Hapus seluruh data satu perusahaan (khusus perusahaan demo). Tabel anak tanpa kolom tenant_id
 * dibersihkan lewat relasinya, sehingga tidak ada data yatim.
 */
export async function removeTenant(db: Db, tenantId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    // Reset demo adalah satu-satunya jalur sah menghapus jurnal (lihat trigger journal_*_immutable)
    await tx.execute(sql`SELECT set_config('sansu.allow_journal_delete', 'on', true)`);
    const tables = (
      await tx.execute<{ t: string }>(sql`
        SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`)
    ).rows.map((r) => r.t);
    // Tabel anak (tanpa tenant_id) yang menunjuk ke tabel ber-tenant: hapus lewat induknya dulu
    const children = (
      await tx.execute<{ child: string; col: string; parent: string }>(sql`
        SELECT cl.relname AS child, a.attname AS col, pl.relname AS parent
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_class pl ON pl.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE c.contype = 'f' AND n.nspname = 'public' AND array_length(c.conkey, 1) = 1
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = cl.relname AND x.column_name = 'tenant_id')`)
    ).rows.filter((r) => tables.includes(r.parent));
    for (const c of children) {
      await tx.execute(
        sql.raw(`DELETE FROM "${c.child}" WHERE "${c.col}" IN (SELECT id FROM "${c.parent}" WHERE tenant_id = '${tenantId.replace(/'/g, '')}')`),
      );
    }
    for (const t of tables) await tx.execute(sql.raw(`DELETE FROM "${t}" WHERE tenant_id = '${tenantId.replace(/'/g, '')}'`));
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  });
}
