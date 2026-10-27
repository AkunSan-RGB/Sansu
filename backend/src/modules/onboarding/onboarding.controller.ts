import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked } from '../../common/auth/platform-admin';
import { OnboardingService } from './onboarding.service';
import { DismissDto, BusinessModelDto } from './onboarding.dto';

@ApiTags('Pengaturan')
@ApiBearerAuth()
@Roles('ADMIN')
@AllowWhenLocked()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u);
  }
  /** Pengaturan yang perlu diatur menurut jenis usaha + status terisi */
  @Get('setup')
  setup(@CurrentUser() u: AuthUser) {
    return this.svc.setup(u);
  }
  @HttpCode(200)
  @Post('dismiss')
  dismiss(@CurrentUser() u: AuthUser, @Body() dto: DismissDto) {
    return this.svc.dismiss(u, dto.dismissed);
  }
}

/** Model bisnis perusahaan (Dagang / Ritel / Jasa / Produksi) */
@ApiTags('Pengaturan')
@ApiBearerAuth()
@Controller('settings/business')
export class BusinessModelController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.business(u.tenantId);
  }
  @Put()
  @Roles('ADMIN')
  set(@CurrentUser() u: AuthUser, @Body() dto: BusinessModelDto) {
    return this.svc.setBusiness(u, dto);
  }
}
