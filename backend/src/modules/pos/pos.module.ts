import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosControlsService, PosReturnsService } from './pos-returns.service';
import { PosReturnsController } from './pos-returns.controller';
import { LoyaltyModule } from './loyalty.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [AccountingModule, InventoryModule, LoyaltyModule],
  controllers: [PosController, PosReturnsController],
  providers: [PosService, PosReturnsService, PosControlsService],
  exports: [PosService],
})
export class PosModule {}
