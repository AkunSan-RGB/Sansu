/**
 * Matriks hak akses: semua endpoint beserta peran yang boleh memakainya (OWNER selalu boleh).
 * Satu sumber kebenaran untuk tes pemisahan fungsi (test/segregation), skrip peninjauan (scripts/rbac-matrix.ts),
 * dan endpoint /auth/permissions yang dipakai tampilan untuk menyembunyikan tombol yang tidak boleh dipakai.
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

export interface RouteAccess {
  method: string;
  path: string;
  controller: string;
  /** undefined = semua peran yang login; selain itu daftar peran (OWNER selalu boleh) */
  roles?: string[];
  public: boolean;
}

export function buildRouteMatrix(discovery: DiscoveryService): RouteAccess[] {
  const reflector = new Reflector();
  const out: RouteAccess[] = [];
  for (const w of discovery.getControllers()) {
    const cls = w.metatype as (new (...a: never[]) => unknown) | null;
    if (!cls) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    const proto = cls.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler as object);
      if (method === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler as object) ?? '');
      const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler as () => unknown, cls]);
      const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler as () => unknown, cls]);
      out.push({
        method: RequestMethod[method as number],
        path: `/api/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
        controller: cls.name,
        roles: roles?.length ? roles : undefined,
        public: isPublic,
      });
    }
  }
  return out;
}

/** Kunci yang dipakai tampilan: "POST /purchase-orders/:id/confirm" (tanpa awalan /api dan tanpa garis miring akhir) */
export const permissionKey = (r: Pick<RouteAccess, 'method' | 'path'>) => `${r.method} ${r.path.replace(/^\/api/, '').replace(/\/$/, '') || '/'}`;
