import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import { from, Observable, switchMap, tap } from 'rxjs';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { auditLogs } from '../../db/schema';
import { AuthUser } from '../auth/auth-user';
import { auditContext } from './audit-context';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Permintaan yang tidak mengubah data atau tidak perlu dicatat */
const SKIP = [/^\/api\/auth\/(register|change-password|logout-all)$/, /\/preview$/, /\/validate$/];
const SECRET = /pass(word)?|token|secret|passphrase|challenge|^code$/i;
/** Tabel yang nilai lamanya disimpan saat diubah (PATCH/PUT /<sumber>/:id) → tampil "lama → baru" */
const SNAPSHOT: Record<string, string> = {
  products: 'products',
  customers: 'customers',
  suppliers: 'suppliers',
  users: 'users',
  accounts: 'accounts',
  warehouses: 'warehouses',
  employees: 'employees',
  recurring: 'recurring_journals',
};
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Rapikan isi permintaan untuk disimpan: sembunyikan rahasia, potong data besar */
export function sanitize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.startsWith('data:') ? '(berkas)' : v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v !== 'object') return v;
  if (depth > 4) return '…';
  if (Array.isArray(v)) {
    const head = v.slice(0, 20).map((x) => sanitize(x, depth + 1));
    return v.length > 20 ? [...head, `… +${v.length - 20} baris`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '***' : sanitize(x, depth + 1);
  return out;
}

/**
 * Jejak audit otomatis: setiap perubahan data yang berhasil (POST/PUT/PATCH/DELETE) dicatat —
 * siapa, kapan, dari IP mana, rute apa, dan isi perubahannya. Bila handler sudah mencatat jejak
 * yang lebih rinci lewat AuditService, pencatatan otomatis dilewati agar tidak ganda.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger('Audit');
  constructor(@InjectDb() private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!MUTATING.has(req.method)) return next.handle();
    const store = { logged: false, user: req.user };
    return from(this.before(req)).pipe(
      switchMap(
        (before) =>
          new Observable((sub) =>
            auditContext.run(store, () =>
              next
                .handle()
                .pipe(tap((res) => !store.logged && this.record(req, res, before)))
                .subscribe(sub),
            ),
          ),
      ),
    );
  }

  /** Nilai sebelum diubah, hanya untuk kolom yang dikirim di permintaan */
  private async before(req: Request & { user?: AuthUser }): Promise<Record<string, unknown> | undefined> {
    if (!['PATCH', 'PUT'].includes(req.method) || !req.user || !req.params?.id) return undefined;
    const segs = String(req.route?.path ?? '').replace(/^\/api\//, '').split('/');
    const table = segs[segs.length - 1] === ':id' ? SNAPSHOT[segs[segs.length - 2]] : undefined;
    const id = String(req.params.id);
    if (!table || !/^[0-9a-f-]{36}$/.test(id)) return undefined;
    try {
      const r = await this.db.execute<{ row: Record<string, unknown> }>(
        sql`SELECT row_to_json(t) AS row FROM ${sql.identifier(table)} t WHERE id = ${id} AND tenant_id = ${req.user.tenantId}`,
      );
      const row = r.rows[0]?.row;
      if (!row) return undefined;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys((req.body ?? {}) as object)) if (snake(k) in row && !SECRET.test(k)) out[k] = row[snake(k)];
      return out;
    } catch {
      return undefined;
    }
  }

  private record(req: Request & { user?: AuthUser }, res: unknown, before?: Record<string, unknown>) {
    const route = `${req.method} ${(req.route?.path as string) ?? req.path}`;
    const path = (req.route?.path as string) ?? req.path;
    if (SKIP.some((r) => r.test(path))) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (path === '/api/imports' && body.dryRun !== false) return; // pratinjau impor tidak mengubah data
    const r = (res ?? {}) as Record<string, unknown>;
    let tenantId = req.user?.tenantId;
    let userId = req.user?.sub;
    let action = req.method === 'POST' ? 'CREATE' : req.method === 'DELETE' ? 'DELETE' : 'UPDATE';
    if (path === '/api/auth/login') {
      const u = r.user as { id?: string; tenantId?: string } | undefined;
      tenantId = u?.tenantId;
      userId = u?.id;
      action = 'LOGIN';
    }
    if (!tenantId) return;
    const entityId = String(req.params?.id ?? (typeof r.id === 'string' || typeof r.id === 'number' ? r.id : '') ?? '');
    const number = typeof r.number === 'string' ? r.number : undefined;
    void this.db
      .insert(auditLogs)
      .values({
        tenantId,
        userId,
        action,
        entity: 'API',
        entityId: entityId || '-',
        data: {
          route,
          ...(number ? { number } : {}),
          ip: req.ip,
          ...(action === 'LOGIN' ? { agent: String(req.headers['user-agent'] ?? '').slice(0, 160) } : { body: sanitize(body) }),
          ...(before ? { before: sanitize(before) } : {}),
        },
      })
      .catch((e: Error) => this.log.warn(`Gagal mencatat jejak audit ${route}: ${e.message}`));
  }
}
