import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ProductionDto, WaterQualityDto } from './production.dto';
import { ProductionService } from './production.service';

@ApiTags('Layanan air — produksi dan kualitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
@Controller('utility')
export class ProductionController {
  constructor(private readonly svc: ProductionService) {}

  @Get('production') list(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.list(u.tenantId, from, to); }
  @Get('production/sources') sources(@CurrentUser() u: AuthUser) { return this.svc.sources(u.tenantId); }
  @Get('production/summary') summary(@CurrentUser() u: AuthUser, @Query('period') period?: string) { return this.svc.summary(u.tenantId, period); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('production') save(@CurrentUser() u: AuthUser, @Body() dto: ProductionDto) { return this.svc.save(u, dto); }

  @Get('water-quality') quality(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('point') point?: string) { return this.svc.qualityList(u.tenantId, from, to, point); }
  @Get('water-quality/summary') qualitySummary(@CurrentUser() u: AuthUser) { return this.svc.qualitySummary(u.tenantId); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('water-quality') qualitySave(@CurrentUser() u: AuthUser, @Body() dto: WaterQualityDto) { return this.svc.qualitySave(u, dto); }
}
