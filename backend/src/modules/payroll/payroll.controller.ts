import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { yearQuery } from '../../common/pipes/year.pipe';
import { PayrollService } from './payroll.service';
import { CreateRunDto, PayRunDto, UpdatePayslipDto } from './payroll.dto';

@ApiTags('Penggajian')
@ApiBearerAuth()
@RequireApp('payroll')
@Roles('HR', 'FINANCE', 'ACCOUNTANT')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly svc: PayrollService) {}

  @Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
  @Get('runs')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.listRuns(u.tenantId);
  }
  @Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
  @Get('runs/:id')
  run(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRun(u.tenantId, id);
  }
  @Roles('HR')
  @Post('runs')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateRunDto) {
    return this.svc.createRun(u, dto);
  }
  @Roles('HR')
  @Post('runs/:id/recompute')
  recompute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recompute(u, id);
  }
  @Roles('HR')
  @Post('runs/:id/delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRun(u, id);
  }
  @Roles('ACCOUNTANT', 'ADMIN')
  @Post('runs/:id/post')
  post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.post(u, id);
  }
  @Roles('FINANCE')
  @Post('runs/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayRunDto) {
    return this.svc.pay(u, id, dto);
  }
  @Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
  @Get('payslips/:id')
  payslip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPayslip(u.tenantId, id);
  }
  @Roles('HR')
  @Patch('payslips/:id')
  updatePayslip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayslipDto) {
    return this.svc.updatePayslip(u, id, dto);
  }
  @Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
  @Get('reports/bpjs')
  bpjs(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);
    return this.svc.bpjsReport(u.tenantId, p);
  }
  @Roles('HR', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
  @Get('reports/pph21')
  pph21(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.pph21Report(u.tenantId, yearQuery(year, new Date().getFullYear()));
  }
}
