import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { BinsService } from './bins.service';
import { BinStockQuery, PickPlanQuery } from './bins.shared';
import { BinWarehouseDto, CreateBinsDto, UpdateBinDto, ImportBinsDto, MoveBinsDto } from './bins.dto';

const READ_ROLES = ['ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'PURCHASING', 'SALES'] as const;

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory/bins')
export class BinsController {
  constructor(private readonly svc: BinsService) {}

  @Get('warehouses') @Roles(...READ_ROLES)
  warehouses(@CurrentUser() u: AuthUser) { return this.svc.warehouses(u); }

  @Get() @Roles(...READ_ROLES)
  list(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) { return this.svc.list(u, warehouseId); }

  @Get('stock') @Roles(...READ_ROLES)
  stock(@CurrentUser() u: AuthUser, @Query() q: BinStockQuery) { return this.svc.stock(u, q); }

  @Get('history') @Roles(...READ_ROLES)
  history(@CurrentUser() u: AuthUser, @Query() q: BinStockQuery) { return this.svc.history(u, q); }

  @Get('pick-plan') @Roles(...READ_ROLES)
  pickPlan(@CurrentUser() u: AuthUser, @Query() q: PickPlanQuery) { return this.svc.pickPlan(u, q); }

  @Get('controls') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string) { return this.svc.controls(u.tenantId, warehouseId || undefined); }

  @Get('check') @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
  check(@CurrentUser() u: AuthUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string) { return this.svc.check(u, warehouseId); }

  @Post('activate') @Roles('ADMIN', 'FINANCE')
  activate(@CurrentUser() u: AuthUser, @Body() dto: BinWarehouseDto) { return this.svc.activate(u, dto.warehouseId); }

  @Post('deactivate') @Roles('ADMIN', 'FINANCE')
  deactivate(@CurrentUser() u: AuthUser, @Body() dto: BinWarehouseDto) { return this.svc.deactivate(u, dto.warehouseId); }

  @Post() @Roles('ADMIN', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBinsDto) { return this.svc.createBins(u, dto); }

  @Patch(':id') @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBinDto) { return this.svc.updateBin(u, id, dto); }

  @Post('import') @Roles('ADMIN', 'FINANCE')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportBinsDto) { return this.svc.importBins(u, dto); }

  @Post('move') @Roles('ADMIN', 'WAREHOUSE')
  move(@CurrentUser() u: AuthUser, @Body() dto: MoveBinsDto) { return this.svc.move(u, dto); }
}
