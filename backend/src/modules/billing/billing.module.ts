import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin';
import { BillingController, BillingWebhookController, PlatformAdminController } from './billing.controller';
import { BillingService, BillingScheduler } from './billing.service';

@Module({
  controllers: [BillingController, BillingWebhookController, PlatformAdminController],
  providers: [BillingService, BillingScheduler, PlatformAdminGuard],
  exports: [BillingService],
})
export class BillingModule {}
