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
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: InvoiceQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('reports/ar-aging')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  arAging(@CurrentUser() u: AuthUser) {
    return this.svc.arAging(u.tenantId);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateInvoiceDto) {
    // Pencocokan tiga arah: faktur hanya atas barang yang sudah dikirim Gudang; jalur "kirim sekaligus faktur" hanya Pemilik/Admin
    await this.svc.assertDeliveredBeforeInvoice(u, dto.salesOrderId);
    return this.svc.createFromOrder(u, dto);
  }
}
