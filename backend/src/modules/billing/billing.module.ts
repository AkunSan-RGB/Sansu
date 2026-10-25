import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin';
import { BillingController, BillingWebhookController, PlatformAdminController } from './billing.controller';
import { BillingService, BillingScheduler } from './billing.service';
import { PlatformBillingService } from './platform-billing.service';

@Module({
  controllers: [BillingController, BillingWebhookController, PlatformAdminController],
  providers: [BillingService, PlatformBillingService, BillingScheduler, PlatformAdminGuard],
  exports: [BillingService, PlatformBillingService],
})
export class BillingModule {}
