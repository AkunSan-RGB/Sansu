import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockService } from './stock.service';
import { WarehouseOpsController, WarehouseOpsService } from './warehouse-ops';
import { WritedownController, WritedownService } from './writedown';

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController, WarehouseOpsController, WritedownController],
  providers: [InventoryService, StockService, WarehouseOpsService, WritedownService],
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
