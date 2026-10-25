import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AccountSchedulesService } from './account-schedules.service';
import { UNCLOSED_EARNINGS_ID } from './schedules/unclosed-earnings.schedule';

const yearOf = (v?: string) => {
  const y = v ? Number(v) : new Date().getUTCFullYear();
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Tahun tidak valid');
  return y;
};

@ApiTags('Rincian akun')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('account-schedules')
export class AccountSchedulesController {
  constructor(private readonly service: AccountSchedulesService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar akun di laporan keuangan beserta status kecocokan rincian dengan saldo akhir di laporan' })
  overview(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.service.overview(u.tenantId, yearOf(year));
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Rincian, perhitungan, dan metode satu akun (mutasi per bulan)' })
  detail(@CurrentUser() u: AuthUser, @Param('accountId') accountId: string, @Query('year') year?: string) {
    if (accountId !== UNCLOSED_EARNINGS_ID) new ParseUUIDPipe().transform(accountId, { type: 'param' });
    return this.service.detail(u.tenantId, yearOf(year), accountId);
  }
}
