import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SchedulingService } from './scheduling.service';
import { ResourceDto, BookingDto, RecurringBookingDto, CancelDto, MoveDto } from './scheduling.dto';
import { BookingsQuery, SlotQuery } from './scheduling.shared';

@ApiTags('Penjadwalan')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly svc: SchedulingService) {}

  @Get('resources') resources(@CurrentUser() u: AuthUser) { return this.svc.resources(u.tenantId); }
  @Roles('ADMIN') @Post('resources') createResource(@CurrentUser() u: AuthUser, @Body() dto: ResourceDto) { return this.svc.saveResource(u, dto); }
  @Roles('ADMIN') @Put('resources/:id') updateResource(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResourceDto) { return this.svc.saveResource(u, dto, id); }

  @Get('bookings') bookings(@CurrentUser() u: AuthUser, @Query() q: BookingsQuery) { return this.svc.list(u.tenantId, q); }
  @Get('free-slots') slots(@CurrentUser() u: AuthUser, @Query() q: SlotQuery) { return this.svc.freeSlots(u.tenantId, { ...q, minutes: Number(q.minutes) }); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings') book(@CurrentUser() u: AuthUser, @Body() dto: BookingDto) { return this.svc.book(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/recurring') bookRecurring(@CurrentUser() u: AuthUser, @Body() dto: RecurringBookingDto) { return this.svc.bookRecurring(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/:id/cancel-series') cancelSeries(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancelSeries(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Put('bookings/:id') move(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDto) { return this.svc.move(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancel(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE') @Post('bookings/:id/done') done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.done(u, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('bookings/:id/time-entry') toEntry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.toTimeEntry(u, id); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
}
