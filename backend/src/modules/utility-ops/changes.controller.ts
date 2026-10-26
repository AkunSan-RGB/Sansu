import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ChangeRequestDto, DecideChangeDto, RejectChangeDto } from './changes.dto';
import { ChangesService } from './changes.service';

@ApiTags('Layanan air — mutasi pelanggan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/changes')
export class ChangesController {
  constructor(private readonly svc: ChangesService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('connectionId') connectionId?: string) { return this.svc.list(u.tenantId, { status, connectionId }); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post() request(@CurrentUser() u: AuthUser, @Body() dto: ChangeRequestDto) { return this.svc.request(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideChangeDto) { return this.svc.approve(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectChangeDto) { return this.svc.reject(u, id, dto); }
}
