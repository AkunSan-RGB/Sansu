import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController, PurchaseInvoicesController, PurchaseOrdersController, PurchaseRequestsController, SuppliersController } from './purchasing.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AccountingModule, InventoryModule, AssetsModule],
  controllers: [SuppliersController, PurchaseOrdersController, GoodsReceiptsController, PurchaseInvoicesController, PurchaseRequestsController],
  providers: [SuppliersService, PurchaseOrdersService, GoodsReceiptsService, PurchaseInvoicesService, PurchaseRequestsService],
  exports: [PurchaseOrdersService, PurchaseInvoicesService],
})
export class PurchasingModule {}
