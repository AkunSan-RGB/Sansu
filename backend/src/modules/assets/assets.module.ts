import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsController } from './assets.controller';
import { AssetsService, AssetScheduler } from './assets.service';

@Module({
  imports: [AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetScheduler],
  exports: [AssetsService],
})
export class AssetsModule {}
