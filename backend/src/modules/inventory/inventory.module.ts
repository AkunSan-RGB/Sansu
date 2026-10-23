import { InventoryControlsController, InventoryControlsService } from './inventory-controls';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BinsController, BinsService } from './bins';
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
  controllers: [BinsController, InventoryControlsController, InventoryController, InventoryMethodController, WarehouseOpsController, WritedownController, MovementAnalysisController, LotsController],
  providers: [BinsService, InventoryControlsService, InventoryService, InventoryMethodService, StockService, WarehouseOpsService, WritedownService, MovementAnalysisService, LotsService],
  exports: [StockService, InventoryService, WarehouseOpsService, BinsService],
})
export class InventoryModule {}
