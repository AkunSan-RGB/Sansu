import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AccountSchedulesService } from './account-schedules.service';
import { FreezeSnapshotDto } from './account-schedules.dto';
import { ReportSnapshotsService } from './report-snapshots.service';

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
  constructor(
    private readonly service: AccountSchedulesService,
    private readonly snapshots: ReportSnapshotsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Daftar akun di laporan keuangan beserta status kecocokan rincian dengan saldo akhir di laporan' })
  overview(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.service.overview(u.tenantId, yearOf(year));
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'Daftar laporan keuangan yang sudah dibekukan (per tahun, per versi)' })
  snapshotList(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.snapshots.list(u.tenantId, year ? yearOf(year) : undefined);
  }

  @Get('snapshots/compare')
  @ApiOperation({ summary: 'Bandingkan laporan yang dibekukan dengan pembukuan terkini: selisih per akun dan jurnal susulan' })
  snapshotCompare(@CurrentUser() u: AuthUser, @Query('year') year?: string, @Query('version') version?: string) {
    return this.snapshots.compare(u.tenantId, yearOf(year), version ? Number(version) : undefined);
  }

  @Get('snapshots/detail')
  @ApiOperation({ summary: 'Rincian satu akun sebagaimana dibekukan saat laporan ditandatangani' })
  snapshotDetail(@CurrentUser() u: AuthUser, @Query('year') year?: string, @Query('accountId') accountId?: string, @Query('version') version?: string) {
    if (!accountId) throw new BadRequestException('accountId wajib diisi');
    return this.snapshots.frozenDetail(u.tenantId, yearOf(year), accountId, version ? Number(version) : undefined);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('snapshots')
  @ApiOperation({ summary: 'Bekukan laporan keuangan satu tahun saat ditandatangani (tidak dapat diubah; versi baru bila dibekukan lagi)' })
  freeze(@CurrentUser() u: AuthUser, @Body() dto: FreezeSnapshotDto) {
    return this.snapshots.freeze(u, dto.year, dto.note);
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Rincian, perhitungan, dan metode satu akun (mutasi per bulan)' })
  detail(@CurrentUser() u: AuthUser, @Param('accountId') accountId: string, @Query('year') year?: string) {
    return this.service.detail(u.tenantId, yearOf(year), accountId);
  }
}
