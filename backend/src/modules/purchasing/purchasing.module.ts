import { Module } from '@nestjs/common';
import { PriceAgreementsController } from './price-agreements.controller';
import { PriceAgreementsService } from './price-agreements.service';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';
import { PurchaseControlsController } from './purchase-controls.controller';
import { PurchaseControlsService } from './purchase-controls.service';
import { AssetsModule } from '../assets/assets.module';
import { FxModule } from '../fx/fx.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoiceRepository } from './purchase-invoice.repository';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SupplierBillsService } from './supplier-bills.service';
import { PurchaseReportsService } from './purchase-reports.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController, PurchaseInvoicesController, PurchaseOrdersController, PurchaseRequestsController, SuppliersController } from './purchasing.controller';
import { SupplierAdvancesController } from './supplier-advances.controller';
import { SupplierAdvancesService } from './supplier-advances.service';
import { SuppliersService } from './suppliers.service';
import { SupplierPaymentsRepository } from './supplier-payments.repository';
import { PurchaseRequestsRepository } from './purchase-requests.repository';
import { GoodsReceiptsRepository } from './goods-receipts.repository';
import { SupplierBillsRepository } from './supplier-bills.repository';
import { SupplierAdvancesRepository } from './supplier-advances.repository';
import { PriceAgreementsRepository } from './price-agreements.repository';
import { SuppliersRepository } from './suppliers.repository';
import { PurchaseOrdersRepository } from './purchase-orders.repository';

@Module({
  imports: [AccountingModule, InventoryModule, AssetsModule, FxModule, ProductionModule],
  controllers: [SupplierAdvancesController, ShoppingListController, PriceAgreementsController, PurchaseControlsController, SuppliersController, PurchaseOrdersController, GoodsReceiptsController, PurchaseInvoicesController, PurchaseRequestsController],
  providers: [PurchaseOrdersRepository, SuppliersRepository, PriceAgreementsRepository, SupplierAdvancesRepository, SupplierBillsRepository, GoodsReceiptsRepository, PurchaseRequestsRepository, SupplierPaymentsRepository, PurchaseInvoiceRepository, SupplierAdvancesService, ShoppingListService, PriceAgreementsService, PurchaseControlsService, SuppliersService, PurchaseOrdersService, GoodsReceiptsService, PurchaseInvoicesService, SupplierPaymentsService, SupplierBillsService, PurchaseReportsService, PurchaseRequestsService],
  exports: [SupplierAdvancesService, PurchaseOrdersService, PurchaseInvoicesService, SupplierPaymentsService, SupplierBillsService, PurchaseReportsService, PurchaseRequestsService, SuppliersService],
})
export class PurchasingModule {}
