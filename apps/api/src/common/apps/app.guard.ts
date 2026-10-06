import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_BY_KEY, type AppKey } from '@sansu/shared';
import { AuthUser } from '../auth/auth-user';
import { AppsService } from './apps.service';

export const APP_KEY_META = 'sansuApp';
/** Endpoint hanya bisa dipakai jika salah satu aplikasi ini aktif di perusahaan */
export const RequireApp = (...apps: AppKey[]) => SetMetadata(APP_KEY_META, apps);

@Injectable()
export class AppGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apps: AppsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const keys = this.reflector.getAllAndOverride<AppKey[]>(APP_KEY_META, [ctx.getHandler(), ctx.getClass()]);
    if (!keys?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) return true; // endpoint publik
    if (await this.apps.isEnabled(user.tenantId, keys)) return true;
    throw new ForbiddenException(`Aplikasi ${keys.map((k) => APP_BY_KEY[k].name).join(' / ')} belum diaktifkan. Aktifkan di menu Aplikasi.`);
  }
}
