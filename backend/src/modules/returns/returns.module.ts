import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReturnsService } from './returns.service';
import { SwapsController } from './swaps.controller';
import { SwapsService } from './swaps.service';
import { ReturnsController } from './returns.controller';

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [ReturnsController, SwapsController],
  providers: [ReturnsService, SwapsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
