import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { PricingService } from './price-lists.service';
import { PriceListDto, UpdatePriceListDto, ReplaceItemsDto, PromoDto, QuoteDto } from './price-lists.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller()
export class PricingController {
  constructor(private readonly svc: PricingService) {}

  @Get('price-lists')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  lists(@CurrentUser() u: AuthUser) {
    return this.svc.listPriceLists(u.tenantId);
  }
  @Get('price-lists/:id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  one(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPriceList(u.tenantId, id);
  }
  @Post('price-lists')
  @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: PriceListDto) {
    return this.svc.createPriceList(u, dto);
  }
  @Patch('price-lists/:id')
  @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceListDto) {
    return this.svc.updatePriceList(u, id, dto);
  }
  @Put('price-lists/:id/items')
  @Roles('ADMIN')
  items(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceItemsDto) {
    return this.svc.replaceItems(u, id, dto.items);
  }

  @Get('promos')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT')
  promoList(@CurrentUser() u: AuthUser) {
    return this.svc.listPromos(u.tenantId);
  }
  @Post('promos')
  @Roles('ADMIN')
  promoCreate(@CurrentUser() u: AuthUser, @Body() dto: PromoDto) {
    return this.svc.createPromo(u, dto);
  }
  @Put('promos/:id')
  @Roles('ADMIN')
  promoUpdate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoDto) {
    return this.svc.updatePromo(u, id, dto);
  }

  @Post('pricing/quote')
  @Roles('ADMIN', 'SALES', 'FINANCE')
  quote(@CurrentUser() u: AuthUser, @Body() dto: QuoteDto) {
    return this.svc.preview(u, dto);
  }
}
