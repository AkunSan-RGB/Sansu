import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ListQueryDto } from '../master-data/products/products.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CancelGoodsReceiptDto,
  CreateBillDto,
  CreateGoodsReceiptDto,
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  CreateSupplierPaymentDto,
  PurchaseInvoiceQueryDto,
  PriceHistoryQueryDto,
  PurchaseOrderQueryDto,
  QuickPurchaseDto,
  UpdateSupplierDto,
} from './purchasing.dto';
import { PurchaseRequestsService } from './purchase-requests.service';
import { ConvertPurchaseRequestDto, CreatePurchaseRequestDto, DecisionNoteDto, PurchaseRequestQueryDto, SuggestionQueryDto } from './purchase-requests.dto';
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
  constructor(
    private readonly svc: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseOrderQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  /** Riwayat harga beli aktual per produk (untuk menilai penawaran supplier) */
  @Get('price-history')
  priceHistory(@CurrentUser() u: AuthUser, @Query() q: PriceHistoryQueryDto) {
    return this.svc.priceHistory(u.tenantId, q.productIds.split(','));
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  /** Pembelian cepat atas penawaran supplier: buat + konfirmasi (+ terima barang bila sudah tiba) dalam satu langkah */
  @Post('quick')
  @Roles('ADMIN', 'FINANCE')
  async quick(@CurrentUser() u: AuthUser, @Body() dto: QuickPurchaseDto) {
    const { receiveNow, ...po } = dto;
    const out = await this.svc.quick(u, po);
    if (receiveNow && !out.approvalPending) {
      await this.receipts.receive(u, out.id, { date: dto.date });
      return { ...(await this.svc.get(u.tenantId, out.id)), approvalPending: false, approvalMessage: null as string | null };
    }
    return out;
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

  /** Terima barang atas pesanan (bisa bertahap) */
  @Post(':id/receipts')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateGoodsReceiptDto) {
    return this.receipts.receive(u, id, dto);
  }
}

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly svc: GoodsReceiptsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('purchaseOrderId') purchaseOrderId?: string) {
    return this.svc.list(u.tenantId, { from, to, purchaseOrderId });
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelGoodsReceiptDto) {
    return this.svc.cancel(u, id, dto);
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

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly svc: PurchaseRequestsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseRequestQueryDto) {
    return this.svc.list(u.tenantId, q.status);
  }

  /** Usulan dari stok minimum (produk yang perlu dipesan) */
  @Get('suggestions')
  suggestions(@CurrentUser() u: AuthUser, @Query() q: SuggestionQueryDto) {
    return this.svc.suggestions(u.tenantId, q.warehouseId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseRequestDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/submit')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submit(u, id);
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionNoteDto) {
    return this.svc.decide(u, id, true, dto.note);
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionNoteDto) {
    return this.svc.decide(u, id, false, dto.note);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }

  /** Jadikan PO draft per supplier */
  @Post(':id/convert')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertPurchaseRequestDto) {
    return this.svc.convert(u, id, dto);
  }
}
