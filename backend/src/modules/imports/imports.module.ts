import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsModule } from '../assets/assets.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { OpeningImportsService } from './opening-imports.service';
import { ImportsRepository } from './imports.repository';

@Module({
  imports: [InventoryModule, AccountingModule, AssetsModule],
  controllers: [ImportsController],
  providers: [ImportsRepository, ImportsService, OpeningImportsService],
})
export class ImportsModule {}
