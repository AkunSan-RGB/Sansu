import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { AuthUser } from './auth-user';
import { CurrentUser } from './decorators';
import { buildRouteMatrix, permissionKey, type RouteAccess } from './route-matrix';

/**
 * Hak tulis peran pengguna, diturunkan dari @Roles setiap endpoint (satu sumber kebenaran dengan server).
 * Tampilan memakainya untuk menyembunyikan tombol yang pasti ditolak server; server tetap menegakkan aturannya.
 */
@Injectable()
export class PermissionsService {
  private matrix: RouteAccess[] | null = null;
  constructor(private readonly discovery: DiscoveryService) {}

  /** Endpoint penulisan (selain GET) yang boleh dipakai peran ini */
  allowedWrites(role: string): string[] {
    this.matrix ??= buildRouteMatrix(this.discovery);
    return this.matrix
      .filter((r) => r.method !== 'GET' && !r.public && (r.roles === undefined || role === 'OWNER' || r.roles.includes(role)))
      .map(permissionKey)
      .sort();
  }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class PermissionsController {
  constructor(private readonly svc: PermissionsService) {}

  @Get('permissions')
  permissions(@CurrentUser() u: AuthUser) {
    return { role: u.role, allow: this.svc.allowedWrites(u.role) };
  }
}

@Module({ imports: [DiscoveryModule], controllers: [PermissionsController], providers: [PermissionsService] })
export class PermissionsModule {}
