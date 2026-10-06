import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ListQueryDto } from '../master-data/products/products.dto';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CreateBillDto,
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  CreateSupplierPaymentDto,
  PurchaseInvoiceQueryDto,
  PurchaseOrderQueryDto,
  UpdateSupplierDto,
} from './purchasing.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.svc.list(u.tenantId, q.q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierDto) {
    return this.svc.create(u.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.svc.update(u.tenantId, id, dto);
  }
}

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseOrderQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/confirm')
  @Roles('ADMIN', 'FINANCE')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(u, id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('purchase-invoices')
export class PurchaseInvoicesController {
  constructor(private readonly svc: PurchaseInvoicesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseInvoiceQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('reports/ap-aging')
  @Roles('ADMIN', 'FINANCE')
  apAging(@CurrentUser() u: AuthUser) {
    return this.svc.apAging(u.tenantId);
  }

  @Get('payments')
  @Roles('ADMIN', 'FINANCE')
  payments(@CurrentUser() u: AuthUser) {
    return this.svc.listPayments(u.tenantId);
  }

  @Post('payments')
  @Roles('ADMIN', 'FINANCE')
  pay(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierPaymentDto) {
    return this.svc.pay(u, dto);
  }

  @Post('bills')
  @Roles('ADMIN', 'FINANCE')
  createBill(@CurrentUser() u: AuthUser, @Body() dto: CreateBillDto) {
    return this.svc.createBill(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseInvoiceDto) {
    return this.svc.createFromOrder(u, dto);
  }
}
