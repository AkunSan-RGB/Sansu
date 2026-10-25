import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SwapsService } from './swaps.service';
import { SwapQueryDto, CreateSwapDto, RejectSwapDto } from './swaps.dto';

@ApiTags('Retur')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('goods-swaps')
export class SwapsController {
  constructor(private readonly svc: SwapsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: SwapQueryDto) {
    return this.svc.list(u.tenantId, q.status);
  }
  @Post()
  @Roles('ADMIN', 'SALES', 'WAREHOUSE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSwapDto) {
    return this.svc.create(u, dto);
  }
  @Post(':id/approve')
  @Roles('ADMIN', 'FINANCE')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(u, id);
  }
  @Post(':id/reject')
  @Roles('ADMIN', 'FINANCE')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectSwapDto) {
    return this.svc.reject(u, id, dto.reason);
  }
}
