import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryController } from './inventory.controller';
import { InventoryMethodController, InventoryMethodService } from './inventory-method';
import { InventoryService } from './inventory.service';
import { MovementAnalysisController, MovementAnalysisService } from './movement-analysis';
import { StockService } from './stock.service';
import { WarehouseOpsController, WarehouseOpsService } from './warehouse-ops';
import { WritedownController, WritedownService } from './writedown';

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController, InventoryMethodController, WarehouseOpsController, WritedownController, MovementAnalysisController],
  providers: [InventoryService, InventoryMethodService, StockService, WarehouseOpsService, WritedownService, MovementAnalysisService],
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
