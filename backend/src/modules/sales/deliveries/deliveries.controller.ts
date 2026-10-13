import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { DeliveriesService } from './deliveries.service';

class DeliverDto {
  @ApiPropertyOptional({ example: '2026-10-06', description: 'Tanggal kirim (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
class CancelDeliveryDto {
  @ApiPropertyOptional({ description: 'Tanggal pembatalan (bawaan: hari ini)' }) @IsOptional() @IsDateString() date?: string;
}
class DeliveryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller()
export class DeliveriesController {
  constructor(private readonly svc: DeliveriesService) {}

  /** Kirim barang atas pesanan terkonfirmasi: buat surat jalan, stok keluar, HPP dijurnal */
  @Post('sales-orders/:id/deliver')
  @Roles('ADMIN', 'WAREHOUSE')
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) {
    return this.svc.deliver(u, id, dto);
  }

  @Get('deliveries')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  list(@CurrentUser() u: AuthUser, @Query() q: DeliveryQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('deliveries/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post('deliveries/:id/cancel')
  @Roles('ADMIN', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    return this.svc.cancel(u, id, dto);
  }

  /** Jejak dokumen dari pesanan: penawaran → pesanan → surat jalan → faktur → pembayaran → jurnal */
  @Get('sales-orders/:id/chain')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  orderChain(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.chain(u.tenantId, { orderId: id });
  }

  @Get('invoices/:id/chain')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE')
  invoiceChain(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.chain(u.tenantId, { invoiceId: id });
  }
}
