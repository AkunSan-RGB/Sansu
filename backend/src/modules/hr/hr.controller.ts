import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { toDocDate } from '../../common/utils/dates';
import { HrService } from './hr.service';
import { LinkAccountDto, CreateEmployeeDto, UpdateEmployeeDto, SaveAttendanceDto, CreateLeaveDto, DecideLeaveDto } from './hr.dto';

@ApiTags('SDM')
@ApiBearerAuth()
@RequireApp('hr')
@Roles('HR')
@Controller('hr')
export class HrController {
  constructor(private readonly svc: HrService) {}

  @Get('employees')
  @Roles('HR', 'FINANCE', 'ACCOUNTANT')
  employees(@CurrentUser() u: AuthUser, @Query('active') active?: string) {
    return this.svc.listEmployees(u.tenantId, active === '1');
  }
  @Get('employees/:id')
  @Roles('HR', 'FINANCE', 'ACCOUNTANT')
  employee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getEmployee(u.tenantId, id);
  }
  @Get('employee-accounts')
  accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.tenantId);
  }
  @Put('employees/:id/account')
  linkAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkAccountDto) {
    return this.svc.linkAccount(u, id, dto);
  }
  @Post('employees')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.svc.createEmployee(u, dto);
  }
  @Patch('employees/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.svc.updateEmployee(u, id, dto);
  }

  @Get('attendance')
  day(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    return this.svc.attendanceDay(u.tenantId, toDocDate(date));
  }
  @Post('attendance')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveAttendanceDto) {
    return this.svc.saveAttendance(u, dto);
  }
  @Get('attendance/month')
  month(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? period : toDocDate().slice(0, 7);
    return this.svc.attendanceMonth(u.tenantId, p);
  }

  @Get('leaves')
  leaves(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.listLeaves(u.tenantId, status);
  }
  @Post('leaves')
  createLeave(@CurrentUser() u: AuthUser, @Body() dto: CreateLeaveDto) {
    return this.svc.createLeave(u, dto);
  }
  @Post('leaves/:id/decide')
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto) {
    return this.svc.decideLeave(u, id, dto);
  }
}
