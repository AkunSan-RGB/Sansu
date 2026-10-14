import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_LABELS } from '@sansu/shared';
import { Role } from '../../db/schema';
import { AuthUser } from './auth-user';
import { ROLES_KEY } from './decorators';
import { permissionKey } from './route-matrix';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    // Peran khusus hanya mempersempit peran dasarnya: hak tulis yang dicabut Pemilik ditolak, apa pun @Roles endpoint-nya
    if (user?.customRole?.denied.length && req.method !== 'GET' && req.route?.path) {
      const key = permissionKey({ method: req.method, path: String(req.route.path) });
      if (user.customRole.denied.includes(key)) {
        throw new ForbiddenException(`Peran khusus "${user.customRole.name}" tidak diizinkan melakukan ini (dibatasi oleh Pemilik).`);
      }
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    if (user && (user.role === 'OWNER' || roles.includes(user.role))) return true;
    // pesan menyebut siapa yang berhak, supaya pengguna tahu harus meminta tolong ke peran yang mana (pemisahan fungsi)
    const label = (r: string) => (ROLE_LABELS as Record<string, string>)[r] ?? r;
    const who = ['OWNER', ...roles.filter((r) => r !== 'OWNER')].map(label).join(', ');
    throw new ForbiddenException(`Peran Anda${user ? ` (${label(user.role)})` : ''} tidak memiliki akses ke fitur ini. Yang berhak: ${who}.`);
  }
}
