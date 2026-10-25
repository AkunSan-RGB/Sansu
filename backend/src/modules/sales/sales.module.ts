import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FxModule } from '../fx/fx.module';
import { SalesControlsController } from './sales-controls.controller';
import { SalesControlsService } from './sales-controls.service';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { DeliveriesService } from './deliveries/deliveries.service';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { CanvassController } from './canvass/canvass.controller';
import { CanvassService } from './canvass/canvass.service';
import { DeliveryTripsController, DeliveryVehiclesController } from './deliveries/delivery-trips.controller';
import { DeliveryTripsService, DeliveryVehiclesService, RoutingService } from './deliveries/delivery-trips.service';
import { DeliveryTripRepository } from './deliveries/delivery-trip.repository';
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
import { SalesCommissionsController } from './targets/sales-commissions.controller';
import { SalesCommissionsService } from './targets/sales-commissions.service';
import { SalesTargetsController } from './targets/sales-targets.controller';
import { SalesTargetsService } from './targets/sales-targets.service';
import { ServiceBillingController } from './services/service-billing.controller';
import { ServiceBillingService } from './services/service-billing.service';
import { CustomerDepositsService } from './services/customer-deposits.service';
import { ServiceProjectsService } from './services/service-projects.service';
import { TimesheetController } from './services/timesheets.controller';
import { TimesheetService } from './services/timesheets.service';
import { CalendarFeedController, CalendarPublicController } from './services/calendar-feed.controller';
import { CalendarFeedService } from './services/calendar-feed.service';
import { SchedulingController } from './services/scheduling.controller';
import { SchedulingService } from './services/scheduling.service';
import { RetainerController } from './services/retainers.controller';
import { RetainerService } from './services/retainers.service';
import { CustomerDepositsRepository } from './services/customer-deposits.repository';
import { TimesheetsRepository } from './services/timesheets.repository';
import { CalendarFeedRepository } from './services/calendar-feed.repository';
import { ServiceBillingRepository } from './services/service-billing.repository';
import { SchedulingRepository } from './services/scheduling.repository';
import { RetainersRepository } from './services/retainers.repository';
import { ServiceProjectsRepository } from './services/service-projects.repository';
import { DeliveriesRepository } from './deliveries/deliveries.repository';
import { InvoicesRepository } from './invoices/invoices.repository';
import { SalesOrdersRepository } from './orders/sales-orders.repository';
import { SalesTargetsRepository } from './targets/sales-targets.repository';
import { SalesCommissionsRepository } from './targets/sales-commissions.repository';
import { CanvassRepository } from './canvass/canvass.repository';
import { TradeRepository } from './trade/trade.repository';
import { PaymentsRepository } from './payments/payments.repository';
import { ConsignmentsRepository } from './consignment/consignments.repository';
import { PriceListsRepository } from './pricing/price-lists.repository';
import { CreditRepository } from './orders/credit.repository';
import { SalesControlsRepository } from './sales-controls.repository';

@Module({
  imports: [AccountingModule, InventoryModule, FxModule],
  controllers: [SalesControlsController, SalesOrdersController, DeliveriesController, InvoicesController, PaymentsController, ServiceBillingController, PricingController, SalesTargetsController, SalesCommissionsController, ConsignmentsController, CanvassController, DeliveryTripsController, DeliveryVehiclesController, TradeController, TimesheetController, SchedulingController, CalendarFeedController, CalendarPublicController, RetainerController],
  providers: [SalesControlsRepository, CreditRepository, PriceListsRepository, ConsignmentsRepository, PaymentsRepository, TradeRepository, CanvassRepository, SalesCommissionsRepository, SalesTargetsRepository, SalesOrdersRepository, InvoicesRepository, DeliveriesRepository, ServiceProjectsRepository, RetainersRepository, SchedulingRepository, ServiceBillingRepository, CalendarFeedRepository, TimesheetsRepository, CustomerDepositsRepository, DeliveryTripRepository, RoutingService, DeliveryVehiclesService, DeliveryTripsService, SalesControlsService, TradeService, CanvassService, ConsignmentsService, PricingService, SalesTargetsService, SalesCommissionsService, SalesOrdersService, CreditService, DeliveriesService, InvoicesService, PaymentsService, ServiceBillingService, CustomerDepositsService, ServiceProjectsService, TimesheetService, SchedulingService, CalendarFeedService, RetainerService],
  exports: [SalesOrdersService, InvoicesService, PricingService, ServiceBillingService, PaymentsService],
})
export class SalesModule {}
