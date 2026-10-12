import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { AuthUser } from './auth-user';

/**
 * Pemilik layanan SANSU (super admin) ditentukan lewat PLATFORM_ADMIN_EMAILS di .env
 * (dipisah koma). Saat pengembangan (bukan production) bawaannya admin@demo.id.
 * Sengaja tidak bisa diubah dari aplikasi: hanya yang memegang server yang bisa menunjuk super admin.
 */
export function platformAdminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? (process.env.NODE_ENV === 'production' ? '' : 'admin@demo.id');
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
export const isPlatformAdmin = (email?: string | null) => !!email && platformAdminEmails().includes(email.toLowerCase());

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const u: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (u && isPlatformAdmin(u.email)) return true;
    throw new ForbiddenException('Khusus pemilik layanan SANSU');
  }
}

/** Endpoint tetap boleh dipakai walau langganan habis / email belum diverifikasi (auth, penagihan, panel admin) */
export const ALLOW_LOCKED = 'allowLocked';
export const AllowWhenLocked = () => SetMetadata(ALLOW_LOCKED, true);
