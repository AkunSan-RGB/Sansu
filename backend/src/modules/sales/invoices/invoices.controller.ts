import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequireApp } from '../../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreateInvoiceDto, InvoiceQueryDto } from '../sales.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES')
  list(@CurrentUser() u: AuthUser, @Query() q: InvoiceQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('reports/ar-aging')
  @Roles('ADMIN', 'FINANCE')
  arAging(@CurrentUser() u: AuthUser) {
    return this.svc.arAging(u.tenantId);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.svc.createFromOrder(u, dto);
  }
}
