import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { newBackupCodes, newTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from '../../common/auth/totp';
import { TwoFactorPolicy } from '../../common/auth/two-factor-policy';
import { MailService } from '../../common/mail/mail.service';
import { decrypt, encrypt, sha256 } from '../../common/utils/secret';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';
import { AuthService } from './auth.service';
import { TwoFactorDisableDto } from './two-factor.dto';
import { patchById } from '../../db/owned';

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly auth: AuthService,
    private readonly policy: TwoFactorPolicy,
    private readonly mail: MailService,
  ) {}

  private async user(id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new BadRequestException('Pengguna tidak ditemukan');
    return u;
  }

  async status(a: AuthUser) {
    const u = await this.user(a.sub);
    return {
      enabled: !!u.totpEnabledAt,
      enabledAt: u.totpEnabledAt,
      backupCodesLeft: u.totpBackupCodes?.length ?? 0,
      required: await this.policy.requiredFor(a.tenantId, u.role),
    };
  }

  /** Langkah 1: buat rahasia baru (belum aktif sampai kode pertama dikonfirmasi) */
  async setup(a: AuthUser) {
    const u = await this.user(a.sub);
    if (u.totpEnabledAt) throw new BadRequestException('Verifikasi 2 langkah sudah aktif');
    const secret = newTotpSecret();
    await patchById(this.db, users, u.id, { totpSecret: encrypt(secret) });
    return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
  }

  /** Langkah 2: konfirmasi kode dari aplikasi → aktif + kode cadangan */
  async enable(a: AuthUser, code: string) {
    const u = await this.user(a.sub);
    if (u.totpEnabledAt) throw new BadRequestException('Verifikasi 2 langkah sudah aktif');
    if (!u.totpSecret) throw new BadRequestException('Mulai pengaturan dulu');
    if (!verifyTotp(decrypt(u.totpSecret), code))
      throw new BadRequestException('Kode salah. Pastikan jam di HP Anda tepat lalu coba kode terbaru.');
    const codes = newBackupCodes();
    await patchById(this.db, users, u.id, { totpEnabledAt: new Date(), totpBackupCodes: codes.map((c) => sha256(normalizeBackupCode(c))) });
    await this.mail.send({
      to: u.email,
      subject: 'Verifikasi 2 langkah SANSU aktif',
      heading: 'Verifikasi 2 langkah aktif',
      paragraphs: [
        `Halo ${u.name},`,
        'Mulai sekarang, setiap kali masuk Anda diminta kode dari aplikasi authenticator di HP.',
        'Simpan kode cadangan di tempat aman. Jika bukan Anda yang mengaktifkannya, segera hubungi admin perusahaan.',
      ],
    });
    return { backupCodes: codes };
  }

  async disable(a: AuthUser, dto: TwoFactorDisableDto) {
    const u = await this.user(a.sub);
    if (!u.totpEnabledAt) throw new BadRequestException('Verifikasi 2 langkah belum aktif');
    if (await this.policy.requiredFor(a.tenantId, u.role))
      throw new ForbiddenException('Perusahaan Anda mewajibkan verifikasi 2 langkah, jadi tidak bisa dimatikan.');
    if (!(await bcrypt.compare(dto.password, u.passwordHash))) throw new BadRequestException('Kata sandi salah');
    if (!(await this.auth.checkSecondFactor(u, dto.code))) throw new BadRequestException('Kode verifikasi salah');
    await patchById(this.db, users, u.id, { totpEnabledAt: null, totpSecret: null, totpBackupCodes: null });
    await this.mail.send({
      to: u.email,
      subject: 'Verifikasi 2 langkah SANSU dimatikan',
      heading: 'Verifikasi 2 langkah dimatikan',
      paragraphs: [
        `Halo ${u.name},`,
        'Verifikasi 2 langkah di akun SANSU Anda baru saja dimatikan.',
        'Jika bukan Anda yang melakukannya, segera ganti kata sandi dan hubungi admin perusahaan.',
      ],
    });
    return { ok: true };
  }

  async regenerate(a: AuthUser, code: string) {
    const u = await this.user(a.sub);
    if (!u.totpEnabledAt || !u.totpSecret) throw new BadRequestException('Verifikasi 2 langkah belum aktif');
    if (!verifyTotp(decrypt(u.totpSecret), code)) throw new BadRequestException('Kode verifikasi salah');
    const codes = newBackupCodes();
    await patchById(this.db, users, u.id, { totpBackupCodes: codes.map((c) => sha256(normalizeBackupCode(c))) });
    return { backupCodes: codes };
  }
}
