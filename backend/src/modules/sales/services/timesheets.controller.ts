import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { TimesheetService } from './timesheets.service';
import { EntriesQuery, RangeQuery } from './timesheets.shared';
import { TimeEntryDto, UpdateTimeEntryDto, IdsDto, ApproveDto, ReasonDto, TimerWhoDto, TimerStartDto, TimerDiscardDto, RateDto, BillDto } from './timesheets.dto';

@ApiTags('Lembar waktu')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
@Controller('timesheets')
export class TimesheetController {
  constructor(private readonly svc: TimesheetService) {}

  @Get('entries') list(@CurrentUser() u: AuthUser, @Query() q: EntriesQuery) { return this.svc.list(u, q); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('entries') create(@CurrentUser() u: AuthUser, @Body() dto: TimeEntryDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Put('entries/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTimeEntryDto) { return this.svc.update(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('submit') submit(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) { return this.svc.submit(u, dto.ids); }
  @Roles('ADMIN', 'FINANCE') @Post('entries/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) { return this.svc.approve(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('entries/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reject(u, id, dto); }
  @Roles('ADMIN') @Post('entries/:id/write-off') writeOff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.writeOff(u, id, dto); }

  @Get('timer') timer(@CurrentUser() u: AuthUser, @Query() q: TimerWhoDto) { return this.svc.timer(u, q.employeeId); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('timer/start') startTimer(@CurrentUser() u: AuthUser, @Body() dto: TimerStartDto) { return this.svc.startTimer(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('timer/stop') stopTimer(@CurrentUser() u: AuthUser, @Body() dto: TimerWhoDto) { return this.svc.stopTimer(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('timer/discard') discardTimer(@CurrentUser() u: AuthUser, @Body() dto: TimerDiscardDto) { return this.svc.discardTimer(u, dto); }

  @Get('rates') rates(@CurrentUser() u: AuthUser) { return this.svc.rates(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('rates') createRate(@CurrentUser() u: AuthUser, @Body() dto: RateDto) { return this.svc.createRate(u, dto); }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('unbilled') unbilled(@CurrentUser() u: AuthUser) { return this.svc.unbilled(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('bill') bill(@CurrentUser() u: AuthUser, @Body() dto: BillDto) { return this.svc.bill(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('utilization') utilization(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.utilization(u.tenantId, q); }
}
