import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AdjustmentDto, DecideAdjustmentDto, RejectAdjustmentDto } from './adjustments.dto';
import { AdjustmentsService } from './adjustments.service';

@ApiTags('Layanan air — koreksi tagihan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/adjustments')
export class AdjustmentsController {
  constructor(private readonly svc: AdjustmentsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.tenantId, status); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get('invoices') invoices(@CurrentUser() u: AuthUser, @Query('q') q = '') { return this.svc.invoices(u.tenantId, q); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post() request(@CurrentUser() u: AuthUser, @Body() dto: AdjustmentDto) { return this.svc.request(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideAdjustmentDto) { return this.svc.approve(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectAdjustmentDto) { return this.svc.reject(u, id, dto); }
}
