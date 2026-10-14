import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_LABELS } from '@sansu/shared';
import { Role } from '../../db/schema';
import { AuthUser } from './auth-user';
import { ROLES_KEY } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (user && (user.role === 'OWNER' || roles.includes(user.role))) return true;
    // pesan menyebut siapa yang berhak, supaya pengguna tahu harus meminta tolong ke peran yang mana (pemisahan fungsi)
    const label = (r: string) => (ROLE_LABELS as Record<string, string>)[r] ?? r;
    const who = ['OWNER', ...roles.filter((r) => r !== 'OWNER')].map(label).join(', ');
    throw new ForbiddenException(`Peran Anda${user ? ` (${label(user.role)})` : ''} tidak memiliki akses ke fitur ini. Yang berhak: ${who}.`);
  }
}
