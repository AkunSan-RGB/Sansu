import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CalibrateDto, MeterDto, MeterStatusDto, ReplaceMeterDto } from './meters.dto';
import { MetersService } from './meters.service';

@ApiTags('Layanan air — inventaris meter')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
@Controller('utility/meters')
export class MetersController {
  constructor(private readonly svc: MetersService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('q') q?: string, @Query('due') due?: string) { return this.svc.list(u.tenantId, { status, q, due }); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post() register(@CurrentUser() u: AuthUser, @Body() dto: MeterDto) { return this.svc.register(u, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('sync') sync(@CurrentUser() u: AuthUser) { return this.svc.sync(u); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('replace') replace(@CurrentUser() u: AuthUser, @Body() dto: ReplaceMeterDto) { return this.svc.replace(u, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post(':id/calibrate') calibrate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CalibrateDto) { return this.svc.calibrate(u, id, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post(':id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MeterStatusDto) { return this.svc.setStatus(u, id, dto); }
}
