import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseInvoicesController, PurchaseOrdersController, SuppliersController } from './purchasing.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AccountingModule, InventoryModule, AssetsModule],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseInvoicesController],
  providers: [SuppliersService, PurchaseOrdersService, PurchaseInvoicesService],
  exports: [PurchaseOrdersService],
})
export class PurchasingModule {}
