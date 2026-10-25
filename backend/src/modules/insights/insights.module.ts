import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsModule } from '../assets/assets.module';
import { FiscalService } from './fiscal.service';
import { HealthService } from './health.service';
import { AppendixService } from './appendix.service';
import { SupportReportsService } from './support-reports';
import { SupportQueries } from './support-queries';
import { IndustrySupportReports } from './support-reports-industry';
import { EntityProfileService } from './entity-profile.service';
import { NotesService } from './notes.service';
import { ThresholdsService } from './thresholds.service';
import { InsightsController, SupportInsightsSettingsController } from './insights.controller';

@Module({
  imports: [AccountingModule, AssetsModule, FxModule],
  controllers: [InsightsController, SupportInsightsSettingsController],
  providers: [HealthService, FiscalService, NotesService, AppendixService, SupportQueries, IndustrySupportReports, SupportReportsService, EntityProfileService, ThresholdsService],
  exports: [FiscalService, HealthService, EntityProfileService, ThresholdsService],
})
export class InsightsModule {}
