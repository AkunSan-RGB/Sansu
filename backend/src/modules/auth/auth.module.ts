import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginLimiter } from './login-limiter';
import { TenantSetupService } from './tenant-setup.service';
import { SecuritySettingsController, TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { AuthRepository } from './auth.repository';
import { TenantSetupRepository } from './tenant-setup.repository';
import { TwoFactorRepository } from './two-factor.repository';

@Module({
  controllers: [AuthController, TwoFactorController, SecuritySettingsController],
  providers: [TwoFactorRepository, TenantSetupRepository, AuthRepository, AuthService, TenantSetupService, LoginLimiter, TwoFactorService],
  exports: [TenantSetupService],
})
export class AuthModule {}
