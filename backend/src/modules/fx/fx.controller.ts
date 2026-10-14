import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { FOREIGN_CURRENCIES } from '@sansu/shared';
import { ExposureQueryDto, RateQueryDto, RevaluationDto, UpsertRateDto } from './fx.dto';
import { FxService } from './fx.service';

@ApiTags('Mata uang asing')
@ApiBearerAuth()
@Controller('fx')
export class FxController {
  constructor(private readonly svc: FxService) {}

  @Get('currencies')
  currencies() {
    return FOREIGN_CURRENCIES;
  }

  @Get('rates')
  rates(@CurrentUser() u: AuthUser, @Query() q: RateQueryDto) {
    return this.svc.list(u.tenantId, q.currency);
  }

  /** Kurs yang akan dipakai dokumen pada tanggal tertentu (untuk mengisi formulir) */
  @Get('rate')
  async rate(@CurrentUser() u: AuthUser, @Query('currency') currency: string, @Query('date') date?: string) {
    const r = await this.svc.rateFor(u.tenantId, currency, date);
    return { currency, rate: r };
  }

  @Put('rates')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  upsert(@CurrentUser() u: AuthUser, @Body() dto: UpsertRateDto) {
    return this.svc.upsert(u, dto);
  }

  @Delete('rates/:id')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }

  @Get('exposure')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  exposure(@CurrentUser() u: AuthUser, @Query() q: ExposureQueryDto) {
    return this.svc.exposure(u.tenantId, q.date);
  }

  @Post('revaluation')
  @Roles('ADMIN', 'ACCOUNTANT')
  revalue(@CurrentUser() u: AuthUser, @Body() dto: RevaluationDto) {
    return this.svc.revalue(u, dto);
  }
}
