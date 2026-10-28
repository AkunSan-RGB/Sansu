import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SiteBillDto, SiteContractDto, SiteContractUpdateDto, SiteRosterDto } from './site-contracts.dto';
import { SiteContractsService } from './site-contracts.service';

@ApiTags('Kontrak per lokasi')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('services/sites')
export class SiteContractsController {
  constructor(private readonly svc: SiteContractsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: SiteContractDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN') @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteContractUpdateDto) { return this.svc.update(u, id, dto); }
  @Get(':id/coverage') coverage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('from') from: string, @Query('to') to: string) { return this.svc.coverage(u.tenantId, id, from, to); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/roster') assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteRosterDto) { return this.svc.assign(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Delete(':id/roster/:dutyId') unassign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('dutyId', ParseUUIDPipe) dutyId: string) { return this.svc.unassign(u, id, dutyId); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/bill') bill(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteBillDto) { return this.svc.bill(u, id, dto); }
}
