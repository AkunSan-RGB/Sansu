import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FxModule } from '../fx/fx.module';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { DeliveriesService } from './deliveries/deliveries.service';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { CreditService } from './orders/credit.service';
import { SalesOrdersController } from './orders/sales-orders.controller';
import { SalesOrdersService } from './orders/sales-orders.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PricingController, PricingService } from './pricing/price-lists';
import { SalesCommissionsController, SalesCommissionsService } from './targets/sales-commissions';
import { SalesTargetsController, SalesTargetsService } from './targets/sales-targets';
import { ServiceBillingController, ServiceBillingService } from './services/service-billing';

@Module({
  imports: [AccountingModule, InventoryModule, FxModule],
  controllers: [SalesOrdersController, DeliveriesController, InvoicesController, PaymentsController, ServiceBillingController, PricingController, SalesTargetsController, SalesCommissionsController],
  providers: [PricingService, SalesTargetsService, SalesCommissionsService, SalesOrdersService, CreditService, DeliveriesService, InvoicesService, PaymentsService, ServiceBillingService],
  exports: [SalesOrdersService, InvoicesService, PricingService],
})
export class SalesModule {}
