import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../auth/auth-user';
import { IS_PUBLIC_KEY } from '../auth/decorators';
import { ALLOW_LOCKED } from '../auth/platform-admin';
import { MailService } from '../mail/mail.service';
import { SubscriptionService } from './subscription.service';

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Wajib verifikasi email sebelum mengubah data — aktif bila SMTP sudah diatur (bisa dimatikan dengan REQUIRE_EMAIL_VERIFICATION=false) */
export const verificationRequired = (mail: MailService) => mail.configured && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';

/**
 * Guard global setelah login:
 *  - langganan habis / ditangguhkan → mode baca saja (data tetap bisa dilihat & diekspor, tidak bisa diubah)
 *  - email belum diverifikasi (bila diwajibkan) → tidak bisa mengubah data
 * Endpoint login, penagihan, dan panel admin dikecualikan (@AllowWhenLocked).
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_LOCKED, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    if (READ.has(req.method)) return true;
    const user: AuthUser | undefined = req.user;
    if (!user) return true;
    if (user.emailVerified === false && verificationRequired(this.mail)) {
      throw new HttpException(
        { statusCode: 403, code: 'EMAIL_UNVERIFIED', message: 'Verifikasi email Anda dulu (cek kotak masuk) sebelum mengubah data.' },
        HttpStatus.FORBIDDEN,
      );
    }
    const st = await this.subs.state(user.tenantId);
    if (st.readOnly) {
      const why =
        st.status === 'SUSPENDED'
          ? 'Akun perusahaan sedang ditangguhkan.'
          : st.status === 'CANCELLED'
            ? 'Langganan sudah dihentikan.'
            : st.plan && st.endsAt
              ? 'Masa aktif langganan sudah berakhir.'
              : 'Langganan tidak aktif.';
      throw new HttpException(
        { statusCode: 402, code: 'SUBSCRIPTION_INACTIVE', message: `${why} Data tetap bisa dilihat & diekspor. Perpanjang di menu Langganan untuk kembali menambah/mengubah data.` },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
