import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { DeliveryVehiclesService, DeliveryTripsService } from './delivery-trips.service';
import { VehicleDto, TripQueryDto, CreateTripDto, AddStopsDto, ReorderDto, DepartDto, PositionDto, StopResultDto, CancelTripDto } from './delivery-trips.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('delivery-vehicles')
export class DeliveryVehiclesController {
  constructor(private readonly svc: DeliveryVehiclesService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }
  @Post()
  @Roles('ADMIN', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: VehicleDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id')
  @Roles('ADMIN', 'WAREHOUSE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VehicleDto) {
    return this.svc.update(u, id, dto);
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('delivery-trips')
export class DeliveryTripsController {
  constructor(private readonly svc: DeliveryTripsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: TripQueryDto) {
    return this.svc.list(u.tenantId, q);
  }
  @Get('unscheduled')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  unscheduled(@CurrentUser() u: AuthUser) {
    return this.svc.unscheduled(u.tenantId);
  }
  @Get('controls')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Post()
  @Roles('ADMIN', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTripDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id/stops')
  @Roles('ADMIN', 'WAREHOUSE')
  addStops(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddStopsDto) {
    return this.svc.addStops(u, id, dto);
  }
  @Post(':id/stops/:stopId/remove')
  @Roles('ADMIN', 'WAREHOUSE')
  removeStop(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.removeStop(u, id, stopId);
  }
  @Post(':id/reorder')
  @Roles('ADMIN', 'WAREHOUSE')
  reorder(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderDto) {
    return this.svc.reorder(u, id, dto);
  }
  @Post(':id/optimize')
  @Roles('ADMIN', 'WAREHOUSE')
  optimize(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.optimize(u, id);
  }
  @Post(':id/depart')
  @Roles('ADMIN', 'WAREHOUSE')
  depart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepartDto) {
    return this.svc.depart(u, id, dto);
  }
  @Post(':id/position')
  @Roles('ADMIN', 'WAREHOUSE')
  position(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PositionDto) {
    return this.svc.position(u, id, dto);
  }
  @Get(':id/stops/:stopId/proof')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  proof(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.proof(u.tenantId, id, stopId);
  }
  @Post(':id/stops/:stopId/result')
  @Roles('ADMIN', 'WAREHOUSE')
  result(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('stopId', ParseUUIDPipe) stopId: string, @Body() dto: StopResultDto) {
    return this.svc.markStop(u, id, stopId, dto);
  }
  @Post(':id/complete')
  @Roles('ADMIN', 'WAREHOUSE')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.complete(u, id);
  }
  @Post(':id/cancel')
  @Roles('ADMIN', 'WAREHOUSE')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTripDto) {
    return this.svc.cancel(u, id, dto);
  }
}
