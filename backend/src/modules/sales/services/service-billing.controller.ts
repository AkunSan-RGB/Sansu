import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { ServiceBillingService } from './service-billing.service';
import { CreateServiceInvoiceDto, WithholdingSlipDto, CreateProjectDto, ProjectProgressDto, UpdateProjectDto, CreateDepositDto, ApplyDepositDto } from './service-billing.dto';

@ApiTags('Penjualan — jasa')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('services')
export class ServiceBillingController {
  constructor(private readonly svc: ServiceBillingService) {}

  @Post('invoices')
  @Roles('ADMIN', 'FINANCE')
  createInvoice(@CurrentUser() u: AuthUser, @Body() dto: CreateServiceInvoiceDto) {
    return this.svc.createInvoice(u, dto);
  }

  @Put('invoices/:id/withholding-slip')
  @Roles('ADMIN', 'FINANCE')
  setSlip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WithholdingSlipDto) {
    return this.svc.setSlip(u, id, dto);
  }

  @Get('withheld')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  withheld(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    return this.svc.withheld(u.tenantId, period || new Date().getFullYear().toString());
  }

  @Get('projects')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  projects(@CurrentUser() u: AuthUser) {
    return this.svc.listProjects(u.tenantId);
  }

  @Get('projects/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  project(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getProject(u.tenantId, id);
  }

  @Post('projects')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  createProject(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) {
    return this.svc.createProject(u, dto);
  }

  @Post('projects/:id/progress')
  @Roles('ADMIN', 'FINANCE')
  progress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProjectProgressDto) {
    return this.svc.recordProgress(u, id, dto);
  }

  @Patch('projects/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  updateProject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.updateProject(u, id, dto);
  }

  @Get('deposits')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  deposits(@CurrentUser() u: AuthUser, @Query('customerId') customerId?: string, @Query('open') open?: string) {
    return this.svc.listDeposits(u.tenantId, {
      customerId: customerId || undefined,
      open: open === '1' || open === 'true',
    });
  }

  @Post('deposits')
  @Roles('ADMIN', 'FINANCE')
  createDeposit(@CurrentUser() u: AuthUser, @Body() dto: CreateDepositDto) {
    return this.svc.createDeposit(u, dto);
  }

  @Post('deposits/:id/apply')
  @Roles('ADMIN', 'FINANCE')
  apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyDepositDto) {
    return this.svc.applyDeposit(u, id, dto);
  }
}
