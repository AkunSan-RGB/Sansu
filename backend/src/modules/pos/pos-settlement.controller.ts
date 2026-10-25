import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { METHODS } from './pos-settlement.shared';
import { CardSettlementService } from './pos-settlement.service';
import { CardSettingsDto, SettleDto, CancelSettleDto } from './pos-settlement.dto';

export class UnsettledQuery {
  @ApiPropertyOptional({ enum: METHODS }) @IsOptional() @IsIn(METHODS) method?: 'QRIS' | 'DEBIT';
}

@ApiTags('Pencairan QRIS/kartu')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('pos/card-settlements')
export class CardSettlementController {
  constructor(private readonly svc: CardSettlementService) {}

  @Get('settings') settings(@CurrentUser() u: AuthUser) { return this.svc.settings(u.tenantId); }
  @Roles('ADMIN') @Put('settings') save(@CurrentUser() u: AuthUser, @Body() dto: CardSettingsDto) { return this.svc.saveSettings(u, dto); }
  @Get('unsettled') unsettled(@CurrentUser() u: AuthUser, @Query() q: UnsettledQuery) { return this.svc.unsettled(u.tenantId, q.method); }
  @Get('unsettled-returns') unsettledReturns(@CurrentUser() u: AuthUser, @Query() q: UnsettledQuery) { return this.svc.unsettledReturns(u.tenantId, q.method); }
  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Get('controls') controls(@CurrentUser() u: AuthUser) { return this.svc.controls(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: SettleDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN') @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSettleDto) { return this.svc.cancel(u, id, dto); }
}
