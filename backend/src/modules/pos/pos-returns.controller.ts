import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PosReturnsService, PosControlsService } from './pos-returns.service';
import { CreatePosReturnDto } from './pos-returns.dto';

@ApiTags('Kasir (POS)')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('pos')
export class PosReturnsController {
  constructor(
    private readonly svc: PosReturnsService,
    private readonly controlsSvc: PosControlsService,
  ) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('returns')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.controlsSvc.controls(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE')
  @Post('orders/:id/return')
  create(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePosReturnDto) {
    return this.svc.create(u, id, dto);
  }
}
