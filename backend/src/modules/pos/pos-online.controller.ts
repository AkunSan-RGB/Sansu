import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ONLINE_CHANNELS, type OnlineChannel } from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { PosTabsService } from './pos-tabs.service';
import { OnlineKeysService, OnlineSettingsService, PlatformSettlementsService, OnlineKeyGuard } from './pos-online.service';
import { CommissionsDto, CreateApiKeyDto, UnsettledQueryDto, CreateSettlementDto, InboundOrderDto } from './pos-online.dto';

@ApiTags('Pesanan online')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('ADMIN', 'FINANCE')
@Controller('pos/online')
export class PosOnlineController {
  constructor(
    private readonly keys: OnlineKeysService,
    private readonly settings: OnlineSettingsService,
    private readonly settlements: PlatformSettlementsService,
  ) {}

  @Get('settings')
  @Roles('ADMIN', 'FINANCE', 'CASHIER', 'ACCOUNTANT')
  async getSettings(@CurrentUser() u: AuthUser) {
    return { commissions: await this.settings.commissions(u.tenantId) };
  }
  @Patch('settings')
  async saveSettings(@CurrentUser() u: AuthUser, @Body() dto: CommissionsDto) {
    return { commissions: await this.settings.saveCommissions(u, dto) };
  }

  @Get('keys')
  listKeys(@CurrentUser() u: AuthUser) {
    return this.keys.list(u.tenantId);
  }
  @Post('keys')
  @Roles('ADMIN')
  createKey(@CurrentUser() u: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(u, dto);
  }
  @Post('keys/:id/revoke')
  @Roles('ADMIN')
  revokeKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(u, id);
  }

  @Get('unsettled')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  unsettled(@CurrentUser() u: AuthUser, @Query() q: UnsettledQueryDto) {
    return this.settlements.unsettled(u.tenantId, q.channel);
  }
  @Get('settlements')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  listSettlements(@CurrentUser() u: AuthUser) {
    return this.settlements.list(u.tenantId);
  }
  @Post('settlements')
  createSettlement(@CurrentUser() u: AuthUser, @Body() dto: CreateSettlementDto) {
    return this.settlements.create(u, dto);
  }
  @Post('settlements/:id/cancel')
  cancelSettlement(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settlements.cancel(u, id);
  }
}

/** Penerima pesanan online dari luar: tanpa login, memakai kunci API (header X-Api-Key) */
@ApiTags('Pesanan online')
@Public()
@UseGuards(OnlineKeyGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('online-orders')
export class InboundOrdersController {
  constructor(private readonly tabs: PosTabsService) {}

  @Post()
  async receive(@CurrentUser() u: AuthUser & { onlineWarehouseId: string }, @Body() dto: InboundOrderDto) {
    const r = await this.tabs.receiveOnline(u, u.onlineWarehouseId, dto);
    return { duplicate: r.duplicate, id: r.tab.id, number: r.tab.number, status: r.tab.status, lines: r.tab.lines.map((l) => ({ sku: l.product.sku, qty: l.qty, status: l.status })) };
  }

  /** Cek status pesanan yang pernah dikirim: antre/dimasak/siap/disajikan/dibayar */
  @Get(':channel/:externalRef')
  async status(@CurrentUser() u: AuthUser & { onlineWarehouseId: string }, @Param('channel') channel: string, @Param('externalRef') externalRef: string) {
    if (!(ONLINE_CHANNELS as readonly string[]).includes(channel)) throw new BadRequestException('Kanal tidak dikenal');
    return this.tabs.onlineStatus(u, channel as OnlineChannel, externalRef);
  }
}
