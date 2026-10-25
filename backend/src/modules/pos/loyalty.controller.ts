import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { LoyaltyService } from './loyalty.service';
import { LoyaltySettingsDto, AdjustDto } from './loyalty.dto';

export class LookupQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
}

@ApiTags('Program loyalitas')
@ApiBearerAuth()
@RequireApp('pos')
@Roles('CASHIER', 'SALES', 'FINANCE', 'ACCOUNTANT')
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly svc: LoyaltyService) {}

  @Get('settings') settings(@CurrentUser() u: AuthUser) { return this.svc.settings(u.tenantId); }
  @Roles('ADMIN') @Put('settings') save(@CurrentUser() u: AuthUser, @Body() dto: LoyaltySettingsDto) { return this.svc.saveSettings(u, dto); }
  @Get('lookup') lookup(@CurrentUser() u: AuthUser, @Query() q: LookupQuery) { return this.svc.lookup(u.tenantId, q.q ?? ''); }
  @Get('members/:id') member(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.member(u.tenantId, id); }
  @Roles('ADMIN') @Post('adjust') adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustDto) { return this.svc.adjust(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('expire') expire(@CurrentUser() u: AuthUser) { return this.svc.expireAll(u); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
}
