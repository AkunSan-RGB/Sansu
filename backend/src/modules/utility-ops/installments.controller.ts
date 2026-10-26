import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CancelPlanDto, DecidePlanDto, InstallmentPlanDto } from './installments.dto';
import { InstallmentsService } from './installments.service';

@ApiTags('Layanan air — angsuran tunggakan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/installments')
export class InstallmentsController {
  constructor(private readonly svc: InstallmentsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.tenantId, status); }
  @Get('coverable/:connectionId') coverable(@CurrentUser() u: AuthUser, @Param('connectionId', ParseUUIDPipe) connectionId: string) { return this.svc.coverable(u.tenantId, connectionId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post() request(@CurrentUser() u: AuthUser, @Body() dto: InstallmentPlanDto) { return this.svc.request(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidePlanDto) { return this.svc.approve(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPlanDto) { return this.svc.cancel(u, id, dto); }
}
