/**
 * Matriks hak akses: semua endpoint beserta peran yang boleh memakainya (OWNER selalu boleh).
 * Dipakai tes pemisahan fungsi (test/segregation.e2e-spec.ts) dan untuk meninjau pembagian tugas.
 *   npx ts-node scripts/rbac-matrix.ts            → tabel ringkas
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, ModulesContainer, Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/common/auth/decorators';

export interface RouteAccess {
  method: string;
  path: string;
  controller: string;
  /** undefined = semua peran yang login; selain itu daftar peran (OWNER selalu boleh) */
  roles?: string[];
  public: boolean;
}

export function routeMatrix(app: INestApplication): RouteAccess[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer, { strict: false }));
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
      const roles = (reflector as Reflector).getAllAndOverride<string[]>(ROLES_KEY as never, [handler as () => unknown, cls]);
      const isPublic = !!(reflector as Reflector).getAllAndOverride<boolean>(IS_PUBLIC_KEY as never, [handler as () => unknown, cls]);
      out.push({
        method: RequestMethod[method as number],
        path: `/api/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
        controller: cls.name,
        roles: (roles as string[] | undefined)?.length ? (roles as string[]) : undefined,
        public: isPublic,
      });
    }
  }
  return out;
}
