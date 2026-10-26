import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { UtilityChargesService } from './utility-charges.service';
import { ChargeDto, IssueChargeDto } from './utility-charges.dto';
import { CloseDayDto, CounterDto } from './utility-counters.dto';
import { UtilityCountersService } from './utility-counters.service';

@ApiTags('Layanan utilitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('utility')
export class UtilityCountersController {
  constructor(
    private readonly counters: UtilityCountersService,
    private readonly charges: UtilityChargesService,
  ) {}

  // ---- Loket
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES', 'CASHIER') @Get('counters') listCounters(@CurrentUser() u: AuthUser) { return this.counters.list(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('counters') createCounter(@CurrentUser() u: AuthUser, @Body() dto: CounterDto) { return this.counters.save(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Put('counters/:id') updateCounter(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CounterDto) { return this.counters.save(u, dto, id); }
  @Get('counter/recap') recap(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.counters.recap(u.tenantId, from, to); }
  @Get('counter/day') day(@CurrentUser() u: AuthUser, @Query('date') date: string, @Query('counterId') counterId?: string) { return this.counters.dayDetail(u.tenantId, date, counterId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Post('counter/close-day') closeDay(@CurrentUser() u: AuthUser, @Body() dto: CloseDayDto) { return this.counters.closeDay(u, dto); }

  // ---- Layanan non-air
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES') @Get('charges') listCharges(@CurrentUser() u: AuthUser) { return this.charges.list(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES') @Get('charges/recent') recentCharges(@CurrentUser() u: AuthUser) { return this.charges.recent(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('charges') createCharge(@CurrentUser() u: AuthUser, @Body() dto: ChargeDto) { return this.charges.save(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Put('charges/:id') updateCharge(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChargeDto) { return this.charges.save(u, dto, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('charges/issue') issueCharge(@CurrentUser() u: AuthUser, @Body() dto: IssueChargeDto) { return this.charges.issue(u, dto); }
}
