import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { UtilityIngestGuard } from '../utility/utility-field.service';
import { VaApplyDto, VaPaymentDto, VaSettingsDto } from './va.dto';
import { VaService } from './va.service';

@ApiTags('Layanan air — virtual account')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('utility/va')
export class VaController {
  constructor(private readonly svc: VaService) {}
  @Get('settings') settings(@CurrentUser() u: AuthUser) { return this.svc.getSettings(u.tenantId); }
  @Roles('ADMIN') @Put('settings') save(@CurrentUser() u: AuthUser, @Body() dto: VaSettingsDto) { return this.svc.saveSettings(u, dto); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get('payments') list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.tenantId, status); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'CASHIER') @Get('connection/:id') numberOf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.numberOf(u.tenantId, id); }
  @Roles('ADMIN', 'FINANCE') @Post('payments/:id/apply') apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VaApplyDto) { return this.svc.reapply(u, id, dto); }
}

/** Penerima pemberitahuan pembayaran dari bank/penyedia: tanpa login, memakai kunci API (header X-Api-Key) seperti penerima meter */
@ApiTags('Layanan air — virtual account')
@Public()
@UseGuards(UtilityIngestGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('ingest/utility')
export class VaIngestController {
  constructor(private readonly svc: VaService) {}
  @Post('va-payments') receive(@CurrentUser() u: AuthUser, @Body() dto: VaPaymentDto) { return this.svc.receive(u, dto); }
}
