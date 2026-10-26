import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { NetworkAssetDto, WorkOrderDto, WorkOrderStatusDto } from './network-assets.dto';
import { NetworkAssetsService } from './network-assets.service';

@ApiTags('Layanan air — aset jaringan & perintah kerja')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility')
export class NetworkAssetsController {
  constructor(private readonly svc: NetworkAssetsService) {}

  @Get('network-assets') assets(@CurrentUser() u: AuthUser) { return this.svc.assets(u.tenantId); }
  @Get('work-orders/summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Roles('ADMIN', 'WAREHOUSE') @Post('network-assets') createAsset(@CurrentUser() u: AuthUser, @Body() dto: NetworkAssetDto) { return this.svc.saveAsset(u, dto); }
  @Roles('ADMIN', 'WAREHOUSE') @Put('network-assets/:id') updateAsset(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NetworkAssetDto) { return this.svc.saveAsset(u, dto, id); }
  @Get('work-orders') orders(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('assigneeId') assigneeId?: string, @Query('assetId') assetId?: string) { return this.svc.orders(u.tenantId, { status, assigneeId, assetId }); }
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES') @Post('work-orders') createOrder(@CurrentUser() u: AuthUser, @Body() dto: WorkOrderDto) { return this.svc.createOrder(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE') @Post('work-orders/:id/status') orderStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkOrderStatusDto) { return this.svc.setOrderStatus(u, id, dto); }
}
