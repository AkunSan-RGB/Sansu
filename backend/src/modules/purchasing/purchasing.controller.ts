import { CancelPurchaseOrderDto } from './purchasing.dto';
import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
  PriceVarianceQueryDto,
  PurchaseInvoiceQueryDto,
  PriceHistoryQueryDto,
  PurchaseOrderQueryDto,
  QuickPurchaseDto,
  UpdateSupplierDto,
  VoidSupplierPaymentDto,
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
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.svc.list(u.tenantId, q.q);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierDto) {
    this.svc.assertCanSetPreferred(u, dto);
    return this.svc.create(u, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    this.svc.assertCanSetPreferred(u, dto);
    return this.svc.update(u, id, dto);
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
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseOrderQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  /** Riwayat harga beli aktual per produk (untuk menilai penawaran supplier) */
  @Get('price-history')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING')
  priceHistory(@CurrentUser() u: AuthUser, @Query() q: PriceHistoryQueryDto) {
    return this.svc.priceHistory(u.tenantId, q.productIds.split(','));
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id).then((po) => this.svc.forViewer(u, po as never));
  }

  /** Pembelian cepat atas penawaran supplier: buat + konfirmasi (+ terima barang bila sudah tiba) dalam satu langkah */
  @Post('quick')
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  async quick(@CurrentUser() u: AuthUser, @Body() dto: QuickPurchaseDto) {
    const { receiveNow, ...po } = dto;
    // Pemisahan fungsi: yang memesan/menagih (Keuangan) tidak menerima barang sendiri
    if (receiveNow && !['OWNER', 'ADMIN', 'WAREHOUSE'].includes(u.role)) {
      throw new ForbiddenException('Penerimaan barang dilakukan oleh Gudang atau Admin. Buat pesanan tanpa "barang sudah tiba", lalu minta Gudang menerimanya');
    }
    const out = await this.svc.quick(u, po);
    if (receiveNow && !out.approvalPending) {
      await this.receipts.receive(u, out.id, { date: dto.date });
      return { ...(await this.svc.get(u.tenantId, out.id)), approvalPending: false, approvalMessage: null as string | null };
    }
    return out;
  }

  @Post()
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/confirm')
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(u, id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPurchaseOrderDto) {
    return this.svc.cancel(u, id, dto?.reason);
  }

  /** Terima barang atas pesanan (bisa bertahap) */
  @Post(':id/receipts')
  @Roles('ADMIN', 'WAREHOUSE')
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
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('purchaseOrderId') purchaseOrderId?: string) {
    return this.svc.list(u.tenantId, { from, to, purchaseOrderId });
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
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
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseInvoiceQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('reports/ap-aging')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  apAging(@CurrentUser() u: AuthUser) {
    return this.svc.apAging(u.tenantId);
  }

  /** Laporan selisih harga faktur vs PO + penanda untuk ditinjau (anti-fraud) */
  @Get('reports/price-variances')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  priceVariances(@CurrentUser() u: AuthUser, @Query() q: PriceVarianceQueryDto) {
    return this.svc.priceVarianceReport(u.tenantId, q.from, q.to);
  }

  @Get('payments')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  payments(@CurrentUser() u: AuthUser) {
    return this.svc.listPayments(u.tenantId);
  }

  @Post('payments')
  @Roles('ADMIN', 'FINANCE')
  pay(@CurrentUser() u: AuthUser, @Body() dto: CreateSupplierPaymentDto) {
    return this.svc.pay(u, dto);
  }

  /** Batalkan pembayaran yang salah (jurnal dibalik, hutang terbuka lagi) */
  @Post('payments/:id/void')
  @Roles('ADMIN')
  voidPayment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSupplierPaymentDto) {
    return this.svc.voidPayment(u, id, dto.reason);
  }

  @Post('bills')
  @Roles('ADMIN', 'FINANCE')
  createBill(@CurrentUser() u: AuthUser, @Body() dto: CreateBillDto) {
    return this.svc.createBill(u, dto);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'FINANCE')
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
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  list(@CurrentUser() u: AuthUser, @Query() q: PurchaseRequestQueryDto) {
    return this.svc.list(u.tenantId, q.status);
  }

  /** Usulan dari stok minimum (produk yang perlu dipesan) */
  @Get('suggestions')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  suggestions(@CurrentUser() u: AuthUser, @Query() q: SuggestionQueryDto) {
    return this.svc.suggestions(u.tenantId, q.warehouseId);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'PURCHASING')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'PURCHASING')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseRequestDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/submit')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'PURCHASING')
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
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'PURCHASING')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }

  /** Jadikan PO draft per supplier */
  @Post(':id/convert')
  @Roles('ADMIN', 'FINANCE', 'PURCHASING')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertPurchaseRequestDto) {
    return this.svc.convert(u, id, dto);
  }
}
