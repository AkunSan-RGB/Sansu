import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked } from '../../common/auth/platform-admin';
import { newBackupCodes, newTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from '../../common/auth/totp';
import { TwoFactorPolicy, type TwoFactorRequirement } from '../../common/auth/two-factor-policy';
import { MailService } from '../../common/mail/mail.service';
import { decrypt, encrypt, sha256 } from '../../common/utils/secret';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';
import { AuthService } from './auth.service';

export class TwoFactorLoginDto {
  @ApiProperty() @IsString() @MaxLength(1000) challenge: string;
  @ApiProperty({ example: '123456', description: 'Kode 6 digit atau kode cadangan' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code: string;
}
export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' }) @IsString() @MinLength(6) @MaxLength(20) code: string;
}
export class TwoFactorDisableDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(20) code: string;
}
export class SecuritySettingsDto {
  @ApiProperty({ enum: ['NONE', 'ADMINS', 'ALL'] }) @IsIn(['NONE', 'ADMINS', 'ALL']) require2fa: TwoFactorRequirement;
}

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
    await this.db
      .update(users)
      .set({ totpSecret: encrypt(secret) })
      .where(eq(users.id, u.id));
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
    await this.db
      .update(users)
      .set({ totpEnabledAt: new Date(), totpBackupCodes: codes.map((c) => sha256(normalizeBackupCode(c))) })
      .where(eq(users.id, u.id));
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
    await this.db
      .update(users)
      .set({ totpEnabledAt: null, totpSecret: null, totpBackupCodes: null })
      .where(eq(users.id, u.id));
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
    await this.db
      .update(users)
      .set({ totpBackupCodes: codes.map((c) => sha256(normalizeBackupCode(c))) })
      .where(eq(users.id, u.id));
    return { backupCodes: codes };
  }
}

@ApiTags('Auth & Pengguna')
@Controller('auth')
export class TwoFactorController {
  constructor(
    private readonly svc: TwoFactorService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/login')
  login(@Body() dto: TwoFactorLoginDto) {
    return this.auth.loginTwoFactor(dto.challenge, dto.code);
  }

  @ApiBearerAuth()
  @AllowWhenLocked()
  @Get('2fa')
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u);
  }
  @ApiBearerAuth()
  @AllowWhenLocked()
  @HttpCode(200)
  @Post('2fa/setup')
  setup(@CurrentUser() u: AuthUser) {
    return this.svc.setup(u);
  }
  @ApiBearerAuth()
  @AllowWhenLocked()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/enable')
  enable(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorCodeDto) {
    return this.svc.enable(u, dto.code);
  }
  @ApiBearerAuth()
  @AllowWhenLocked()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/disable')
  disable(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorDisableDto) {
    return this.svc.disable(u, dto);
  }
  @ApiBearerAuth()
  @AllowWhenLocked()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/backup-codes')
  regenerate(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorCodeDto) {
    return this.svc.regenerate(u, dto.code);
  }
}

/** Kebijakan keamanan perusahaan (wajib 2FA) */
@ApiTags('Pengaturan')
@ApiBearerAuth()
@Controller('settings/security')
export class SecuritySettingsController {
  constructor(
    private readonly policy: TwoFactorPolicy,
    private readonly svc: TwoFactorService,
  ) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.policy.get(u.tenantId);
  }
  @Put()
  @Roles('OWNER')
  async save(@CurrentUser() u: AuthUser, @Body() dto: SecuritySettingsDto) {
    if (dto.require2fa !== 'NONE' && !(await this.svc.status(u)).enabled) {
      throw new BadRequestException('Aktifkan verifikasi 2 langkah di akun Anda sendiri dulu sebelum mewajibkannya.');
    }
    return this.policy.save(u.tenantId, dto);
  }
}
