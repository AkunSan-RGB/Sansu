import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin';
import { DeletionService } from './deletion';
import { TenantExportService } from './export';
import { ReauthService } from './reauth';
import { BackupStatusService } from './backup-status.service';
import { FieldEncryptionService } from './field-encryption';
import { SecurityPostureService } from './security-posture';
import { CompanyDataController, DataRightsAdminController, BackupReportController } from './data-rights.controller';
import { BackupStatusRepository } from './backup-status.repository';

@Module({
  controllers: [CompanyDataController, DataRightsAdminController, BackupReportController],
  providers: [BackupStatusRepository, TenantExportService, DeletionService, ReauthService, SecurityPostureService, FieldEncryptionService, BackupStatusService, PlatformAdminGuard],
  exports: [SecurityPostureService],
})
export class DataRightsModule {}
