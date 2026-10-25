import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsController } from './assets.controller';
import { AssetRepository } from './asset.repository';
import { AssetDisposalService } from './asset-disposal.service';
import { AssetMethodService } from './asset-method.service';
import { AssetReportsService } from './asset-reports.service';
import { AssetsService, AssetScheduler } from './assets.service';
import { AssetMethodRepository } from './asset-method.repository';
import { AssetDisposalRepository } from './asset-disposal.repository';
import { AssetReportsRepository } from './asset-reports.repository';

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetReportsRepository, AssetDisposalRepository, AssetMethodRepository, AssetRepository, AssetsService, AssetDisposalService, AssetMethodService, AssetReportsService, AssetScheduler],
  exports: [AssetsService, AssetReportsService, AssetDisposalService, AssetMethodService],
})
export class AssetsModule {}
