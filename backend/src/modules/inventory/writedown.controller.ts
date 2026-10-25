import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { WritedownService } from './writedown.service';
import { CreateWritedownDto } from './writedown.dto';

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('inventory/writedowns')
export class WritedownController {
  constructor(private readonly svc: WritedownService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('candidates')
  candidates(
    @CurrentUser() u: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('costToSellPct') pct?: string,
  ) {
    return this.svc.candidates(u, warehouseId || undefined, Number(pct) || 0);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('recoverable')
  recoverable(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string, @Query('costToSellPct') pct?: string) {
    return this.svc.recoverable(u, warehouseId || undefined, Number(pct) || 0);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateWritedownDto) {
    return this.svc.create(u, dto);
  }
}
