import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PosService } from './pos.service';
import { todayJakarta } from '../../common/utils/dates';
import { PosProductQueryDto, OpenSessionDto, CloseSessionDto, CreatePosOrderDto, PosQuoteDto } from './pos.dto';

@ApiTags('Kasir (POS)')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
@Controller('pos')
export class PosController {
  constructor(private readonly svc: PosService) {}

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('products')
  products(@CurrentUser() u: AuthUser, @Query() q: PosProductQueryDto) {
    return this.svc.products(u.tenantId, q);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('sessions/current')
  current(@CurrentUser() u: AuthUser) {
    return this.svc.current(u);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('staff')
  staff(@CurrentUser() u: AuthUser) {
    return this.svc.staff(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('staff-sales')
  staffSales(@CurrentUser() u: AuthUser, @Query('from') from: string = todayJakarta().slice(0, 8) + '01', @Query('to') to: string = todayJakarta()) {
    return this.svc.staffSales(u.tenantId, from, to);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.svc.listSessions(u.tenantId);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE')
  @Post('sessions')
  open(@CurrentUser() u: AuthUser, @Body() dto: OpenSessionDto) {
    return this.svc.open(u, dto);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE')
  @Post('sessions/:id/close')
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseSessionDto) {
    return this.svc.close(u, id, dto);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('orders')
  orders(@CurrentUser() u: AuthUser, @Query('sessionId') sessionId?: string) {
    return this.svc.listOrders(u.tenantId, sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : undefined);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
  @Get('orders/:id')
  order(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOrder(u.tenantId, id);
  }

  /** Harga dan potongan promo yang berlaku untuk keranjang (daftar harga toko/pelanggan + promo aktif); layar kasir memakai angka ini */
  @Roles('CASHIER', 'SALES', 'FINANCE')
  @Post('quote')
  quote(@CurrentUser() u: AuthUser, @Body() dto: PosQuoteDto) {
    return this.svc.quote(u, dto);
  }

  @Roles('CASHIER', 'SALES', 'FINANCE')
  @Post('orders')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePosOrderDto) {
    return this.svc.createOrder(u, dto);
  }
}
