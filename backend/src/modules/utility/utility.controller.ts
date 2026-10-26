import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { UtilityService } from './utility.service';
import { RulesDto, TariffDto, ConnectionDto, SuspendDto, ReasonDto, ZoneSupplyDto, ZoneDto, ReadingDto, VerifyDto, BillRunDto } from './utility.dto';

@ApiTags('Layanan utilitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility')
export class UtilityController {
  constructor(private readonly svc: UtilityService) {}

  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES', 'CASHIER') @Get('rules') rules(@CurrentUser() u: AuthUser) { return this.svc.rules(u.tenantId); }
  @Roles('ADMIN') @Put('rules') saveRules(@CurrentUser() u: AuthUser, @Body() dto: RulesDto) { return this.svc.saveRules(u, dto); }

  @Get('tariffs') tariffs(@CurrentUser() u: AuthUser) { return this.svc.tariffs(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('tariffs') createTariff(@CurrentUser() u: AuthUser, @Body() dto: TariffDto) { return this.svc.createTariff(u, dto); }
  @Roles('ADMIN') @Put('tariffs/:id') updateTariff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TariffDto) { return this.svc.updateTariff(u, id, dto); }

  @Get('connections') connections(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('search') search?: string) { return this.svc.connections(u.tenantId, { status, search }); }
  @Get('connections/:id') connection(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.connection(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('connections') createConnection(@CurrentUser() u: AuthUser, @Body() dto: ConnectionDto) { return this.svc.createConnection(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('connections/:id/suspend') suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDto) { return this.svc.suspend(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('connections/:id/reconnect') reconnect(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reconnect(u, id, dto); }
  @Roles('ADMIN') @Post('connections/:id/disconnect') disconnect(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.disconnect(u, id, dto); }

  @Get('zones') zones(@CurrentUser() u: AuthUser, @Query('period') period?: string) { return this.svc.zones(u.tenantId, period); }
  @Roles('ADMIN', 'FINANCE') @Put('zones/supply') saveSupply(@CurrentUser() u: AuthUser, @Body() dto: ZoneSupplyDto) { return this.svc.saveSupply(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Put('connections/:id/zone') setZone(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ZoneDto) { return this.svc.setZone(u, id, dto); }

  @Get('readings') readings(@CurrentUser() u: AuthUser, @Query('period') period?: string, @Query('status') status?: string, @Query('connectionId') connectionId?: string) { return this.svc.readings(u.tenantId, { period, status, connectionId }); }
  @Get('readings/due') due(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.due(u.tenantId, period); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('readings') enter(@CurrentUser() u: AuthUser, @Body() dto: ReadingDto) { return this.svc.enterReading(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('readings/:id/verify') verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) { return this.svc.verify(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('readings/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reject(u, id, dto); }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('billing/preview') preview(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.svc.preview(u.tenantId, period); }
  @Roles('ADMIN', 'FINANCE') @Post('billing/run') run(@CurrentUser() u: AuthUser, @Body() dto: BillRunDto) { return this.svc.run(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('overdue') overdue(@CurrentUser() u: AuthUser) { return this.svc.overdue(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}
