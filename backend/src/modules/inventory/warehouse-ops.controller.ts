import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { WarehouseOpsService } from './warehouse-ops.service';
import { CreateTransferDto, ReceiveTransferDto, CancelTransferDto, CreateCountDto, UpdateCountDto, SaveMinimumsDto } from './warehouse-ops.dto';
import { WarehouseQueryService } from './warehouse-query.service';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory')
export class WarehouseOpsController {
  constructor(private readonly svc: WarehouseOpsService,
    private readonly warehouseQuery: WarehouseQueryService) {}

  @Get('transfers')
  transfers(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.warehouseQuery.listTransfers(u, warehouseId || undefined);
  }
  @Get('transfers/:id')
  transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseQuery.getTransfer(u, id);
  }
  @Post('transfers')
  @Roles('ADMIN', 'WAREHOUSE')
  createTransfer(@CurrentUser() u: AuthUser, @Body() dto: CreateTransferDto) {
    return this.svc.createTransfer(u, dto);
  }

  @Post('transfers/:id/receive')
  @Roles('ADMIN', 'WAREHOUSE')
  receiveTransfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveTransferDto) {
    return this.svc.receiveTransfer(u, id, dto);
  }
  @Post('transfers/:id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancelTransfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto) {
    return this.svc.cancelTransfer(u, id, dto);
  }

  @Get('counts')
  counts(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.warehouseQuery.listCounts(u, warehouseId || undefined);
  }
  @Get('counts/:id')
  count(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseQuery.getCount(u, id);
  }
  @Post('counts')
  @Roles('ADMIN', 'WAREHOUSE')
  createCount(@CurrentUser() u: AuthUser, @Body() dto: CreateCountDto) {
    return this.svc.createCount(u, dto);
  }
  @Put('counts/:id')
  @Roles('ADMIN', 'WAREHOUSE')
  updateCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCountDto) {
    return this.svc.updateCount(u, id, dto);
  }
  @Post('counts/:id/post')
  @Roles('ADMIN', 'FINANCE')
  postCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.postCount(u, id);
  }
  @Post('counts/:id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancelCount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelCount(u, id);
  }

  @Get('minimums')
  minimums(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.warehouseQuery.minimums(u, warehouseId);
  }
  @Put('minimums')
  @Roles('ADMIN', 'WAREHOUSE', 'SALES')
  saveMinimums(@CurrentUser() u: AuthUser, @Body() dto: SaveMinimumsDto) {
    return this.svc.saveMinimums(u, dto);
  }
  @Get('low-stock')
  lowStock(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.warehouseQuery.lowStock(u, warehouseId || undefined);
  }
  @Get('matrix')
  matrix(@CurrentUser() u: AuthUser, @Query('includeZero') includeZero?: string, @Query('category') category?: string) {
    return this.warehouseQuery.matrix(u, { includeZero: includeZero === 'true', category: category || undefined });
  }
}
