import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SupplierAdvancesService } from './supplier-advances.service';
import { AdvanceQueryDto, CreateSupplierAdvanceDto, ApplySupplierAdvanceDto, RefundSupplierAdvanceDto, VoidSupplierAdvanceDto } from './supplier-advances.dto';

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('supplier-advances')
export class SupplierAdvancesController {
  constructor(private readonly svc: SupplierAdvancesService) {}

  @Get() @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query() q: AdvanceQueryDto) {
    return this.svc.list(u.tenantId, q);
  }
  @Get('summary') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING')
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u.tenantId);
  }
  @Get('controls') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Get(':id') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Post() @Roles('ADMIN', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierAdvanceDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id/apply') @Roles('ADMIN', 'FINANCE')
  apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplySupplierAdvanceDto) {
    return this.svc.apply(u, id, dto);
  }
  @Post(':id/refund') @Roles('ADMIN', 'FINANCE')
  refund(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundSupplierAdvanceDto) {
    return this.svc.refund(u, id, dto);
  }
  @Post(':id/void') @Roles('ADMIN')
  void(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSupplierAdvanceDto) {
    return this.svc.void(u, id, dto.reason);
  }
}
