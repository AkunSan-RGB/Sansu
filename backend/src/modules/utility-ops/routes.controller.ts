import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AssignRouteDto, RouteDto } from './routes.dto';
import { RoutesService } from './routes.service';

@ApiTags('Layanan air — rute baca')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility/routes')
export class RoutesController {
  constructor(private readonly svc: RoutesService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('period') period?: string) { return this.svc.list(u.tenantId, period); }
  @Get('unassigned') unassigned(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.svc.unassigned(u.tenantId, q); }
  @Get(':id/stops') stops(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('period') period?: string) { return this.svc.stops(u.tenantId, id, period); }
  @Roles('ADMIN', 'FINANCE') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: RouteDto) { return this.svc.save(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) { return this.svc.save(u, dto, id); }
  @Roles('ADMIN', 'FINANCE') @Post('assign') assign(@CurrentUser() u: AuthUser, @Body() dto: AssignRouteDto) { return this.svc.assign(u, dto); }
}
