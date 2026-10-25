import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsController } from './assets.controller';
import { AssetRepository } from './asset.repository';
import { AssetReportsService } from './asset-reports.service';
import { AssetsService, AssetScheduler } from './assets.service';

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetRepository, AssetsService, AssetReportsService, AssetScheduler],
  exports: [AssetsService, AssetReportsService],
})
export class AssetsModule {}
