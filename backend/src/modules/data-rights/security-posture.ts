/**
 * Pemeriksaan postur keamanan database: memastikan pemisahan data antar perusahaan benar-benar berlaku di database yang sedang
 * dipakai, bukan hanya di kode. Dijalankan saat aplikasi start (produksi menolak jalan bila ada yang kritis), setiap hari, dan
 * dapat dilihat pemilik layanan di Panel SANSU.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { FieldEncryptionService } from './field-encryption';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { APP_ROLE } from '../../db/tenant-pool';

export interface PostureCheck {
  key: string;
  title: string;
  ok: boolean;
  /** critical = produksi menolak start; warning = hanya diberitahukan */
  severity: 'critical' | 'warning';
  detail: string;
}
export interface Posture {
  ok: boolean;
  checkedAt: string;
  checks: PostureCheck[];
}

/**
 * Tabel anak yang sengaja tanpa RLS: auth_tokens hanya dibuka lewat token acak sekali pakai yang disimpan sebagai hash (alur lupa
 * kata sandi dan verifikasi email berjalan sebelum login, jadi tidak punya lingkup perusahaan).
 */
export const RLS_EXEMPT = new Set(['auth_tokens']);

interface Fk {
  child: string;
  parent: string;
}

/** Tabel tanpa tenant_id yang secara tidak langsung (lewat rantai foreign key) milik satu perusahaan */
export function tenantOwnedChildren(tenantTables: string[], noTenantTables: string[], fks: Fk[]): string[] {
  const owned = new Set(tenantTables);
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fks) {
      if (owned.has(f.parent) && noTenantTables.includes(f.child) && !result.has(f.child)) {
        result.add(f.child);
        owned.add(f.child);
        changed = true;
      }
    }
  }
  return [...result].sort();
}

