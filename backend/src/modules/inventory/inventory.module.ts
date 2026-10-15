import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryController } from './inventory.controller';
import { InventoryMethodController, InventoryMethodService } from './inventory-method';
import { InventoryService } from './inventory.service';
import { LotsController, LotsService } from './lots';
import { MovementAnalysisController, MovementAnalysisService } from './movement-analysis';
import { StockService } from './stock.service';
import { WarehouseOpsController, WarehouseOpsService } from './warehouse-ops';
import { WritedownController, WritedownService } from './writedown';

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController, InventoryMethodController, WarehouseOpsController, WritedownController, MovementAnalysisController, LotsController],
  providers: [InventoryService, InventoryMethodService, StockService, WarehouseOpsService, WritedownService, MovementAnalysisService, LotsService],
  exports: [StockService, InventoryService, WarehouseOpsService],
})
export class InventoryModule {}
