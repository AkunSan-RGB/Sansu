import { Module } from '@nestjs/common';
import { PriceAgreementsController, PriceAgreementsService } from './price-agreements';
import { ShoppingListController, ShoppingListService } from './shopping-list';
import { PurchaseControlsController, PurchaseControlsService } from './purchase-controls';
import { AssetsModule } from '../assets/assets.module';
import { FxModule } from '../fx/fx.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController, PurchaseInvoicesController, PurchaseOrdersController, PurchaseRequestsController, SuppliersController } from './purchasing.controller';
import { SupplierAdvancesController } from './supplier-advances.controller';
import { SupplierAdvancesService } from './supplier-advances.service';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AccountingModule, InventoryModule, AssetsModule, FxModule, ProductionModule],
  controllers: [SupplierAdvancesController, ShoppingListController, PriceAgreementsController, PurchaseControlsController, SuppliersController, PurchaseOrdersController, GoodsReceiptsController, PurchaseInvoicesController, PurchaseRequestsController],
  providers: [SupplierAdvancesService, ShoppingListService, PriceAgreementsService, PurchaseControlsService, SuppliersService, PurchaseOrdersService, GoodsReceiptsService, PurchaseInvoicesService, PurchaseRequestsService],
  exports: [SupplierAdvancesService, PurchaseOrdersService, PurchaseInvoicesService, PurchaseRequestsService, SuppliersService],
})
export class PurchasingModule {}
