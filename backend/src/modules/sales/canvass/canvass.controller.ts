import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CanvassService } from './canvass.service';
import { VanDto, VanMoveDto, CanvassSaleDto, CollectionQueryDto, CollectionDto, VerifyDto, RejectCollectionDto, RouteDto, SummaryQueryDto, VisitDto } from './canvass.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('canvass')
export class CanvassController {
  constructor(private readonly svc: CanvassService) {}

  @Get('vans')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT', 'SALES')
  vans(@CurrentUser() u: AuthUser) {
    return this.svc.vans(u.tenantId, u.role);
  }
  @Post('vans')
  @Roles('ADMIN')
  createVan(@CurrentUser() u: AuthUser, @Body() dto: VanDto) {
    return this.svc.createVan(u, dto);
  }
  @Post('vans/:id/load')
  @Roles('ADMIN', 'WAREHOUSE')
  load(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VanMoveDto) {
    return this.svc.moveVan(u, id, dto, 'LOAD');
  }
  @Post('vans/:id/unload')
  @Roles('ADMIN', 'WAREHOUSE')
  unload(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VanMoveDto) {
    return this.svc.moveVan(u, id, dto, 'UNLOAD');
  }

  @Post('sales')
  @Roles('ADMIN', 'SALES')
  sale(@CurrentUser() u: AuthUser, @Body() dto: CanvassSaleDto) {
    return this.svc.sale(u, dto);
  }

  @Get('collections')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  collections(@CurrentUser() u: AuthUser, @Query() q: CollectionQueryDto) {
    return this.svc.collections(u, q.status);
  }
  @Post('collections')
  @Roles('ADMIN', 'SALES')
  collect(@CurrentUser() u: AuthUser, @Body() dto: CollectionDto) {
    return this.svc.collect(u, dto);
  }
  @Post('collections/:id/verify')
  @Roles('ADMIN', 'FINANCE')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    return this.svc.verify(u, id, dto);
  }
  @Post('collections/:id/reject')
  @Roles('ADMIN', 'FINANCE')
  rejectCollection(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCollectionDto) {
    return this.svc.rejectCollection(u, id, dto.reason);
  }

  @Get('routes')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  routes(@CurrentUser() u: AuthUser) {
    return this.svc.routes(u);
  }
  @Post('routes')
  @Roles('ADMIN')
  createRoute(@CurrentUser() u: AuthUser, @Body() dto: RouteDto) {
    return this.svc.saveRoute(u, dto);
  }
  @Put('routes/:id')
  @Roles('ADMIN')
  updateRoute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.svc.saveRoute(u, dto, id);
  }

  @Get('visits')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  visits(@CurrentUser() u: AuthUser, @Query() q: SummaryQueryDto) {
    return this.svc.visits(u, q.date);
  }
  @Post('visits')
  @Roles('SALES')
  visit(@CurrentUser() u: AuthUser, @Body() dto: VisitDto) {
    return this.svc.visit(u, dto);
  }
  @Get('summary')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  summary(@CurrentUser() u: AuthUser, @Query() q: SummaryQueryDto) {
    return this.svc.summary(u, q.date);
  }
}
