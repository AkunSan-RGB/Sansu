import { InventoryControlsController } from './inventory-controls.controller';
import { InventoryControlsService } from './inventory-controls.service';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BinsController } from './bins.controller';
import { BinsService } from './bins.service';
import { InventoryController } from './inventory.controller';
import { InventoryMethodController } from './inventory-method.controller';
import { InventoryMethodService } from './inventory-method.service';
import { InventoryService } from './inventory.service';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { MovementAnalysisController } from './movement-analysis.controller';
import { MovementAnalysisService } from './movement-analysis.service';
import { StockService } from './stock.service';
import { WarehouseOpsController } from './warehouse-ops.controller';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseOpsService } from './warehouse-ops.service';
import { WarehouseQueryService } from './warehouse-query.service';
import { WritedownController } from './writedown.controller';
import { WritedownService } from './writedown.service';

@Module({
  imports: [AccountingModule],
  controllers: [BinsController, InventoryControlsController, InventoryController, InventoryMethodController, WarehouseOpsController, WritedownController, MovementAnalysisController, LotsController],
  providers: [WarehouseRepository, BinsService, InventoryControlsService, InventoryService, InventoryMethodService, StockService, WarehouseOpsService, WarehouseQueryService, WritedownService, MovementAnalysisService, LotsService],
  exports: [StockService, InventoryService, WarehouseOpsService, BinsService],
})
export class InventoryModule {}
