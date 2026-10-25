import { InventoryControlsController, InventoryControlsService } from './inventory-controls';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BinsController } from './bins.controller';
import { BinsService } from './bins.service';
import { InventoryController } from './inventory.controller';
import { InventoryMethodController, InventoryMethodService } from './inventory-method';
import { InventoryService } from './inventory.service';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { MovementAnalysisController, MovementAnalysisService } from './movement-analysis';
import { StockService } from './stock.service';
import { WarehouseOpsController } from './warehouse-ops.controller';
import { WarehouseOpsService } from './warehouse-ops.service';
import { WritedownController } from './writedown.controller';
import { WritedownService } from './writedown.service';

@Module({
  imports: [AccountingModule],
  controllers: [BinsController, InventoryControlsController, InventoryController, InventoryMethodController, WarehouseOpsController, WritedownController, MovementAnalysisController, LotsController],
  providers: [BinsService, InventoryControlsService, InventoryService, InventoryMethodService, StockService, WarehouseOpsService, WritedownService, MovementAnalysisService, LotsService],
  exports: [StockService, InventoryService, WarehouseOpsService, BinsService],
})
export class InventoryModule {}
