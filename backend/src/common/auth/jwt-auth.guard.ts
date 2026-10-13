import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';
import { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';
import { TwoFactorPolicy } from './two-factor-policy';

/**
 * Guard global: setiap endpoint butuh Bearer token kecuali ditandai @Public().
 * Selain tanda tangan token, status pengguna dicek ke database di setiap permintaan sehingga
 * pengguna yang dinonaktifkan / diganti sandinya / diubah perannya langsung kehilangan akses.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Db,
    private readonly twoFactor: TwoFactorPolicy,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Token tidak ditemukan');

    let p: AuthUser;
    try {
      p = await this.jwt.verifyAsync<AuthUser>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
    // token khusus (mis. tantangan 2FA) bukan token akses
    if ((p as AuthUser & { k?: string }).k || !p.tenantId) throw new UnauthorizedException('Token tidak valid');
    const [u] = await this.db
      .select({
        isActive: users.isActive,
        tokenVersion: users.tokenVersion,
        role: users.role,
        tenantId: users.tenantId,
        emailVerifiedAt: users.emailVerifiedAt,
        warehouseIds: users.warehouseIds,
        branchIds: users.branchIds,
        totpEnabledAt: users.totpEnabledAt,
      })
      .from(users)
      .where(eq(users.id, p.sub));
    if (!u || !u.isActive || u.tenantId !== p.tenantId || u.tokenVersion !== (p.tv ?? 0)) {
      throw new UnauthorizedException('Sesi Anda sudah berakhir. Silakan masuk lagi.');
    }
    req.user = {
      ...p,
      role: u.role,
      emailVerified: !!u.emailVerifiedAt,
      warehouseIds: u.warehouseIds?.length ? u.warehouseIds : null,
      branchIds: u.branchIds?.length ? u.branchIds : null,
    };
    // Perusahaan mewajibkan 2FA: sebelum diaktifkan, hanya rute akun (/auth/...) yang boleh dipakai
    if (
      !u.totpEnabledAt &&
      !String(req.path ?? req.url).includes('/auth/') &&
      (await this.twoFactor.requiredFor(u.tenantId, u.role))
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        message: 'Perusahaan Anda mewajibkan verifikasi 2 langkah. Aktifkan dulu di menu Keamanan akun.',
      });
    }
    return true;
  }
}
