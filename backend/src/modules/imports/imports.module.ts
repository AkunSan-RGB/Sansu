import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsModule } from '../assets/assets.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [InventoryModule, AccountingModule, AssetsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
