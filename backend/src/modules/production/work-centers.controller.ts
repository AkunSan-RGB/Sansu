import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { WorkCenterService } from './work-centers.service';
import { WorkCenterDto, ShiftsDto, DowntimeDto, BomOpsDto, ScheduleDto, FinishOpDto, CorrectOpDto } from './work-centers.dto';
import { RangeQuery } from './work-centers.shared';

@ApiTags('Pusat kerja & jadwal mesin')
@ApiBearerAuth()
@RequireApp('inventory')
@Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
@Controller('production')
export class WorkCenterController {
  constructor(private readonly svc: WorkCenterService) {}

  @Get('work-centers') list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Roles('ADMIN') @Post('work-centers') create(@CurrentUser() u: AuthUser, @Body() dto: WorkCenterDto) { return this.svc.save(u, dto); }
  @Roles('ADMIN') @Put('work-centers/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkCenterDto) { return this.svc.save(u, dto, id); }
  @Get('work-centers/:id/shifts') shifts(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.shifts(u.tenantId, id); }
  @Roles('ADMIN') @Put('work-centers/:id/shifts') setShifts(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShiftsDto) { return this.svc.setShifts(u, id, dto); }
  @Get('work-centers/:id/downtime') downtimes(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.downtimes(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('work-centers/:id/downtime') addDowntime(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DowntimeDto) { return this.svc.addDowntime(u, id, dto); }

  @Get('boms/:id/operations') bomOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.bomOperations(u.tenantId, id); }
  @Roles('ADMIN') @Put('boms/:id/operations') setBomOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BomOpsDto) { return this.svc.setBomOperations(u, id, dto); }

  @Get('orders/:id/operations') orderOps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.orderOperations(u.tenantId, id); }
  @Get('orders/:id/costing') costing(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.costing(u.tenantId, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/schedule') schedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto) { return this.svc.schedule(u, id, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/unschedule') unschedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.unschedule(u, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/start') start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.startOp(u, id); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('operations/:id/finish') finish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FinishOpDto) { return this.svc.finishOp(u, id, dto); }
  @Roles('ADMIN') @Post('operations/:id/correct') correct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectOpDto) { return this.svc.correctOp(u, id, dto); }

  @Get('schedule') plan(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.schedulePlan(u.tenantId, q); }
  @Get('schedule/controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
  @Get('work-centers-utilization') utilization(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.utilization(u.tenantId, q); }
}
