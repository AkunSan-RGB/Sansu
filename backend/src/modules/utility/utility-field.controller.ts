import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { ReadingDto } from './utility.dto';
import { UtilityService } from './utility.service';
import { UtilityFieldService, UtilityIngestGuard } from './utility-field.service';
import { ImportDto, IngestKeyDto, CounterPayDto, RemitDto, DecideDto } from './utility-field.dto';

@ApiTags('Layanan utilitas')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'SALES')
@Controller('utility')
export class UtilityFieldController {
  constructor(private readonly svc: UtilityFieldService, private readonly util: UtilityService) {}

  @Roles('ADMIN', 'WAREHOUSE') @Post('readings/import') import(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) { return this.svc.importRows(u, dto.rows, 'IMPORT'); }
  /** Pencatatan dari HP petugas: sama dengan input biasa tetapi membawa lokasi dan foto meter */
  @Roles('ADMIN', 'WAREHOUSE') @Post('field/readings') field(@CurrentUser() u: AuthUser, @Body() dto: ReadingDto) { return this.util.enterReading(u, dto, 'LAPANGAN'); }
  @Roles('ADMIN', 'WAREHOUSE') @Get('field/route') route(@CurrentUser() u: AuthUser, @Query('period') period: string, @Query('routeId') routeId?: string) { return this.svc.fieldRoute(u.tenantId, period, routeId || undefined); }
  @Get('readings/:id/photo') photo(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.photo(u.tenantId, id); }

  @Roles('ADMIN') @Get('ingest-keys') keys(@CurrentUser() u: AuthUser) { return this.svc.keys(u.tenantId); }
  @Roles('ADMIN') @Post('ingest-keys') createKey(@CurrentUser() u: AuthUser, @Body() dto: IngestKeyDto) { return this.svc.createKey(u, dto); }
  @Roles('ADMIN') @Post('ingest-keys/:id/revoke') revokeKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.revokeKey(u, id); }

  @Roles('ADMIN', 'FINANCE', 'CASHIER') @Get('counter/search') search(@CurrentUser() u: AuthUser, @Query('q') q: string) { return this.svc.counterSearch(u.tenantId, q ?? ''); }
  @Roles('ADMIN', 'FINANCE', 'CASHIER') @Post('counter/pay') pay(@CurrentUser() u: AuthUser, @Body() dto: CounterPayDto) { return this.svc.counterPay(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'CASHIER') @Get('counter/recent') recent(@CurrentUser() u: AuthUser) { return this.svc.recentReceipts(u); }
  @Roles('ADMIN', 'FINANCE', 'CASHIER') @Get('counter/open') open(@CurrentUser() u: AuthUser) { return this.svc.openReceipts(u); }
  @Roles('ADMIN', 'FINANCE', 'CASHIER') @Post('counter/remit') remit(@CurrentUser() u: AuthUser, @Body() dto: RemitDto) { return this.svc.remit(u, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('counter/remittances') remittances(@CurrentUser() u: AuthUser) { return this.svc.remittances(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post('counter/remittances/:id/decide') decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) { return this.svc.decide(u, id, dto); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT') @Get('counter/controls') controls(@CurrentUser() u: AuthUser) { return this.svc.counterControls(u.tenantId); }
}

/** Penerima angka meter dari alat/gateway: tanpa login, memakai kunci API (header X-Api-Key) */
@ApiTags('Layanan utilitas')
@Public()
@UseGuards(UtilityIngestGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('ingest/utility')
export class UtilityIngestController {
  constructor(private readonly svc: UtilityFieldService) {}
  @Post('readings') receive(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) { return this.svc.importRows(u, dto.rows, 'API'); }
}
