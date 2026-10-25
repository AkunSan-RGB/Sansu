import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AuthUser } from '../auth/auth-user';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;
/** Permintaan yang tertahan "diproses" lebih lama dari ini dianggap terhenti di tengah jalan dan boleh diambil alih */
const STALE_SECONDS = 120;
const MAX_STORED_BYTES = 200_000;

type Req = { method: string; path: string; body?: unknown; headers: Record<string, string | string[] | undefined>; user?: AuthUser };
type Claim = { kind: 'run' } | { kind: 'replay'; status: number; body: unknown };

/**
 * Kunci idempotensi (header `Idempotency-Key`) untuk permintaan yang mengubah data.
 * Bila jawaban hilang di tengah jalan (jaringan buruk) lalu pengguna mengirim ulang permintaan yang sama dengan kunci yang sama,
 * server TIDAK menjalankannya dua kali: jawaban pertama diputar ulang. Tanpa header, perilaku tidak berubah.
 *  - kunci yang sama untuk permintaan lain (metode/alamat/pengguna beda) → 422
 *  - permintaan pertama masih berjalan → 409 (coba lagi sebentar)
 *  - permintaan pertama gagal (bukan 2xx) → kunci dilepas sehingga pengiriman ulang dijalankan normal
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<{ statusCode: number; status(code: number): unknown; setHeader(k: string, v: string): void }>();
    const raw = req.headers['idempotency-key'];
    if (!MUTATING.has(req.method) || typeof raw !== 'string' || !req.user?.tenantId) return next.handle();
    if (!KEY_RE.test(raw)) throw new BadRequestException('Idempotency-Key tidak valid (8–100 huruf, angka, atau _ . : -)');
    const tenantId = req.user.tenantId;
    const userId = req.user.sub;
    const where = `${req.method} ${req.path}`;
    const hash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

    return from(this.claim(tenantId, raw, userId, req.method, req.path, hash, where)).pipe(
      switchMap((c) => {
        if (c.kind === 'replay') {
          res.status(c.status);
          res.setHeader('Idempotent-Replay', 'true');
          return of(c.body);
        }
        return next.handle().pipe(
          switchMap((body) => from(this.finish(tenantId, raw, res.statusCode, body)).pipe(map(() => body))),
          catchError((err) => from(this.release(tenantId, raw)).pipe(switchMap(() => throwError(() => err)))),
        );
      }),
    );
  }

  private async claim(tenantId: string, key: string, userId: string, method: string, path: string, hash: string, where: string): Promise<Claim> {
    const ins = await this.db.execute(sql`INSERT INTO idempotency_keys (tenant_id, key, user_id, method, path, request_hash) VALUES (${tenantId}, ${key}, ${userId}, ${method}, ${path}, ${hash}) ON CONFLICT DO NOTHING RETURNING key`);
    if (ins.rows.length) {
      // pembersihan kecil-kecilan: kunci lebih dari 3 hari tidak berguna lagi
      if (Math.random() < 0.02) void this.db.execute(sql`DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId} AND created_at < now() - interval '3 days'`).catch(() => undefined);
      return { kind: 'run' };
    }
    const [row] = (await this.db.execute<{ user_id: string | null; method: string; path: string; request_hash: string; status: number; response: unknown }>(sql`SELECT user_id, method, path, request_hash, status, response FROM idempotency_keys WHERE tenant_id = ${tenantId} AND key = ${key}`)).rows;
    if (!row) return { kind: 'run' }; // dilepas di sela-sela: jalankan normal
    if (row.method !== method || row.path !== path || row.user_id !== userId || row.request_hash !== hash) throw new UnprocessableEntityException(`Idempotency-Key ini sudah dipakai untuk permintaan lain atau isi yang berbeda (${where})`);
    if (row.status > 0) return { kind: 'replay', status: row.status, body: row.response };
    const take = await this.db.execute(sql`UPDATE idempotency_keys SET created_at = now() WHERE tenant_id = ${tenantId} AND key = ${key} AND status = 0 AND created_at < now() - make_interval(secs => ${STALE_SECONDS}) RETURNING key`);
    if (take.rows.length) return { kind: 'run' };
    throw new ConflictException('Permintaan yang sama sedang diproses. Tunggu sebentar lalu periksa hasilnya sebelum mengirim ulang.');
  }

  private async finish(tenantId: string, key: string, status: number, body: unknown) {
    let json = JSON.stringify(body ?? null);
    if (json.length > MAX_STORED_BYTES) json = JSON.stringify({ idempotentReplay: true, note: 'Hasil pertama terlalu besar untuk disimpan; periksa datanya di daftar' });
    await this.db.execute(sql`UPDATE idempotency_keys SET status = ${status || 200}, response = ${json}::jsonb WHERE tenant_id = ${tenantId} AND key = ${key}`);
  }

  private async release(tenantId: string, key: string) {
    await this.db.execute(sql`DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId} AND key = ${key} AND status = 0`).catch(() => undefined);
  }
}
