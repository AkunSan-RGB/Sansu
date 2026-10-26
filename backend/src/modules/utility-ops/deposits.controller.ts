import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { DepositDto, DepositOffsetDto, DepositRefundDto } from './deposits.dto';
import { DepositsService } from './deposits.service';

@ApiTags('Layanan air — jaminan sambungan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/deposits')
export class DepositsController {
  constructor(private readonly svc: DepositsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('open') open?: string) { return this.svc.list(u.tenantId, open === 'true'); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE') @Post() receive(@CurrentUser() u: AuthUser, @Body() dto: DepositDto) { return this.svc.receive(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/offset') offset(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepositOffsetDto) { return this.svc.offset(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/refund') refund(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepositRefundDto) { return this.svc.refund(u, id, dto); }
}
