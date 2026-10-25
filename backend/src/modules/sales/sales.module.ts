import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FxModule } from '../fx/fx.module';
import { SalesControlsController, SalesControlsService } from './sales-controls';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { DeliveriesService } from './deliveries/deliveries.service';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { CanvassController } from './canvass/canvass.controller';
import { CanvassService } from './canvass/canvass.service';
import { DeliveryTripsController, DeliveryVehiclesController } from './deliveries/delivery-trips.controller';
import { DeliveryTripsService, DeliveryVehiclesService, RoutingService } from './deliveries/delivery-trips.service';
import { ConsignmentsController } from './consignment/consignments.controller';
import { ConsignmentsService } from './consignment/consignments.service';
import { CreditService } from './orders/credit.service';
import { SalesOrdersController } from './orders/sales-orders.controller';
import { SalesOrdersService } from './orders/sales-orders.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PricingController } from './pricing/price-lists.controller';
import { PricingService } from './pricing/price-lists.service';
import { TradeController } from './trade/trade.controller';
import { TradeService } from './trade/trade.service';
import { SalesCommissionsController, SalesCommissionsService } from './targets/sales-commissions';
import { SalesTargetsController, SalesTargetsService } from './targets/sales-targets';
import { ServiceBillingController } from './services/service-billing.controller';
import { ServiceBillingService } from './services/service-billing.service';
import { TimesheetController } from './services/timesheets.controller';
import { TimesheetService } from './services/timesheets.service';
import { CalendarFeedController, CalendarFeedService, CalendarPublicController } from './services/calendar-feed';
import { SchedulingController } from './services/scheduling.controller';
import { SchedulingService } from './services/scheduling.service';
import { RetainerController, RetainerService } from './services/retainers';

@Module({
  imports: [AccountingModule, InventoryModule, FxModule],
  controllers: [SalesControlsController, SalesOrdersController, DeliveriesController, InvoicesController, PaymentsController, ServiceBillingController, PricingController, SalesTargetsController, SalesCommissionsController, ConsignmentsController, CanvassController, DeliveryTripsController, DeliveryVehiclesController, TradeController, TimesheetController, SchedulingController, CalendarFeedController, CalendarPublicController, RetainerController],
  providers: [RoutingService, DeliveryVehiclesService, DeliveryTripsService, SalesControlsService, TradeService, CanvassService, ConsignmentsService, PricingService, SalesTargetsService, SalesCommissionsService, SalesOrdersService, CreditService, DeliveriesService, InvoicesService, PaymentsService, ServiceBillingService, TimesheetService, SchedulingService, CalendarFeedService, RetainerService],
  exports: [SalesOrdersService, InvoicesService, PricingService, ServiceBillingService, PaymentsService],
})
export class SalesModule {}
