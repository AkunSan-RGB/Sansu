import { Body, Controller, Headers, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked, PlatformAdminGuard } from '../../common/auth/platform-admin';
import { DeletionService } from './deletion';
import { TenantExportService } from './export';
import { BackupReportDto } from './backup-status.dto';
import { BackupStatusService } from './backup-status.service';
import { SecurityPostureService } from './security-posture';
import { ExportDto, DeletionRequestDto, HoldDto } from './data-rights.dto';

/** Hak pemilik atas data perusahaannya: ekspor seluruh data dan penghapusan terjadwal. Tetap bisa dipakai walau langganan habis. */
@ApiTags('Data perusahaan')
@ApiBearerAuth()
@Controller('company-data')
export class CompanyDataController {
  constructor(
    private readonly exporter: TenantExportService,
    private readonly deletion: DeletionService,
  ) {}

  @AllowWhenLocked()
  @Roles('OWNER', 'ADMIN')
  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.deletion.status(u.tenantId);
  }

  /** Langkah 1 ekspor: verifikasi ulang, lalu tautan unduh sekali pakai (berlaku 5 menit) */
  @AllowWhenLocked()
  @Roles('OWNER')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @HttpCode(200)
  @Post('export')
  prepare(@CurrentUser() u: AuthUser, @Body() dto: ExportDto) {
    return this.exporter.prepare(u, dto);
  }

  /** Langkah 2: unduh arsip. Hanya token sekali pakai yang menjadi kuncinya; arsipnya dibatasi RLS perusahaan pemilik token. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @Get('export/:token')
  async download(@Param('token') token: string, @Res() res: Response) {
    await this.exporter.stream(token, res);
  }

  @AllowWhenLocked()
  @Roles('OWNER')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @HttpCode(200)
  @Post('deletion')
  requestDeletion(@CurrentUser() u: AuthUser, @Body() dto: DeletionRequestDto) {
    return this.deletion.request(u, dto);
  }

  @AllowWhenLocked()
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  @Delete('deletion')
  cancelDeletion(@CurrentUser() u: AuthUser) {
    return this.deletion.cancel(u);
  }
}

/** Pemilik layanan: postur keamanan database dan pengelolaan permintaan penghapusan */
@ApiTags('Panel SANSU')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@AllowWhenLocked()
@Controller('platform-admin')
export class DataRightsAdminController {
  constructor(
    private readonly posture: SecurityPostureService,
    private readonly deletion: DeletionService,
    private readonly backups: BackupStatusService,
  ) {}

  @Get('backups')
  backupOverview() {
    return this.backups.overview();
  }

  @Get('security-posture')
  security() {
    return this.posture.check();
  }

  @Get('data-deletions')
  list() {
    return this.deletion.list();
  }

  @HttpCode(200)
  @Post('data-deletions/:id/hold')
  hold(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldDto) {
    return this.deletion.hold(u.email, id, dto.reason);
  }

  @HttpCode(200)
  @Post('data-deletions/:id/release')
  release(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deletion.release(u.email, id);
  }
}

/** Laporan dari pelaksana backup (skrip VPS / GitHub Actions). Dilindungi token khusus BACKUP_REPORT_TOKEN, bukan login pengguna. */
@ApiTags('Backup')
@Controller('backup-report')
export class BackupReportController {
  constructor(private readonly backups: BackupStatusService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @HttpCode(200)
  @Post()
  async report(@Headers('x-backup-token') token: string | undefined, @Body() dto: BackupReportDto) {
    this.backups.authorize(token);
    const e = await this.backups.report(dto);
    return { ok: true, at: e.at };
  }
}
