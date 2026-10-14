/**
 * Matriks hak akses: semua endpoint beserta peran yang boleh memakainya (OWNER selalu boleh).
 * Dipakai tes pemisahan fungsi (test/segregation.e2e-spec.ts) dan untuk meninjau pembagian tugas.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { buildRouteMatrix, type RouteAccess } from '../src/common/auth/route-matrix';

export type { RouteAccess };
export function routeMatrix(app: INestApplication): RouteAccess[] {
  return buildRouteMatrix(app.get(DiscoveryService, { strict: false }));
}
