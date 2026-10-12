import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, CreateUserDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './dto/auth.dto';
import { AllowWhenLocked, PlatformAdminGuard } from '../../common/auth/platform-admin';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth & Pengguna')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Pemilik layanan membuat tautan atur ulang sandi untuk pengguna (tanpa email) */
  @AllowWhenLocked()
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('platform-admin/users/:id/reset-link')
  resetLink(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.issueResetLink(u, id);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @Post('auth/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @Post('auth/reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @Post('auth/verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @ApiBearerAuth()
  @AllowWhenLocked()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(200)
  @Post('auth/resend-verification')
  resendVerification(@CurrentUser() u: AuthUser) {
    return this.auth.resendVerification(u);
  }

  @ApiBearerAuth()
  @AllowWhenLocked()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/change-password')
  changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(u, dto);
  }

  @ApiBearerAuth()
  @AllowWhenLocked()
  @HttpCode(200)
  @Post('auth/logout-all')
  logoutAll(@CurrentUser() u: AuthUser) {
    return this.auth.logoutAll(u);
  }

  @ApiBearerAuth()
  @Get('auth/me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('users')
  listUsers(@CurrentUser() u: AuthUser) {
    return this.auth.listUsers(u.tenantId);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('users')
  createUser(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    return this.auth.createUser(u, dto);
  }
}