@Injectable()
export class SecurityPostureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Keamanan');
  private timer?: NodeJS.Timeout;
  last?: Posture;

  constructor(@InjectDb() private readonly db: Db, private readonly fields: FieldEncryptionService) {}

  private async rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>) {
    return (await this.db.execute<T>(q)).rows;
  }

  async check(): Promise<Posture> {
    const checks: PostureCheck[] = [];
    const add = (key: string, title: string, ok: boolean, detail: string, severity: PostureCheck['severity'] = 'critical') => checks.push({ key, title, ok, severity, detail });

    // 1. Peran aplikasi tidak boleh melewati RLS
    const [role] = await this.rows<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${APP_ROLE}`);
    add('app-role', `Peran aplikasi ${APP_ROLE} tunduk pada RLS`, !!role && !role.rolsuper && !role.rolbypassrls, !role ? `Peran ${APP_ROLE} tidak ada` : role.rolsuper || role.rolbypassrls ? `${APP_ROLE} memiliki hak superuser/bypass RLS` : 'Bukan superuser dan tidak melewati RLS');

    // 2. Pengaman tidak dimatikan lewat pengaturan darurat
    add('rls-env', 'RLS tidak dimatikan lewat RLS_DISABLED', process.env.RLS_DISABLED !== 'true', process.env.RLS_DISABLED === 'true' ? 'RLS_DISABLED=true: isolasi antar perusahaan hanya bergantung pada kode' : 'Aktif');

    // 3. Setiap tabel milik perusahaan (langsung atau lewat induk) wajib RLS + kebijakan
    const tenantTables = (await this.rows<{ t: string }>(sql`
      SELECT c.table_name AS t FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`)).map((r) => r.t);
    const allTables = (await this.rows<{ t: string }>(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`)).map((r) => r.t);
    const fks = await this.rows<{ child: string; parent: string }>(sql`
      SELECT cl.relname AS child, pl.relname AS parent FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`);
    const children = tenantOwnedChildren(tenantTables, allTables.filter((t) => !tenantTables.includes(t)), fks);
    const rlsOn = new Set((await this.rows<{ t: string }>(sql`SELECT relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`)).map((r) => r.t));
    const withPolicy = new Set((await this.rows<{ t: string }>(sql`SELECT DISTINCT tablename AS t FROM pg_policies WHERE schemaname = 'public'`)).map((r) => r.t));
    const unprotected = [...tenantTables, ...children].filter((t) => !RLS_EXEMPT.has(t) && (!rlsOn.has(t) || !withPolicy.has(t))).sort();
    add('rls-coverage', 'Semua tabel data perusahaan dilindungi RLS', unprotected.length === 0, unprotected.length ? `Tabel tanpa RLS/kebijakan: ${unprotected.join(', ')}` : `${tenantTables.length} tabel ber-tenant + ${children.length - [...RLS_EXEMPT].filter((t) => children.includes(t)).length} tabel anak dilindungi RLS (pengecualian: ${[...RLS_EXEMPT].join(', ')} — hanya lewat token hash sekali pakai)`);

    // 4. Uji langsung: dengan lingkup satu perusahaan, baris perusahaan lain tidak boleh terlihat
    let probeOk = true;
    let probeDetail = 'Belum ada perusahaan untuk diuji';
    const [t1] = await this.rows<{ id: string }>(sql`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
    const [other] = await this.rows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id <> ${t1?.id ?? '00000000-0000-0000-0000-000000000000'}`);
    if (t1 && other.n > 0) {
      try {
        const seen = await this.db.transaction(async (tx) => {
          await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${t1.id}, true), set_config('app.bypass_rls', 'off', true)`);
          const own = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = ${t1.id}`);
          const foreign = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id <> ${t1.id}`);
          const nobody = await (async () => {
            await tx.execute(sql`SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true)`);
            return tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users`);
          })();
          return { own: own.rows[0].n, foreign: foreign.rows[0].n, nobody: nobody.rows[0].n };
        });
        probeOk = seen.foreign === 0 && seen.nobody === 0;
        probeDetail = probeOk ? `Lingkup satu perusahaan hanya melihat barisnya sendiri (${seen.own} pengguna), perusahaan tak dikenal melihat 0 baris` : `BOCOR: lingkup satu perusahaan melihat ${seen.foreign} baris perusahaan lain`;
      } catch (e) {
        probeOk = false;
        probeDetail = `Uji isolasi gagal dijalankan: ${(e as Error).message}`;
      }
    } else if (t1) probeDetail = 'Hanya satu perusahaan: uji lintas perusahaan belum bisa dilakukan';
    add('rls-probe', 'Uji langsung isolasi antar perusahaan', probeOk, probeDetail);

    // 5. Koneksi ke database terenkripsi (peringatan: jaringan privat Docker memang tanpa TLS)
    const [ssl] = await this.rows<{ ssl: boolean | null }>(sql`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`);
    add('db-tls', 'Koneksi aplikasi ke database memakai TLS', ssl?.ssl === true, ssl?.ssl === true ? 'TLS aktif' : 'Tanpa TLS. Wajar bila database di jaringan privat yang sama; wajib TLS bila lewat internet (mis. Neon)', 'warning');

    // 6. Kolom identitas/rekening terenkripsi (peringatan: pengisian ulang data lama berjalan di latar belakang saat start)
    try {
      const plain = await this.fields.plaintextCount();
      add('field-encryption', 'NIK, NPWP, dan nomor rekening tersimpan terenkripsi', plain === 0, plain === 0 ? 'Semua nilai terenkripsi (AES-256-GCM)' : `${plain} nilai masih teks biasa; dienkripsi otomatis saat aplikasi start (lihat log "Enkripsi")`, 'warning');
    } catch (e) {
      add('field-encryption', 'NIK, NPWP, dan nomor rekening tersimpan terenkripsi', false, `Pemeriksaan gagal: ${(e as Error).message}`, 'warning');
    }

    const posture: Posture = { ok: checks.every((c) => c.ok || c.severity !== 'critical'), checkedAt: new Date().toISOString(), checks };
    this.last = posture;
    return posture;
  }

  /** Dipanggil saat start. Produksi menolak jalan bila ada pemeriksaan kritis yang gagal. */
  async assertAtStartup(): Promise<void> {
    const p = await this.check();
    for (const c of p.checks.filter((x) => !x.ok)) this.logger[c.severity === 'critical' ? 'error' : 'warn'](`${c.title}: ${c.detail}`);
    if (!p.ok && process.env.NODE_ENV === 'production') throw new Error('Pemeriksaan keamanan database gagal — aplikasi tidak dijalankan. Lihat log "Keamanan" di atas.');
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    await this.assertAtStartup();
    this.timer = setInterval(() => void this.check().then((p) => !p.ok && this.logger.error(`Pemeriksaan harian GAGAL: ${p.checks.filter((c) => !c.ok && c.severity === 'critical').map((c) => c.title).join('; ')}`)).catch((e) => this.logger.error(`Pemeriksaan harian error: ${(e as Error).message}`)), 24 * 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
