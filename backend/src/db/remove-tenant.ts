import { eq, sql } from 'drizzle-orm';
import { Db } from './db';
import { tenants } from './schema';

/**
 * Hapus seluruh data satu perusahaan (khusus perusahaan demo). Tabel anak tanpa kolom tenant_id
 * dibersihkan lewat relasinya, sehingga tidak ada data yatim.
 */
export async function removeTenant(db: Db, tenantId: string, opts: { noReplica?: boolean } = {}) {
  await db.transaction(async (tx) => {
    // Jalur cepat: matikan pemeriksaan relasi. Hanya superuser yang boleh; penyedia terkelola (mis. Neon) menolaknya,
    // maka ada jalur cadangan yang menghapus berurutan menurut relasi (lihat bawah)
    let replica = false;
    if (!opts.noReplica) {
      await tx.execute(sql`SAVEPOINT pakai_replica`);
      try {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        replica = true;
        await tx.execute(sql`RELEASE SAVEPOINT pakai_replica`);
      } catch {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT pakai_replica`);
      }
    }
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
    const tid = tenantId.replace(/'/g, '');
    const statements = [
      ...children.map((c) => ({ name: c.child, sql: `DELETE FROM "${c.child}" WHERE "${c.col}" IN (SELECT id FROM "${c.parent}" WHERE tenant_id = '${tid}')` })),
      ...tables.map((t) => ({ name: t, sql: `DELETE FROM "${t}" WHERE tenant_id = '${tid}'` })),
    ];
    if (replica) {
      for (const st of statements) await tx.execute(sql.raw(st.sql));
    } else {
      // Tanpa pelonggaran relasi: ulangi tabel yang masih terikat relasi sampai semuanya terhapus (urutan anak sebelum induk
      // terbentuk sendiri). Satu pernyataan DELETE yang menghapus semua baris sebuah tabel sah untuk relasi ke dirinya sendiri.
      let pending = statements;
      let n = 0;
      while (pending.length) {
        const failed: typeof statements = [];
        const errors: string[] = [];
        for (const st of pending) {
          await tx.execute(sql.raw(`SAVEPOINT hapus_${n}`));
          try {
            await tx.execute(sql.raw(st.sql));
            await tx.execute(sql.raw(`RELEASE SAVEPOINT hapus_${n}`));
          } catch (e) {
            await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT hapus_${n}`));
            const err = e as { message?: string; cause?: { code?: string; message?: string } };
            if (err.cause?.code !== '23503' && !/foreign key/i.test(err.cause?.message ?? err.message ?? '')) throw e;
            failed.push(st);
            errors.push(`${st.name}: ${err.cause?.message ?? err.message}`);
          }
          n++;
        }
        if (failed.length === pending.length) throw new Error(`Penghapusan perusahaan macet karena relasi: ${errors.slice(0, 3).join(' | ')}`);
        pending = failed;
      }
    }
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  });
}
