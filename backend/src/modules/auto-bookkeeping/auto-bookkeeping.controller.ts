import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AutoBookkeepingService } from './auto-bookkeeping.service';
import { AutoBookkeepingDto } from './auto-bookkeeping.dto';

@ApiTags('accounting')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('accounting/auto')
export class AutoBookkeepingController {
  constructor(private readonly svc: AutoBookkeepingService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u.tenantId);
  }

  @Put()
  @Roles('ADMIN', 'ACCOUNTANT')
  save(@CurrentUser() u: AuthUser, @Body() dto: AutoBookkeepingDto) {
    return this.svc.save(u, dto);
  }

  /** Jalankan sekarang (biasanya berjalan sendiri tiap jam) */
  @Post('run')
  @Roles('ADMIN', 'ACCOUNTANT')
  run(@CurrentUser() u: AuthUser) {
    return this.svc.runTenant(u.tenantId);
  }
}
