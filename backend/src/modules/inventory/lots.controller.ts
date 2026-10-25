import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { LotsService } from './lots.service';
import { LotQueryDto, TraceQueryDto, DiscardLotDto } from './lots.dto';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory/lots')
export class LotsController {
  constructor(private readonly svc: LotsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: LotQueryDto) {
    return this.svc.list(u, q);
  }

  @Get('trace')
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES', 'ACCOUNTANT')
  trace(@CurrentUser() u: AuthUser, @Query() q: TraceQueryDto) {
    return this.svc.trace(u, q);
  }

  @Post('rebuild-trace')
  @Roles('ADMIN')
  rebuild(@CurrentUser() u: AuthUser) {
    return this.svc.rebuildTrace(u);
  }

  @Post(':id/discard')
  @Roles('ADMIN', 'WAREHOUSE')
  discard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscardLotDto) {
    return this.svc.discard(u, id, dto);
  }
}
