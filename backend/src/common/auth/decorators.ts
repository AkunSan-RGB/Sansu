import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../../db/schema';
import { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
/** Endpoint tanpa login (mis. /auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Batasi endpoint ke peran tertentu. OWNER selalu diizinkan. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Ambil user dari token: `@CurrentUser() user: AuthUser` */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
