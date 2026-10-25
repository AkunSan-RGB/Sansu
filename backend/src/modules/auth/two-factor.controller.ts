import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked } from '../../common/auth/platform-admin';
import { TwoFactorPolicy } from '../../common/auth/two-factor-policy';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorLoginDto, TwoFactorCodeDto, TwoFactorDisableDto, SecuritySettingsDto } from './two-factor.dto';

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
