import { Body, Controller, Get, Header, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { todayJakarta } from '../../common/utils/dates';
import { IntegrationsService } from './integrations.service';
import { IntegrationSettingsDto, MarketplaceImportDto, MarketplaceSettleDto } from './integrations.dto';

@ApiTags('Integrasi')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.svc.getSettings(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE')
  @Put('settings')
  saveSettings(@CurrentUser() u: AuthUser, @Body() dto: IntegrationSettingsDto) {
    return this.svc.saveSettings(u.tenantId, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('coretax/preview')
  preview(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = range(from, to);
    return this.svc.coretaxPreview(u.tenantId, r.from, r.to);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('coretax/faktur-keluaran.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  xml(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('ids') ids?: string) {
    const r = range(from, to);
    return this.svc.coretaxXml(u.tenantId, r.from, r.to, ids ? ids.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)) : undefined);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('marketplace/channels')
  channels(@CurrentUser() u: AuthUser) {
    return this.svc.channels(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('marketplace/orders')
  orders(@CurrentUser() u: AuthUser, @Query('channel') channel?: string) {
    return this.svc.marketplaceOrders(u.tenantId, channel);
  }
  @Post('marketplace/import')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  import(@CurrentUser() u: AuthUser, @Body() dto: MarketplaceImportDto) {
    return this.svc.importMarketplace(u, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('marketplace/settle')
  settle(@CurrentUser() u: AuthUser, @Body() dto: MarketplaceSettleDto) {
    return this.svc.settle(u, dto);
  }
}

function range(from?: string, to?: string) {
  const today = todayJakarta();
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: ok(from) ? from! : `${today.slice(0, 7)}-01`, to: ok(to) ? to! : today };
}
