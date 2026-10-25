import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { ConsignmentsService } from './consignments.service';
import { DocQueryDto, ShipDto, ReportSoldDto, RejectDto, ReturnConsignDto } from './consignments.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('consignments')
export class ConsignmentsController {
  constructor(private readonly svc: ConsignmentsService) {}

  @Get('stock')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  stock(@CurrentUser() u: AuthUser) {
    return this.svc.stockReport(u.tenantId, u.role);
  }
  @Get('docs')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  docs(@CurrentUser() u: AuthUser, @Query() q: DocQueryDto) {
    return this.svc.docs(u.tenantId, q.customerId);
  }
  @Post('ship')
  @Roles('ADMIN', 'WAREHOUSE')
  ship(@CurrentUser() u: AuthUser, @Body() dto: ShipDto) {
    return this.svc.ship(u, dto);
  }
  @Post('reports')
  @Roles('ADMIN', 'SALES')
  report(@CurrentUser() u: AuthUser, @Body() dto: ReportSoldDto) {
    return this.svc.report(u, dto);
  }
  @Post('reports/:id/invoice')
  @Roles('ADMIN', 'FINANCE')
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoice(u, id);
  }
  @Post('reports/:id/reject')
  @Roles('ADMIN', 'FINANCE')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.svc.reject(u, id, dto.reason);
  }
  @Post('return')
  @Roles('ADMIN', 'WAREHOUSE')
  pullBack(@CurrentUser() u: AuthUser, @Body() dto: ReturnConsignDto) {
    return this.svc.pullBack(u, dto);
  }
}
