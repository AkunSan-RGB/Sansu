import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequireApp } from '../../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreateSalesOrderDto, SalesOrderQueryDto } from '../sales.dto';
import { SalesOrdersService } from './sales-orders.service';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly svc: SalesOrdersService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  list(@CurrentUser() u: AuthUser, @Query() q: SalesOrderQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'SALES')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSalesOrderDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/confirm')
  @Roles('ADMIN', 'SALES', 'FINANCE')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(u, id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}
