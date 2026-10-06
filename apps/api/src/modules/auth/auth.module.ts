import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginLimiter } from './login-limiter';
import { TenantSetupService } from './tenant-setup.service';
import { SecuritySettingsController, TwoFactorController, TwoFactorService } from './two-factor';

@Module({
  controllers: [AuthController, TwoFactorController, SecuritySettingsController],
  providers: [AuthService, TenantSetupService, LoginLimiter, TwoFactorService],
  exports: [TenantSetupService],
})
export class AuthModule {}
