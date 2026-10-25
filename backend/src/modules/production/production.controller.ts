import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ManufacturingService } from './manufacturing.service';
import { PlanDto, RequirementsDto, VarianceQueryDto } from './manufacturing.dto';
import { ProductionService } from './production.service';
import { SaveBomDto, CreateProductionDto, StartProductionDto, CompleteProductionDto, CancelProductionDto } from './production.dto';

@ApiTags('Produksi')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('production')
export class ProductionController {
  constructor(
    private readonly svc: ProductionService,
    private readonly mfg: ManufacturingService,
  ) {}

  /** Perencanaan kebutuhan bahan (resep bertingkat) untuk rencana produksi — jenis usaha Manufaktur */
  @Post('requirements')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  requirements(@CurrentUser() u: AuthUser, @Body() dto: RequirementsDto) {
    return this.mfg.requirements(u.tenantId, dto);
  }
  /** Analisis selisih produksi: pemakaian bahan, hasil, dan biaya konversi terhadap standar */
  @Get('variance')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  variance(@CurrentUser() u: AuthUser, @Query() q: VarianceQueryDto) {
    return this.mfg.variance(u.tenantId, q);
  }

  /** Buat perintah produksi berjenjang (induk dan anak untuk barang setengah jadi) dari rencana — jenis usaha Manufaktur */
  @Post('plan')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  plan(@CurrentUser() u: AuthUser, @Body() dto: PlanDto) {
    return this.mfg.plan(u, dto);
  }

  @Get('boms')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
  boms(@CurrentUser() u: AuthUser) {
    return this.svc.listBoms(u.tenantId);
  }
  @Post('boms')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  createBom(@CurrentUser() u: AuthUser, @Body() dto: SaveBomDto) {
    return this.svc.createBom(u, dto);
  }
  @Put('boms/:id')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  updateBom(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveBomDto) {
    return this.svc.updateBom(u, id, dto);
  }

  @Get('orders')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
  orders(@CurrentUser() u: AuthUser) {
    return this.svc.listOrders(u.tenantId);
  }
  @Get('report')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  report(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    return this.svc.report(u.tenantId, period || new Date().toISOString().slice(0, 7));
  }
  @Get('orders/:id')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE', 'ACCOUNTANT')
  order(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOrder(u.tenantId, id);
  }
  @Post('orders')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateProductionDto) {
    return this.svc.createOrder(u, dto);
  }
  @Post('orders/:id/start')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartProductionDto) {
    return this.svc.start(u, id, dto);
  }
  @Post('orders/:id/complete')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteProductionDto) {
    return this.svc.complete(u, id, dto);
  }
  @Post('orders/:id/cancel')
  @Roles('ADMIN', 'WAREHOUSE', 'FINANCE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelProductionDto) {
    return this.svc.cancel(u, id, dto);
  }
}
