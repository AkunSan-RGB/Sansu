import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ManufacturingService } from './manufacturing.service';
import { WorkCenterController } from './work-centers.controller';
import { WorkCenterService } from './work-centers.service';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductionRepository } from './production.repository';
import { ManufacturingRepository } from './manufacturing.repository';
import { WorkCentersRepository } from './work-centers.repository';
import { QcRepository } from './qc.repository';

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [ProductionController, WorkCenterController, QcController],
  providers: [QcRepository, WorkCentersRepository, ManufacturingRepository, ProductionRepository, ProductionService, ManufacturingService, WorkCenterService, QcService],
  exports: [QcService],
})
export class ProductionModule {}
