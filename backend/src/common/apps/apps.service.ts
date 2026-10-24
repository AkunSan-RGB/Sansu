import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { APP_BY_KEY, APP_KEYS, APPS, type AppKey, DEFAULT_APPS, withDependencies } from '@sansu/shared';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { tenantApps } from '../../db/schema';

/** Aplikasi aktif per perusahaan (dengan cache singkat agar guard tidak query setiap request). */
@Injectable()
export class AppsService {
  private cache = new Map<string, { apps: Set<AppKey>; at: number }>();
  private static TTL = 15_000;

  constructor(@InjectDb() private readonly db: Db) {}

  async enabled(tenantId: string, db: DbOrTx = this.db): Promise<Set<AppKey>> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < AppsService.TTL) return hit.apps;
    const rows = await db.select({ k: tenantApps.appKey }).from(tenantApps).where(eq(tenantApps.tenantId, tenantId));
    const apps = new Set(rows.map((r) => r.k as AppKey).filter((k) => APP_KEYS.includes(k)));
    apps.add('accounting'); // inti, selalu aktif
    this.cache.set(tenantId, { apps, at: Date.now() });
    return apps;
  }

  async catalog(tenantId: string) {
    const on = await this.enabled(tenantId);
    return APPS.map((a) => ({ ...a, enabled: on.has(a.key) }));
  }

  /** Aktifkan aplikasi beserta dependensinya */
  async install(tenantId: string, key: AppKey) {
    if (!APP_BY_KEY[key]) throw new BadRequestException('Aplikasi tidak dikenal');
    const keys = withDependencies(key);
    await this.db
      .insert(tenantApps)
      .values(keys.map((k) => ({ tenantId, appKey: k })))
      .onConflictDoNothing();
    this.cache.delete(tenantId);
    return { installed: keys, apps: await this.catalog(tenantId) };
  }

  async uninstall(tenantId: string, key: AppKey) {
    const app = APP_BY_KEY[key];
    if (!app) throw new BadRequestException('Aplikasi tidak dikenal');
    if (app.core) throw new BadRequestException(`${app.name} adalah aplikasi inti dan tidak bisa dinonaktifkan`);
    const on = await this.enabled(tenantId);
    const dependents = APPS.filter((a) => a.key !== key && on.has(a.key) && a.depends?.includes(key));
    if (dependents.length) {
      throw new BadRequestException(`Nonaktifkan dulu ${dependents.map((d) => d.name).join(', ')} yang membutuhkan ${app.name}`);
    }
    await this.db.delete(tenantApps).where(and(eq(tenantApps.tenantId, tenantId), eq(tenantApps.appKey, key)));
    this.cache.delete(tenantId);
    return { apps: await this.catalog(tenantId) };
  }

  /** Dipakai saat perusahaan baru dibuat */
  async provisionDefaults(tx: DbOrTx, tenantId: string, base: AppKey[] = DEFAULT_APPS) {
    const keys = [...new Set(base.flatMap(withDependencies))];
    await tx
      .insert(tenantApps)
      .values(keys.map((k) => ({ tenantId, appKey: k })))
      .onConflictDoNothing();
  }

  async isEnabled(tenantId: string, keys: AppKey[]) {
    const on = await this.enabled(tenantId);
    return keys.some((k) => on.has(k));
  }
}
