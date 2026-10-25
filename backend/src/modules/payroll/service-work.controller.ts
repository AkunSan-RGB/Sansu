import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { todayJakarta } from '../../common/utils/dates';
import { ServiceWorkService } from './service-work.service';
import { CreateRateDto, UpdateRateDto, EntryQueryDto, CreateEntryDto, DecideEntryDto, VoidEntryDto } from './service-work.dto';
import { PERIOD } from './service-work.shared';

@ApiTags('Penggajian — jasa')
@ApiBearerAuth()
@RequireApp('payroll')
@Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('payroll/service')
export class ServiceWorkController {
  constructor(private readonly svc: ServiceWorkService) {}

  @Get('staff')
  staff(@CurrentUser() u: AuthUser) {
    return this.svc.staff(u);
  }
  @Get('profile')
  profile(@CurrentUser() u: AuthUser) {
    return this.svc.profile(u);
  }
  @Get('rates')
  rates(@CurrentUser() u: AuthUser) {
    return this.svc.listRates(u);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('rates')
  createRate(@CurrentUser() u: AuthUser, @Body() dto: CreateRateDto) {
    return this.svc.createRate(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Patch('rates/:id')
  updateRate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRateDto) {
    return this.svc.updateRate(u, id, dto);
  }
  @Get('entries')
  entries(@CurrentUser() u: AuthUser, @Query() q: EntryQueryDto) {
    return this.svc.list(u, q);
  }
  @Get('production-orders')
  productionOrders(@CurrentUser() u: AuthUser) {
    return this.svc.productionOrdersForPay(u);
  }
  @Get('commissionable-invoices')
  invoices(@CurrentUser() u: AuthUser) {
    return this.svc.commissionableInvoices(u);
  }
  @Get('anomalies')
  anomalies(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    return this.svc.anomalies(u, period && PERIOD.test(period) ? period : todayJakarta().slice(0, 7));
  }
  @Roles('HR')
  @Post('entries')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEntryDto) {
    return this.svc.create(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('entries/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideEntryDto) {
    return this.svc.approve(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post('entries/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidEntryDto) {
    return this.svc.reject(u, id, dto);
  }
  @Roles('HR', 'FINANCE', 'ADMIN')
  @Post('entries/:id/void')
  voidIt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidEntryDto) {
    return this.svc.voidIt(u, id, dto);
  }
}
