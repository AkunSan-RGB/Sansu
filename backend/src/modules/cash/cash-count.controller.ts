import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CashCountService } from './cash-count.service';
import { CashCountSettingsDto, CreateCashCountDto, UpdateCashCountDto, RejectCashCountDto } from './cash-count.dto';

@ApiTags('Kas & Bank')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('cash')
@Controller('cash/counts')
export class CashCountController {
  constructor(private readonly svc: CashCountService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('accounts')
  accounts(@CurrentUser() u: AuthUser) {
    return this.svc.kasAccounts(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.svc.getSettings(u.tenantId);
  }
  @Put('settings')
  @Roles('OWNER')
  saveSettings(@CurrentUser() u: AuthUser, @Body() dto: CashCountSettingsDto) {
    return this.svc.saveSettings(u.tenantId, dto);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query('accountId') accountId?: string) {
    return this.svc.list(u.tenantId, accountId && /^[0-9a-f-]{36}$/i.test(accountId) ? accountId : undefined);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCashCountDto) {
    return this.svc.create(u, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Put(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCashCountDto) {
    return this.svc.update(u, id, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @HttpCode(200)
  @Post(':id/finish')
  finish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.finish(u, id);
  }
  @HttpCode(200)
  @Post(':id/approve')
  @Roles('OWNER')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(u, id);
  }
  @HttpCode(200)
  @Post(':id/reject')
  @Roles('OWNER')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCashCountDto) {
    return this.svc.reject(u, id, dto.reason);
  }
  @Roles('ADMIN', 'FINANCE')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}
