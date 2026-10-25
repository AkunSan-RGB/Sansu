import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsController } from './assets.controller';
import { AssetReportsService } from './asset-reports.service';
import { AssetsService, AssetScheduler } from './assets.service';

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetReportsService, AssetScheduler],
  exports: [AssetsService, AssetReportsService],
})
export class AssetsModule {}
